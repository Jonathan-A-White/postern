package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/ecdsa"
)

func signMessage(t *testing.T, privKey *btcec.PrivateKey, message string) string {
	t.Helper()
	hash := sha256.Sum256([]byte(message))
	sig := ecdsa.Sign(privKey, hash[:])
	return hex.EncodeToString(sig.Serialize())
}

func TestVerifySignatureAcceptsAValidSignature(t *testing.T) {
	privKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("NewPrivateKey: %v", err)
	}
	pubKeyHex := hex.EncodeToString(privKey.PubKey().SerializeCompressed())
	sigHex := signMessage(t, privKey, "the-nonce")

	valid, err := VerifySignature(pubKeyHex, "the-nonce", sigHex)
	if err != nil {
		t.Fatalf("VerifySignature: %v", err)
	}
	if !valid {
		t.Fatal("valid = false, want true for a correctly signed message")
	}
}

func TestVerifySignatureRejectsWrongMessage(t *testing.T) {
	privKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("NewPrivateKey: %v", err)
	}
	pubKeyHex := hex.EncodeToString(privKey.PubKey().SerializeCompressed())
	sigHex := signMessage(t, privKey, "the-nonce")

	valid, err := VerifySignature(pubKeyHex, "a-different-nonce", sigHex)
	if err != nil {
		t.Fatalf("VerifySignature: %v", err)
	}
	if valid {
		t.Fatal("valid = true, want false for a signature over a different message")
	}
}

func TestVerifySignatureRejectsWrongKey(t *testing.T) {
	privKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("NewPrivateKey: %v", err)
	}
	otherKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("NewPrivateKey: %v", err)
	}
	otherPubKeyHex := hex.EncodeToString(otherKey.PubKey().SerializeCompressed())
	sigHex := signMessage(t, privKey, "the-nonce")

	valid, err := VerifySignature(otherPubKeyHex, "the-nonce", sigHex)
	if err != nil {
		t.Fatalf("VerifySignature: %v", err)
	}
	if valid {
		t.Fatal("valid = true, want false for a signature by a different key")
	}
}

func TestVerifySignatureRejectsMalformedPublicKey(t *testing.T) {
	if _, err := VerifySignature("not-hex", "the-nonce", "aa"); err == nil {
		t.Fatal("expected an error for a malformed public key")
	}
}

func TestVerifySignatureRejectsMalformedSignature(t *testing.T) {
	privKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("NewPrivateKey: %v", err)
	}
	pubKeyHex := hex.EncodeToString(privKey.PubKey().SerializeCompressed())

	if _, err := VerifySignature(pubKeyHex, "the-nonce", "not-hex"); err == nil {
		t.Fatal("expected an error for a malformed signature")
	}
}
