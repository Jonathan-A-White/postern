// Package setup is `postern setup` and `postern keygen`: it makes a second
// (third, ...) backend for another Linux user on the same host, and the keys
// that backend needs (docs/second-backend.md).
package setup

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"

	"github.com/btcsuite/btcd/btcec/v2"
)

// testnetWIFVersion is the WIF version byte of a testnet private key, the
// network mw's postern key file is on.
const testnetWIFVersion = 0xef

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// Key is a secp256k1 key pair.
type Key struct{ priv *btcec.PrivateKey }

// NewKey makes a fresh key.
func NewKey() Key {
	priv, err := btcec.NewPrivateKey()
	if err != nil {
		panic(fmt.Sprintf("generating a secp256k1 key: %v", err)) // crypto/rand failed: nothing sensible to do
	}
	return Key{priv: priv}
}

// Public is the compressed public key, hex: what POSTERN_MAYOR_KEY and
// POSTERN_MILL_KEY name.
func (k Key) Public() string { return hex.EncodeToString(k.priv.PubKey().SerializeCompressed()) }

// WIF is the private key, testnet WIF-encoded with the compressed flag: the
// form mw keeps in its postern key file.
func (k Key) WIF() string { return wifOf(k.priv) }

func wifOf(priv *btcec.PrivateKey) string {
	payload := append(priv.Serialize(), 0x01)
	return base58Check(testnetWIFVersion, payload)
}

// ParseWIF reads a testnet compressed WIF private key.
func ParseWIF(wif string) (*btcec.PrivateKey, error) {
	raw, err := base58CheckDecode(wif)
	if err != nil {
		return nil, err
	}
	if len(raw) != 34 || raw[0] != testnetWIFVersion || raw[33] != 0x01 {
		return nil, fmt.Errorf("not a testnet compressed WIF private key")
	}
	priv, _ := btcec.PrivKeyFromBytes(raw[1:33])
	return priv, nil
}

func checksum(data []byte) []byte {
	first := sha256.Sum256(data)
	second := sha256.Sum256(first[:])
	return second[:4]
}

func base58Check(version byte, payload []byte) string {
	input := append([]byte{version}, payload...)
	input = append(input, checksum(input)...)

	zeros := 0
	for _, b := range input {
		if b != 0 {
			break
		}
		zeros++
	}
	x := new(big.Int).SetBytes(input)
	base, mod := big.NewInt(58), new(big.Int)
	var out []byte
	for x.Sign() > 0 {
		x.DivMod(x, base, mod)
		out = append(out, base58Alphabet[mod.Int64()])
	}
	for i := 0; i < zeros; i++ {
		out = append(out, base58Alphabet[0])
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return string(out)
}

// base58CheckDecode answers version || payload, the checksum verified and cut.
func base58CheckDecode(s string) ([]byte, error) {
	x := new(big.Int)
	base := big.NewInt(58)
	for _, c := range s {
		i := bytes.IndexRune([]byte(base58Alphabet), c)
		if i < 0 {
			return nil, fmt.Errorf("%q is not base58", s)
		}
		x.Mul(x, base)
		x.Add(x, big.NewInt(int64(i)))
	}
	raw := x.Bytes()
	for _, c := range s {
		if c != rune(base58Alphabet[0]) {
			break
		}
		raw = append([]byte{0}, raw...)
	}
	if len(raw) < 5 || !bytes.Equal(checksum(raw[:len(raw)-4]), raw[len(raw)-4:]) {
		return nil, fmt.Errorf("bad base58 checksum")
	}
	return raw[:len(raw)-4], nil
}

// WriteKey makes a fresh key and writes its WIF to path, 0600 in a 0700
// directory it makes. It refuses a path that is already there.
func WriteKey(path string) (Key, error) {
	k := NewKey()
	if err := writeNew(path, k.WIF()+"\n", 0o700, 0o600); err != nil {
		if _, statErr := os.Lstat(path); statErr == nil {
			return Key{}, fmt.Errorf("%s is already there: keygen will not overwrite a key", path)
		}
		return Key{}, err
	}
	return k, nil
}
