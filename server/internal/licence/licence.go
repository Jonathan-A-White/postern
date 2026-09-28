// Package licence checks whether a public key holds a licence to Postern
// (docs/protocol.md §16): a typed M ('mint') record naming the key's own
// testnet address as holder, in one of the configured collections, minted
// by a transaction the issuer signed, whose licence token has not since been
// moved to someone else by a TR ('transfer') record spending it.
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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"

	"github.com/Jonathan-A-White/postern/server/internal/record"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
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
// (oldest first, height 0 for unconfirmed) and a transaction's raw hex.
// *woc.Client satisfies this; tests supply a fake.
type Reader interface {
	GetHistory(address string) ([]woc.HistoryEntry, error)
	GetTransactionHex(txid string) (string, error)
}

// Rule is what makes a mint count.
type Rule struct {
	// Collections a mint may name (POSTERN_COLLECTIONS); none means
	// DefaultCollections.
	Collections []string
	// IssuerKey is the issuer's compressed public key, hex
	// (POSTERN_ISSUER_KEY). When set, a mint counts only if one of its
	// transaction's inputs has a P2PKH scriptSig pushing this key, and the
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

type outpoint struct {
	txid string
	vout int
}

// Held reports whether address holds a licence under rule. It reads every
// transaction in address's history (and the issuer's, when rule names one),
// finds each mint that counts, and follows that licence's token from the
// mint's output 0 through every spend of it those transactions show: a TR
// record moves it to the address it names, anything else (a write) leaves
// it with its holder, and each spend's output 0 is the token's next
// outpoint. It holds if any counting licence ends with address.
//
// Only transactions in those address histories are seen: a spend paid
// wholly from the licence's Fuel touches no P2PKH address, so a transfer
// like that stays invisible here until something (the holder's own coin, a
// payment, its change) puts it in one of those histories.
func Held(reader Reader, address string, rule Rule) (bool, error) {
	addresses := []string{address}
	issuerKey := strings.ToLower(rule.IssuerKey)
	if issuerKey != "" {
		issuerAddress, err := AddressForPublicKey(issuerKey)
		if err != nil {
			return false, fmt.Errorf("issuer key: %w", err)
		}
		if issuerAddress != address {
			addresses = append(addresses, issuerAddress)
		}
	}

	txs := make(map[string]*record.Transaction)
	var order []string
	for _, addr := range addresses {
		history, err := reader.GetHistory(addr)
		if err != nil {
			return false, fmt.Errorf("getting history for %s: %w", addr, err)
		}
		for _, entry := range history {
			if _, seen := txs[entry.TxHash]; seen {
				continue
			}
			txHex, err := reader.GetTransactionHex(entry.TxHash)
			if err != nil {
				return false, fmt.Errorf("getting transaction %s: %w", entry.TxHash, err)
			}
			tx, err := record.ParseTransaction(txHex)
			if err != nil {
				txs[entry.TxHash] = nil // an unparseable transaction just yields no records
				continue
			}
			txs[entry.TxHash] = tx
			order = append(order, entry.TxHash)
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

	collections := rule.Collections
	if len(collections) == 0 {
		collections = DefaultCollections
	}
	for _, txid := range order {
		if !countsAsMint(txs[txid], address, collections, issuerKey) {
			continue
		}
		if holderNow(txid, address, txs, spentBy) == address {
			return true, nil
		}
	}
	return false, nil
}

// countsAsMint reports whether tx carries an M record naming holder in one
// of collections, signed (when issuerKey is set) by the issuer.
func countsAsMint(tx *record.Transaction, holder string, collections []string, issuerKey string) bool {
	minted := false
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
			minted = true
			break
		}
	}
	if !minted || issuerKey == "" {
		return minted
	}

	for _, in := range tx.Inputs {
		if key, ok := record.P2PKHPublicKey(in.ScriptSig); ok && key == issuerKey {
			return true
		}
	}
	return false
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

	sha := sha256.Sum256(pubKey.SerializeCompressed())
	ripemd := ripemd160.New()
	ripemd.Write(sha[:])
	hash160 := ripemd.Sum(nil)

	return base58CheckEncode(testnetAddressVersion, hash160), nil
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
