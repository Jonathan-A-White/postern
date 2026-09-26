// Package licence checks whether a public key holds a spell-forge License
// token, the same rule src/services/licence.ts's findLicence applies in the
// PWA: a type-M ('mint') record naming the key's own testnet address as
// holder, with no later type-TR ('transfer') record moving that mint's
// origin away. Postern mints to its own key (issuer and holder at once), so
// the mint transaction always appears in the holder's own address history —
// no anchor-wide scan is needed.
package licence

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/Jonathan-A-White/postern/server/internal/record"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // Bitcoin/BSV addresses are defined in terms of RIPEMD-160.
)

// CollectionID matches spell-forge-bsv's default chainConfig.collectionId —
// the collection a mint record must name for its holder to count as
// licensed. Postern's PWA never overrides chainConfig, so this is a fixed
// constant here too.
const CollectionID = "spellforge-leaderboard-testnet"

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

type mintPayload struct {
	Collection string `json:"collection"`
	Holder     string `json:"holder"`
}

type transferPayload struct {
	Origin string `json:"origin"`
	To     string `json:"to"`
}

// Held reports whether address holds a licence: it walks address's own
// transaction history for a type-M record naming address as holder of
// CollectionID, then checks no later type-TR record transfers that mint's
// origin away. The License token is always output 0 of its mint transaction
// (the shape every builder in spell-forge-bsv writes), so a mint's origin is
// its txid at vout 0.
func Held(reader Reader, address string) (bool, error) {
	history, err := reader.GetHistory(address)
	if err != nil {
		return false, fmt.Errorf("getting history for %s: %w", address, err)
	}

	var origin string
	transferred := make(map[string]bool)

	for _, entry := range history {
		txHex, err := reader.GetTransactionHex(entry.TxHash)
		if err != nil {
			return false, fmt.Errorf("getting transaction %s: %w", entry.TxHash, err)
		}

		outputs, err := record.ParseTransactionOutputs(txHex)
		if err != nil {
			continue // an unparseable transaction just yields no records
		}

		for _, out := range outputs {
			typed, ok := record.DecodeTypedScript(out.ScriptHex)
			if !ok {
				continue
			}

			switch typed.RecordType {
			case "M":
				var payload mintPayload
				if json.Unmarshal(typed.PayloadBytes, &payload) != nil {
					continue
				}
				if payload.Collection == CollectionID && payload.Holder == address {
					origin = entry.TxHash + ":0"
				}
			case "TR":
				var payload transferPayload
				if json.Unmarshal(typed.PayloadBytes, &payload) != nil {
					continue
				}
				transferred[payload.Origin] = true
			}
		}
	}

	if origin == "" {
		return false, nil
	}
	return !transferred[origin], nil
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
