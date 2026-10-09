// Package licence checks whether a public key holds a licence to Postern
// (docs/protocol.md §16): a typed M ('mint') record naming the key's own
// testnet address as holder, in one of the configured collections, minted
// by a transaction the issuer signed (one of its inputs spends an output
// P2PKH to the issuer's key, which the network checked the signature
// against: a scriptSig merely pushing the key proves nothing), whose
// licence token has not since been
// moved to someone else by a TR ('transfer') record spending it, and which
// the issuer has not revoked with a signed W record {"kind":"revoke",
// "origin"} naming the mint's output 0.
//
// Both mint layouts spell-forge-bsv writes put the token at output 0 of the
// mint (license-contract.ts's contract mint: [0] the License, [1] the Fuel,
// [2] the M record, [3] the issuer's change), and every spend of the token —
// a write (W) or a transfer (TR) — spends it at its input 0 and recreates it
// at its own output 0. A TR is tied to a licence only by that outpoint, never
// by its payload, which is the library's {"to": <address>} or the older
// {"origin", "to"}.
package licence

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/record"
	"github.com/btcsuite/btcd/btcec/v2"
	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // Bitcoin/BSV addresses are defined in terms of RIPEMD-160.
)

// DefaultCollections are the collections a mint may name when a Rule names
// none: Postern's own, and spell-forge-bsv's default chainConfig.collectionId
// (which every licence minted before Postern had its own collection names).
var DefaultCollections = []string{"postern", "spellforge-leaderboard-testnet"}

// testnetAddressVersion is the version byte a BSV/Bitcoin testnet P2PKH
// address is Base58Check-encoded with (matches @bsv/sdk's PublicKey.toAddress
// ('testnet') and spell-forge-bsv's TESTNET_ADDRESS_PREFIX).
const testnetAddressVersion = 0x6f

// Reader is the chain access Held needs: an address's transaction history
// (oldest first, height 0 for unconfirmed) and a transaction's raw hex. Any
// chain.Chain satisfies it; tests supply a fake.
type Reader = chain.Reader

// Rule is what makes a mint count.
type Rule struct {
	// Collections a mint may name (POSTERN_COLLECTIONS); none means
	// DefaultCollections.
	Collections []string
	// IssuerKey is the issuer's compressed public key, hex
	// (POSTERN_ISSUER_KEY). When set, a mint counts only if one of its
	// transaction's inputs has a P2PKH scriptSig pushing this key and spends
	// an output P2PKH to it, and the
	// issuer's address history is searched for mints too (a contract mint
	// pays nothing to the holder's address). Empty keeps the old rule: any
	// mint naming the holder, found in the holder's own history.
	IssuerKey string
}

type mintPayload struct {
	Collection string `json:"collection"`
	Holder     string `json:"holder"`
}

type transferPayload struct {
	To string `json:"to"`
}

type revokePayload struct {
	Kind   string `json:"kind"`
	Origin string `json:"origin"`
}

type outpoint struct {
	txid string
	vout int
}

// Held reports whether address holds a licence under rule: whether
// HeldCollections names any collection.
func Held(reader Reader, address string, rule Rule) (bool, error) {
	collections, err := HeldCollections(reader, address, rule)
	return len(collections) > 0, err
}

// HeldCollections names every collection address holds a licence in under
// rule, each once, in the order their first mints appear. It reads every
// transaction in address's history (and the issuer's, when rule names one),
// finds each mint that counts, and follows that licence's token from the
// mint's output 0 through every spend of it those transactions show: a TR
// record moves it to the address it names, anything else (a write) leaves
// it with its holder, and each spend's output 0 is the token's next
// outpoint. A licence the issuer revoked (issuerCheck.revoked) is never held,
// whatever later transfers did with it. A collection is held if any counting licence in it ends with
// address. The collection is what a licence opens (docs/protocol.md §19).
//
// Only transactions in those address histories are seen: a spend paid
// wholly from the licence's Fuel touches no P2PKH address, so a transfer
// like that stays invisible here until something (the holder's own coin, a
// payment, its change) puts it in one of those histories.
func HeldCollections(reader Reader, address string, rule Rule) ([]string, error) {
	result, err := walkHistories(reader, address, rule)
	return result.Collections, err
}

