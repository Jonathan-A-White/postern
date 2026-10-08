package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"net/http"
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/auth"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
	"github.com/btcsuite/btcd/btcec/v2"
	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // a P2PKH output locks to RIPEMD-160(SHA-256(key)).
)

// chainFake is a licence.Reader over a few hand-built transactions:
// address -> history, txid -> raw hex.
type chainFake struct {
	history map[string][]woc.HistoryEntry
	txs     map[string]string
}

func (c *chainFake) GetHistory(address string) ([]woc.HistoryEntry, error) {
	return c.history[address], nil
}

func (c *chainFake) GetTransactionHex(txid string) (string, error) { return c.txs[txid], nil }

// add puts a transaction on chain in address's history and returns its txid.
func (c *chainFake) add(address, txHex string) string {
	txid := c.put(txHex)
	c.history[address] = append(c.history[address], woc.HistoryEntry{TxHash: txid, Height: 100 + len(c.history[address])})
	return txid
}

// put puts a transaction on chain in no history and returns its txid.
func (c *chainFake) put(txHex string) string {
	txid := txidOf(txHex)
	c.txs[txid] = txHex
	return txid
}

// txidOf is a raw transaction's txid, in display order.
func txidOf(txHex string) string {
	raw, _ := hex.DecodeString(txHex)
	first := sha256.Sum256(raw)
	second := sha256.Sum256(first[:])
	for i, j := 0, len(second)-1; i < j; i, j = i+1, j-1 {
		second[i], second[j] = second[j], second[i]
	}
	return hex.EncodeToString(second[:])
}

// typedScript is a typed record's locking script (docs/protocol.md §16's
// nftgate layout): OP_FALSE OP_RETURN 'nftgate' 0x02 <type> 0x00 <payload>.
func typedScript(recordType, payload string) []byte {
	script := []byte{0x00, 0x6a}
	for _, part := range [][]byte{[]byte("nftgate"), {0x02}, []byte(recordType), {0x00}, []byte(payload)} {
		script = append(script, pushBytes(part)...)
	}
	return script
}

// fundingTx is the transaction that paid signer the coin signedTx(signer,
// funding, ...) spends: its output 0 is P2PKH to signer's key. Put it on
// chain (chainFake.put) for the licence rule to see signer signed.
func fundingTx(signer *btcec.PrivateKey, funding byte) string {
	keyHash := ripemd160.New()
	sha := sha256.Sum256(signer.PubKey().SerializeCompressed())
	keyHash.Write(sha[:])
	lock := append(append([]byte{0x76, 0xa9, 0x14}, keyHash.Sum(nil)...), 0x88, 0xac)
	return rawTx(bytes.Repeat([]byte{funding}, 32), []byte{0x51}, lock)
}

// signedTx is a one-input transaction whose P2PKH scriptSig names signer,
// spending output 0 of fundingTx(signer, funding), with the given output
// scripts.
func signedTx(signer *btcec.PrivateKey, funding byte, outputs ...[]byte) string {
	prev, _ := hex.DecodeString(txidOf(fundingTx(signer, funding)))
	for i, j := 0, len(prev)-1; i < j; i, j = i+1, j-1 {
		prev[i], prev[j] = prev[j], prev[i]
	}
	sig := append(bytes.Repeat([]byte{0x30}, 70), 0x41)
	return rawTx(prev, append(pushBytes(sig), pushBytes(signer.PubKey().SerializeCompressed())...), outputs...)
}

// rawTx is a one-input transaction spending output 0 of the transaction
// whose txid in internal byte order is prev, with the given output scripts.
func rawTx(prev, scriptSig []byte, outputs ...[]byte) string {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(1))
	buf.WriteByte(1)
	buf.Write(prev)
	binary.Write(&buf, binary.LittleEndian, uint32(0))
	buf.WriteByte(byte(len(scriptSig)))
	buf.Write(scriptSig)
	binary.Write(&buf, binary.LittleEndian, uint32(0xffffffff))
	buf.WriteByte(byte(len(outputs)))
	for _, script := range outputs {
		binary.Write(&buf, binary.LittleEndian, uint64(1))
		if len(script) < 0xfd {
			buf.WriteByte(byte(len(script)))
		} else { // a gated M's script runs past 252 bytes
			buf.WriteByte(0xfd)
			binary.Write(&buf, binary.LittleEndian, uint16(len(script)))
		}
		buf.Write(script)
	}
	binary.Write(&buf, binary.LittleEndian, uint32(0))
	return hex.EncodeToString(buf.Bytes())
}

func TestMeAnswers401OnceTheIssuerRevokedTheKeysLicence(t *testing.T) {
	issuer, _ := newKey(t)
	issuerHex := hex.EncodeToString(issuer.PubKey().SerializeCompressed())
	issuerAddress, _ := licence.AddressForPublicKey(issuerHex)
	holder, holderHex := newKey(t)
	holderAddress, _ := licence.AddressForPublicKey(holderHex)

	chain := &chainFake{history: map[string][]woc.HistoryEntry{}, txs: map[string]string{}}
	chain.put(fundingTx(issuer, 0xf1))
	chain.put(fundingTx(issuer, 0xe1))
	mintID := chain.add(issuerAddress, signedTx(issuer, 0xf1,
		bytes.Repeat([]byte{0x7e}, 10), bytes.Repeat([]byte{0x7c}, 10),
		typedScript("M", `{"collection":"postern","holder":"`+holderAddress+`"}`)))

	meStatus := func() int {
		checker := auth.NewCachedChecker(chain, time.Minute, auth.WithRule(licence.Rule{IssuerKey: issuerHex}))
		server, _, _, _ := newTestServerWithChecker(t, http.NotFound, checker)
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/me", nil)
		signRequest(t, server, holder, req)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("GET /api/me: %v", err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}

	if got := meStatus(); got != http.StatusOK {
		t.Fatalf("GET /api/me with the issuer's licence: status %d, want 200", got)
	}
	chain.add(issuerAddress, signedTx(issuer, 0xe1,
		typedScript("W", `{"kind":"revoke","origin":"`+mintID+`:0"}`)))
	if got := meStatus(); got != http.StatusUnauthorized {
		t.Fatalf("GET /api/me after the issuer revoked the licence: status %d, want 401", got)
	}
}
