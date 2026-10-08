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

// The v2 message is one string: the scheme tag, the method, the request
// target exactly as sent, the body's SHA-256 in hex and the nonce, one per
// line (docs/api.md, mw-xhtcup.7).
func TestMessageV2JoinsMethodRawTargetBodyHashAndNonce(t *testing.T) {
	got := MessageV2("POST", "/api/blobs/%61b?x=1&y=a+b", []byte("abc"), "the-nonce")
	want := "postern-v2\nPOST\n/api/blobs/%61b?x=1&y=a+b\n" +
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\nthe-nonce"
	if got != want {
		t.Fatalf("MessageV2 = %q, want %q", got, want)
	}
}

func TestMessageV2HashesAnAbsentBodyAsTheEmptyString(t *testing.T) {
	want := "postern-v2\nGET\n/api/events\n" +
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nn"
	for _, body := range [][]byte{nil, {}} {
		if got := MessageV2("GET", "/api/events", body, "n"); got != want {
			t.Fatalf("MessageV2(body %v) = %q, want %q", body, got, want)
		}
	}
}

func TestAV2SignatureVerifiesOnlyOverTheRequestItSigned(t *testing.T) {
	privKey, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatalf("NewPrivateKey: %v", err)
	}
	pubKeyHex := hex.EncodeToString(privKey.PubKey().SerializeCompressed())
	sigHex := signMessage(t, privKey, MessageV2("POST", "/api/messages", []byte("{}"), "n1"))

	if ok, _ := VerifySignature(pubKeyHex, MessageV2("POST", "/api/messages", []byte("{}"), "n1"), sigHex); !ok {
		t.Fatal("the signed request did not verify")
	}
	for name, msg := range map[string]string{
		"method": MessageV2("PUT", "/api/messages", []byte("{}"), "n1"),
		"target": MessageV2("POST", "/api/messages?x=1", []byte("{}"), "n1"),
		"body":   MessageV2("POST", "/api/messages", []byte("{ }"), "n1"),
		"nonce":  MessageV2("POST", "/api/messages", []byte("{}"), "n2"),
		"v1":     "n1",
	} {
		if ok, _ := VerifySignature(pubKeyHex, msg, sigHex); ok {
			t.Errorf("a different %s verified", name)
		}
	}
}