// walkHistories is HeldCollections naming the mints too.
func walkHistories(reader Reader, address string, rule Rule) (Result, error) {
	addresses := []string{address}
	issuerKey := strings.ToLower(rule.IssuerKey)
	issuerAddress := ""
	if issuerKey != "" {
		var err error
		issuerAddress, err = AddressForPublicKey(issuerKey)
		if err != nil {
			return Result{}, fmt.Errorf("issuer key: %w", err)
		}
		if issuerAddress != address {
			addresses = append(addresses, issuerAddress)
		}
	}

	txs := make(map[string]*record.Transaction)
	var order []string
	inIssuerHistory := make(map[string]bool)
	for _, addr := range addresses {
		history, err := reader.GetHistory(addr)
		if err != nil {
			return Result{}, fmt.Errorf("getting history for %s: %w", addr, err)
		}
		for _, entry := range history {
			if addr == issuerAddress {
				inIssuerHistory[entry.TxHash] = true
			}
			if err := loadTransaction(reader, entry, txs, &order); err != nil {
				return Result{}, err
			}
		}
	}

	spentBy := make(map[outpoint]string)
	for txid, tx := range txs {
		if tx == nil {
			continue
		}
		for _, in := range tx.Inputs {
			spentBy[outpoint{in.PrevTxID, in.PrevVout}] = txid
		}
	}

	var issuer *issuerCheck
	var revokes map[string][]string
	if issuerKey != "" {
		issuer = newIssuerCheck(reader, issuerKey, txs)
		revokes = revokeCandidates(txs, order, inIssuerHistory, issuerKey)
	}

	collections := rule.Collections
	if len(collections) == 0 {
		collections = DefaultCollections
	}
	var result Result
	for _, txid := range order {
		collection, ok := mintFor(txs[txid], address, collections)
		if !ok || contains(result.Collections, collection) || holderNow(txid, address, txs, spentBy) != address {
			continue
		}
		if issuer != nil {
			signed, err := issuer.signed(txs[txid])
			if err != nil {
				return Result{}, err
			}
			if !signed {
				continue
			}
			revoked, err := issuer.revoked(txid+":0", revokes)
			if err != nil {
				return Result{}, err
			}
			if revoked {
				continue
			}
		}
		result.Collections = append(result.Collections, collection)
		result.Mints = append(result.Mints, Mint{Txid: txid, Collection: collection})
	}
	return result, nil
}

// Mint names a licence's mint transaction, whose output 0 is its token.
type Mint struct {
	Txid       string `json:"txid"`
	Collection string `json:"collection"`
}

// Result is what a check found: the collections the key holds licences in,
// each once, and the mint of each, for the caller to remember and hand back
// to the next Find.
type Result struct {
	Collections []string
	Mints       []Mint
}

// loadTransaction reads the transaction entry names into txs (nil when it
// does not parse) and appends it to order when it does, unless txs has it.
func loadTransaction(reader Reader, entry chain.HistoryEntry, txs map[string]*record.Transaction, order *[]string) error {
	if _, seen := txs[entry.TxHash]; seen {
		return nil
	}
	txHex, err := reader.GetTransactionHex(entry.TxHash)
	if err != nil {
		if notServedYet(entry, err) {
			return nil // not recorded: the next walk reads it once the provider serves it
		}
		return fmt.Errorf("getting transaction %s: %w", entry.TxHash, err)
	}
	tx, err := record.ParseTransaction(txHex)
	if err != nil {
		txs[entry.TxHash] = nil // an unparseable transaction just yields no records
		return nil
	}
	txs[entry.TxHash] = tx
	*order = append(*order, entry.TxHash)
	return nil
}

// maxTokenSpends bounds how many spends of one token Find follows.
const maxTokenSpends = 1000

