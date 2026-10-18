package register

import (
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/btcsuite/btcd/btcec/v2"
)

// LowBalanceMints is how many licences' worth the site address should hold:
// below it, WarnIfLow writes its line.
const LowBalanceMints = 10

// keepOwnSpends is how long the issuer remembers the coins it spent and the
// change it made, for WhatsOnChain's lag: it lists a spent coin as unspent,
// and leaves out a fresh change, for a while after a broadcast.
const keepOwnSpends = 24 * time.Hour

var (
	// ErrByHand: the site issuer key is not set, so nobody can be licensed
	// here; the Governor licenses by hand.
	ErrByHand = errors.New("licensed by hand: ask the Governor")
	// ErrIssue: the licence could not be minted (no coins, or the chain
	// refused or could not be reached). Nothing was stored.
	ErrIssue = errors.New("the licence could not be issued just now; try again in a minute")
	// ErrRevoke: the licence could not be revoked; the device is kept.
	ErrRevoke = errors.New("the licence could not be revoked just now; try again in a minute")
	// ErrNotYours: the signer is not a device on that licence.
	ErrNotYours = errors.New("only a device on this licence can remove one of its devices")
	// ErrNoDevice: the device to remove is not on that licence.
	ErrNoDevice = errors.New("that device is not on this licence")
)

// LicenceIssuer mints a Lampas licence to a device key and revokes one by
// its origin (the mint's txid:0), answering the txid it broadcast.
type LicenceIssuer interface {
	Issue(holderKey string) (txid string, err error)
	Revoke(origin string) (txid string, err error)
}

// WithIssuer lets registration license the devices it adds (and revoke the
// ones it removes). Without one, start and confirm answer ErrByHand.
func WithIssuer(issuer LicenceIssuer) Option { return func(s *Service) { s.issuer = issuer } }

// IssuerChain is what the issuer asks of the chain: the site address's
// coins and balance, and a broadcast.
type IssuerChain interface {
	chain.Wallet
	chain.Broadcaster
}

// Issuer is the site issuer (POSTERN_SITE_ISSUER_KEY): it signs Lampas
// licences, and their revokes, with its own key, paid from its own address.
// One transaction at a time; it spends every coin it has and keeps one
// change, as the TS issuer does. The key is held here and never written to
// the log or an error.
type Issuer struct {
	key     *btcec.PrivateKey
	pub     string
	address string
	anchor  string
	chain   IssuerChain
	now     func() time.Time

	mu     sync.Mutex
	spent  map[string]time.Time // coins this issuer spent, by txid:vout
	change map[string]ownCoin   // change this issuer made, by txid:vout
}

type ownCoin struct {
	coin
	at time.Time
}

// NewIssuer is the site issuer for key, paying its revokes' 1-sat anchor
// output to anchor (POSTERN_ANCHOR, as the phone's revoke does).
func NewIssuer(key *btcec.PrivateKey, anchor string, c IssuerChain) (*Issuer, error) {
	if key == nil {
		return nil, errors.New("site issuer: no key")
	}
	if _, err := addressHash(anchor); err != nil {
		return nil, fmt.Errorf("site issuer: anchor %q: %w", anchor, err)
	}
	pub := hex.EncodeToString(key.PubKey().SerializeCompressed())
	address, err := licence.AddressForPublicKey(pub)
	if err != nil {
		return nil, fmt.Errorf("site issuer: %w", err)
	}
	return &Issuer{key: key, pub: pub, address: address, anchor: anchor, chain: c, now: time.Now,
		spent: map[string]time.Time{}, change: map[string]ownCoin{}}, nil
}

// PublicKey is the site issuer's compressed public key, hex: what Lampas
// names as the site issuer (VITE_LAMPAS_SITE_ISSUER).
func (i *Issuer) PublicKey() string { return i.pub }

// Address is the testnet address the Governor funds.
func (i *Issuer) Address() string { return i.address }

