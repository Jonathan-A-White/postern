package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/ecdsa"
)

// VerifySignature reports whether sigHex is a valid DER-encoded ECDSA
// signature, by the compressed secp256k1 public key pubKeyHex, over
// sha256(message) — matching @bsv/sdk's PrivateKey.sign(message) (a single
// SHA-256 of the UTF-8 message, not a double hash).
func VerifySignature(pubKeyHex, message, sigHex string) (bool, error) {
	pubKeyBytes, err := hex.DecodeString(pubKeyHex)
	if err != nil {
		return false, fmt.Errorf("decoding public key: %w", err)
	}
	pubKey, err := btcec.ParsePubKey(pubKeyBytes)
	if err != nil {
		return false, fmt.Errorf("parsing public key: %w", err)
	}

	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return false, fmt.Errorf("decoding signature: %w", err)
	}
	sig, err := ecdsa.ParseDERSignature(sigBytes)
	if err != nil {
		return false, fmt.Errorf("parsing signature: %w", err)
	}

	hash := sha256.Sum256([]byte(message))
	return sig.Verify(hash[:], pubKey), nil
}