// Find is HeldCollections for a long-lived key. A holder who sends a message
// per transaction soon has a history no walk can read, and reading it is only
// to see whether the licence's token moved or the issuer revoked it, so when
// rule names an issuer and reader can say who spent an output
// (chain.SpendReader), Find reads the issuer's history alone: every mint the
// issuer signed naming address is in it (a mint the issuer signed spends the
// issuer's coin), and so is every revoke. The holder's history is not read at
// all; the token is followed from its mint through the spends the provider
// names. remembered are mints an earlier Find returned; they are candidates
// even if the issuer's history does not list them yet. Without an issuer, or
// a reader that can look spends up, Find is the walk of HeldCollections.
func Find(reader Reader, address string, rule Rule, remembered []Mint) (Result, error) {
	spends, ok := reader.(chain.SpendReader)
	if !ok || rule.IssuerKey == "" {
		return walkHistories(reader, address, rule)
	}
	result, err := findByIssuer(reader, spends, address, rule, remembered)
	if errors.Is(err, chain.ErrNoSpendLookup) {
		return walkHistories(reader, address, rule)
	}
	return result, err
}

func findByIssuer(reader Reader, spends chain.SpendReader, address string, rule Rule, remembered []Mint) (Result, error) {
	issuerKey := strings.ToLower(rule.IssuerKey)
	issuerAddress, err := AddressForPublicKey(issuerKey)
	if err != nil {
		return Result{}, fmt.Errorf("issuer key: %w", err)
	}
	history, err := reader.GetHistory(issuerAddress)
	if err != nil {
		return Result{}, fmt.Errorf("getting history for %s: %w", issuerAddress, err)
	}

	txs := make(map[string]*record.Transaction)
	var order []string
	inIssuerHistory := make(map[string]bool)
	for _, entry := range history {
		inIssuerHistory[entry.TxHash] = true
		if err := loadTransaction(reader, entry, txs, &order); err != nil {
			return Result{}, err
		}
	}
	for _, mint := range remembered {
		if err := loadTransaction(reader, chain.HistoryEntry{TxHash: mint.Txid, Height: 1}, txs, &order); err != nil {
			return Result{}, err
		}
	}

	issuer := newIssuerCheck(reader, issuerKey, txs)
	revokes := revokeCandidates(txs, order, inIssuerHistory, issuerKey)
	collections := rule.Collections
	if len(collections) == 0 {
		collections = DefaultCollections
	}
	var result Result
	for _, txid := range order {
		collection, ok := mintFor(txs[txid], address, collections)
		if !ok || contains(result.Collections, collection) {
			continue
		}
		holder, err := holderBySpends(reader, spends, txid, address)
		if err != nil {
			return Result{}, err
		}
		if holder != address {
			continue
		}
		signed, err := issuer.signed(txs[txid])
		if err != nil {
			return Result{}, err
		}
		if !signed {
			continue
		}
		revoked, err := issuer.revoked(txid+":0", revokes)
		if err != nil {
			return Result{}, err
		}
		if revoked {
			continue
		}
		result.Collections = append(result.Collections, collection)
		result.Mints = append(result.Mints, Mint{Txid: txid, Collection: collection})
	}
	return result, nil
}

// holderBySpends is holderNow with the spends of the token asked of the
// provider instead of read from histories: who holds the licence minted at
// mintTxid:0 after every spend of its token, the minted holder or the address
// the last TR spending it named.
func holderBySpends(reader Reader, spends chain.SpendReader, mintTxid, holder string) (string, error) {
	current := mintTxid
	for steps := 0; steps < maxTokenSpends; steps++ {
		spender, spent, err := spends.GetSpender(current, 0)
		if err != nil {
			return "", fmt.Errorf("asking who spent %s:0: %w", current, err)
		}
		if !spent {
			return holder, nil
		}
		txHex, err := reader.GetTransactionHex(spender)
		if err != nil {
			return "", fmt.Errorf("getting transaction %s: %w", spender, err)
		}
		if tx, err := record.ParseTransaction(txHex); err == nil {
			if to, isTransfer := transferTo(tx); isTransfer {
				holder = to
			}
		}
		current = spender
	}
	return "", fmt.Errorf("the token of %s was spent more than %d times", mintTxid, maxTokenSpends)
}

// notServedYet reports whether err is the provider's 404 for an unconfirmed
// history entry: it lists a mempool transaction before it can serve it, and
// a new one arrives faster than a walk finishes, so failing the whole check
// on it would fail every check. A confirmed entry the provider cannot serve,
// or any other failure, is a real fault.
func notServedYet(entry chain.HistoryEntry, err error) bool {
	var providerErr *chain.ProviderError
	return entry.Height == 0 && errors.As(err, &providerErr) && providerErr.Status == http.StatusNotFound
}