// Issue mints a licence in LampasCollection to holderKey and answers its
// txid; the licence's origin is txid:0.
func (i *Issuer) Issue(holderKey string) (string, error) {
	holder, err := hex.DecodeString(strings.ToLower(strings.TrimSpace(holderKey)))
	if err != nil || len(holder) != 33 || (holder[0] != 2 && holder[0] != 3) {
		return "", errors.New("site issuer: the holder is not a compressed public key")
	}
	if hex.EncodeToString(holder) == i.pub {
		return "", errors.New("site issuer: will not license its own key")
	}
	return i.send("mint", func(coins []coin) (*transaction, error) {
		return buildMint(i.key, coins, holder, LampasCollection)
	})
}

// Revoke writes the site key's revoke record for origin (txid:vout).
func (i *Issuer) Revoke(origin string) (string, error) {
	return i.send("revoke", func(coins []coin) (*transaction, error) {
		return buildRevoke(i.key, coins, strings.ToLower(origin), i.anchor)
	})
}

// send builds what build makes from the coins the site address can spend,
// broadcasts it, and remembers what it spent and the change it made.
func (i *Issuer) send(what string, build func([]coin) (*transaction, error)) (string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	coins, err := i.coins()
	if err != nil {
		return "", fmt.Errorf("site issuer: listing coins for the %s: %w", what, err)
	}
	tx, err := build(coins)
	if err != nil {
		return "", fmt.Errorf("site issuer: building the %s: %w", what, err)
	}
	txid := tx.txid()
	answered, err := i.chain.Broadcast(tx.hex())
	if err != nil {
		return "", fmt.Errorf("site issuer: broadcasting the %s %s: %w", what, txid, err)
	}
	if !strings.EqualFold(answered, txid) {
		log.Printf("site issuer: the chain answered txid %s for the %s %s", answered, what, txid)
	}
	now := i.now()
	for _, in := range tx.inputs {
		i.spent[in.prev.key()] = now
		delete(i.change, in.prev.key())
	}
	if change, ok := tx.changeCoin(); ok {
		i.change[change.key()] = ownCoin{coin: change, at: now}
	}
	return txid, nil
}

// coins is what the site address may spend: the coins the chain lists, less
// those this issuer spent, and this issuer's own change the list leaves out.
// Called with mu held.
func (i *Issuer) coins() ([]coin, error) {
	listed, err := i.chain.GetUtxos(i.address)
	if err != nil {
		return nil, err
	}
	now := i.now()
	for k, at := range i.spent {
		if now.Sub(at) > keepOwnSpends {
			delete(i.spent, k)
		}
	}
	for k, c := range i.change {
		if now.Sub(c.at) > keepOwnSpends {
			delete(i.change, k)
		}
	}
	var out []coin
	seen := map[string]bool{}
	for _, c := range coinsOf(listed) {
		if _, spent := i.spent[c.key()]; spent || seen[c.key()] {
			continue
		}
		seen[c.key()] = true
		out = append(out, c)
	}
	var own []string
	for k := range i.change {
		if _, spent := i.spent[k]; !spent && !seen[k] {
			own = append(own, k)
		}
	}
	sort.Strings(own)
	for _, k := range own {
		out = append(out, i.change[k].coin)
	}
	return out, nil
}

// coinsOf is the listed outputs that look like coins (a txid of 64 hex).
func coinsOf(utxos []chain.Utxo) []coin {
	var out []coin
	for _, u := range utxos {
		if raw, err := hex.DecodeString(u.TxHash); err != nil || len(raw) != 32 || u.TxPos < 0 {
			continue
		}
		out = append(out, coin{txid: strings.ToLower(u.TxHash), vout: uint32(u.TxPos), satoshis: u.Value})
	}
	return out
}

// WarnIfLow writes 'site issuer low: <sats>' through logf when the site
// address holds less than LowBalanceMints licences' worth (confirmed and
// unconfirmed together); a balance it cannot read is a line too.
func (i *Issuer) WarnIfLow(logf func(format string, args ...any)) {
	balance, err := i.chain.GetBalance(i.address)
	if err != nil {
		logf("site issuer: reading the balance of %s: %v", i.address, err)
		return
	}
	if held := balance.Confirmed + balance.Unconfirmed; held < LowBalanceMints*MintCostSatoshis {
		logf("site issuer low: %d", held)
	}
}