// mintFor reports whether tx carries an M record naming holder in one of
// collections, and in which collection. Who signed it is the caller's to
// check.
func mintFor(tx *record.Transaction, holder string, collections []string) (string, bool) {
	for _, out := range tx.Outputs {
		typed, ok := record.DecodeTypedScript(out.ScriptHex)
		if !ok || typed.RecordType != "M" {
			continue
		}
		var payload mintPayload
		if json.Unmarshal(typed.PayloadBytes, &payload) != nil {
			continue
		}
		if payload.Holder == holder && contains(collections, payload.Collection) {
			return payload.Collection, true
		}
	}
	return "", false
}

// revokeCandidates names, for each origin ("txid:vout") a typed W record
// {"kind":"revoke","origin"} names, the transactions in the issuer's own
// history carrying one whose scriptSigs push the issuer's key. Whether the
// issuer really signed one is issuerCheck.revoked's to check, and only for
// a counting mint's origin. A revoke names one mint output, so a mint after
// it is a new licence.
func revokeCandidates(txs map[string]*record.Transaction, order []string, inIssuerHistory map[string]bool, issuerKey string) map[string][]string {
	revokes := make(map[string][]string)
	for _, txid := range order {
		tx := txs[txid]
		if !inIssuerHistory[txid] || !pushesKey(tx, issuerKey) {
			continue
		}
		for _, out := range tx.Outputs {
			typed, ok := record.DecodeTypedScript(out.ScriptHex)
			if !ok || typed.RecordType != "W" {
				continue
			}
			var payload revokePayload
			if json.Unmarshal(typed.PayloadBytes, &payload) == nil && payload.Kind == "revoke" && payload.Origin != "" {
				origin := strings.ToLower(payload.Origin)
				revokes[origin] = append(revokes[origin], txid)
			}
		}
	}
	return revokes
}

// pushesKey reports whether one of tx's inputs has a P2PKH-shaped
// scriptSig pushing key: necessary for the key's owner to have signed tx,
// never sufficient (issuerCheck.signed).
func pushesKey(tx *record.Transaction, key string) bool {
	for _, in := range tx.Inputs {
		if pushed, ok := record.P2PKHPublicKey(in.ScriptSig); ok && pushed == key {
			return true
		}
	}
	return false
}

// issuerCheck decides whether the issuer signed a transaction, reading the
// transactions its inputs spend from: those the address histories already
// brought, or one read per other txid, remembered for the rest of the
// check.
type issuerCheck struct {
	reader  Reader
	key     string // the issuer's public key, lowercase hex
	keyHash []byte // hash160 of it
	known   map[string]*record.Transaction
	fetched map[string]*record.Transaction // nil for one that does not parse
}

func newIssuerCheck(reader Reader, key string, known map[string]*record.Transaction) *issuerCheck {
	keyBytes, _ := hex.DecodeString(key) // AddressForPublicKey has parsed it
	return &issuerCheck{reader: reader, key: key, keyHash: hash160(keyBytes), known: known, fetched: map[string]*record.Transaction{}}
}

// signed reports whether one of tx's inputs pushes the issuer's key in a
// P2PKH scriptSig AND spends an output P2PKH to that key: the network
// checked that input's signature against that output, so the issuer signed
// tx. A pushed key over any other output (a bare OP_2DROP OP_1, say) proves
// nothing. An output that cannot be read is an error, never a yes, so the
// mint does not count and the caller's stale answer can stand.
func (c *issuerCheck) signed(tx *record.Transaction) (bool, error) {
	var readErr error
	for _, in := range tx.Inputs {
		if pushed, ok := record.P2PKHPublicKey(in.ScriptSig); !ok || pushed != c.key {
			continue
		}
		prev, err := c.transaction(in.PrevTxID)
		if err != nil {
			readErr = err
			continue
		}
		if prev == nil || in.PrevVout < 0 || in.PrevVout >= len(prev.Outputs) {
			continue
		}
		if hash, ok := record.P2PKHLockHash(prev.Outputs[in.PrevVout].ScriptHex); ok && bytes.Equal(hash, c.keyHash) {
			return true, nil
		}
	}
	return false, readErr
}

// revoked reports whether one of the revoke candidates naming origin was
// signed by the issuer.
func (c *issuerCheck) revoked(origin string, revokes map[string][]string) (bool, error) {
	for _, txid := range revokes[origin] {
		signed, err := c.signed(c.known[txid])
		if err != nil || signed {
			return signed, err
		}
	}
	return false, nil
}

// transaction returns txid parsed (nil if it does not parse), from what the
// histories brought or else read once.
func (c *issuerCheck) transaction(txid string) (*record.Transaction, error) {
	if tx := c.known[txid]; tx != nil {
		return tx, nil
	}
	if tx, ok := c.fetched[txid]; ok {
		return tx, nil
	}
	txHex, err := c.reader.GetTransactionHex(txid)
	if err != nil {
		return nil, fmt.Errorf("getting spent transaction %s: %w", txid, err)
	}
	tx, err := record.ParseTransaction(txHex)
	if err != nil {
		tx = nil
	}
	c.fetched[txid] = tx
	return tx, nil
}

// holderNow follows the licence minted at mintTxid:0 through every spend
// of its token that spentBy knows, and returns who holds it at the end: the
// minted holder, or the address the last TR spending it named ("" for a TR
// whose payload names no one readable).
func holderNow(mintTxid, holder string, txs map[string]*record.Transaction, spentBy map[outpoint]string) string {
	current := outpoint{mintTxid, 0}
	for steps := 0; steps <= len(txs); steps++ { // a token's lineage never revisits a transaction
		spender, spent := spentBy[current]
		if !spent {
			break
		}
		if to, isTransfer := transferTo(txs[spender]); isTransfer {
			holder = to
		}
		current = outpoint{spender, 0}
	}
	return holder
}

// transferTo reports whether tx carries a TR record and, if so, the address
// its payload names ("" if the payload names none readably).
func transferTo(tx *record.Transaction) (string, bool) {
	for _, out := range tx.Outputs {
		typed, ok := record.DecodeTypedScript(out.ScriptHex)
		if !ok || typed.RecordType != "TR" {
			continue
		}
		var payload transferPayload
		if json.Unmarshal(typed.PayloadBytes, &payload) != nil {
			return "", true
		}
		return payload.To, true
	}
	return "", false
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// AddressForPublicKey returns the testnet P2PKH address a License token
// locked to the compressed secp256k1 public key pubKeyHex would show —
// matching @bsv/sdk's PublicKey.fromString(pubKeyHex).toAddress('testnet').
func AddressForPublicKey(pubKeyHex string) (string, error) {
	pubKeyBytes, err := hex.DecodeString(pubKeyHex)
	if err != nil {
		return "", fmt.Errorf("decoding public key hex: %w", err)
	}
	pubKey, err := btcec.ParsePubKey(pubKeyBytes)
	if err != nil {
		return "", fmt.Errorf("parsing public key: %w", err)
	}

	return base58CheckEncode(testnetAddressVersion, hash160(pubKey.SerializeCompressed())), nil
}

// hash160 is RIPEMD-160(SHA-256(data)), what OP_HASH160 computes and a
// P2PKH output locks to.
func hash160(data []byte) []byte {
	sha := sha256.Sum256(data)
	ripemd := ripemd160.New()
	ripemd.Write(sha[:])
	return ripemd.Sum(nil)
}

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// base58CheckEncode Base58Check-encodes payload with the given version byte:
// version || payload || first 4 bytes of doubleSHA256(version || payload).
func base58CheckEncode(version byte, payload []byte) string {
	input := append([]byte{version}, payload...)
	checksum := doubleSHA256(input)
	input = append(input, checksum[:4]...)

	leadingZeros := 0
	for _, b := range input {
		if b != 0 {
			break
		}
		leadingZeros++
	}

	x := new(big.Int).SetBytes(input)
	base := big.NewInt(58)
	mod := new(big.Int)
	var out []byte
	for x.Sign() > 0 {
		x.DivMod(x, base, mod)
		out = append(out, base58Alphabet[mod.Int64()])
	}
	for i := 0; i < leadingZeros; i++ {
		out = append(out, base58Alphabet[0])
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return string(out)
}

func doubleSHA256(data []byte) [32]byte {
	first := sha256.Sum256(data)
	return sha256.Sum256(first[:])
}
