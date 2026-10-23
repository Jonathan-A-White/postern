package register

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/licence"
	"github.com/Jonathan-A-White/postern/server/internal/setup"
	"github.com/btcsuite/btcd/btcec/v2"
)

// golden is testdata/site-issuer-golden.json: a mint and a revoke as the TS
// issuer writes them (tests/unit/site-issuer-golden.test.ts keeps it so).
type golden struct {
	IssuerKeyHex    string `json:"issuerKeyHex"`
	HolderPublicKey string `json:"holderPublicKey"`
	Collection      string `json:"collection"`
	MintFuel        int64  `json:"mintFuelSatoshis"`
	FeeRate         int64  `json:"feeRateSatPerKb"`
	Funding         []struct {
		TxID     string `json:"txid"`
		Vout     int    `json:"vout"`
		Satoshis int64  `json:"satoshis"`
	} `json:"funding"`
	Mint struct {
		TxID string `json:"txid"`
		Hex  string `json:"hex"`
	} `json:"mint"`
	Revoke struct {
		Anchor string `json:"anchor"`
		Origin string `json:"origin"`
		Utxos  []struct {
			TxID     string `json:"txid"`
			Vout     int    `json:"vout"`
			Satoshis int64  `json:"satoshis"`
		} `json:"utxos"`
		TxID string `json:"txid"`
		Hex  string `json:"hex"`
	} `json:"revoke"`
}

func loadGolden(t *testing.T) golden {
	t.Helper()
	data, err := os.ReadFile("testdata/site-issuer-golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var g golden
	if err := json.Unmarshal(data, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func goldenKey(t *testing.T, g golden) *btcec.PrivateKey {
	t.Helper()
	raw, err := hex.DecodeString(g.IssuerKeyHex)
	if err != nil {
		t.Fatal(err)
	}
	key, _ := btcec.PrivKeyFromBytes(raw)
	return key
}

func (g golden) fundingUtxos() []chain.Utxo {
	var out []chain.Utxo
	for _, f := range g.Funding {
		out = append(out, chain.Utxo{TxHash: f.TxID, TxPos: f.Vout, Value: f.Satoshis, Height: 100})
	}
	return out
}

func (g golden) revokeUtxos() []chain.Utxo {
	var out []chain.Utxo
	for _, u := range g.Revoke.Utxos {
		out = append(out, chain.Utxo{TxHash: u.TxID, TxPos: u.Vout, Value: u.Satoshis, Height: 100})
	}
	return out
}

func TestTheChainConstantsAreTheTSIssuers(t *testing.T) {
	g := loadGolden(t)
	if g.MintFuel != MintFuelSatoshis || g.FeeRate != FeeRateSatPerKb || g.Collection != LampasCollection {
		t.Fatalf("fixture fuel %d rate %d collection %q; Go has %d %d %q", g.MintFuel, g.FeeRate, g.Collection, MintFuelSatoshis, FeeRateSatPerKb, LampasCollection)
	}
}

func TestTheMintIsTheTSIssuersByteForByte(t *testing.T) {
	g := loadGolden(t)
	holder, _ := hex.DecodeString(g.HolderPublicKey)
	tx, err := buildMint(goldenKey(t, g), coinsOf(g.fundingUtxos()), holder, g.Collection)
	if err != nil {
		t.Fatalf("buildMint: %v", err)
	}
	if got := tx.hex(); got != g.Mint.Hex {
		t.Fatalf("mint differs from the TS issuer's:\n got %s\nwant %s", got, g.Mint.Hex)
	}
	if tx.txid() != g.Mint.TxID {
		t.Fatalf("txid %s, want %s", tx.txid(), g.Mint.TxID)
	}
}

func TestTheRevokeIsTheTSIssuersByteForByte(t *testing.T) {
	g := loadGolden(t)
	tx, err := buildRevoke(goldenKey(t, g), coinsOf(g.revokeUtxos()), g.Revoke.Origin, g.Revoke.Anchor)
	if err != nil {
		t.Fatalf("buildRevoke: %v", err)
	}
	if got := tx.hex(); got != g.Revoke.Hex {
		t.Fatalf("revoke differs from the TS issuer's:\n got %s\nwant %s", got, g.Revoke.Hex)
	}
	if tx.txid() != g.Revoke.TxID {
		t.Fatalf("txid %s, want %s", tx.txid(), g.Revoke.TxID)
	}
}

// fakeChain is WhatsOnChain for the issuer: a fixed coin list for the site
// address, a balance, and every broadcast kept.
type fakeChain struct {
	mu           sync.Mutex
	utxos        []chain.Utxo
	balance      int64
	broadcasts   []string
	broadcastErr error
}

func (f *fakeChain) GetUtxos(string) ([]chain.Utxo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]chain.Utxo(nil), f.utxos...), nil
}

func (f *fakeChain) GetBalance(string) (chain.Balance, error) {
	return chain.Balance{Confirmed: f.balance}, nil
}

func (f *fakeChain) Broadcast(rawTxHex string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.broadcastErr != nil {
		return "", f.broadcastErr
	}
	f.broadcasts = append(f.broadcasts, rawTxHex)
	return txidOfHex(rawTxHex), nil
}

func (f *fakeChain) sent() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.broadcasts...)
}

func txidOfHex(rawHex string) string {
	raw, _ := hex.DecodeString(rawHex)
	first := sha256.Sum256(raw)
	second := sha256.Sum256(first[:])
	for i, j := 0, len(second)-1; i < j; i, j = i+1, j-1 {
		second[i], second[j] = second[j], second[i]
	}
	return hex.EncodeToString(second[:])
}

// parsed is a broadcast transaction as the tests read it.
type parsed struct {
	inputs  []parsedInput
	outputs []parsedOutput
}

type parsedInput struct {
	txid   string
	vout   uint32
	pushes [][]byte
}

type parsedOutput struct {
	value  int64
	script []byte
}

func parseTx(t *testing.T, rawHex string) parsed {
	t.Helper()
	raw, err := hex.DecodeString(rawHex)
	if err != nil {
		t.Fatal(err)
	}
	r := bytes.NewReader(raw)
	read := func(n int) []byte {
		b := make([]byte, n)
		if _, err := r.Read(b); err != nil {
			t.Fatalf("short transaction: %v", err)
		}
		return b
	}
	varint := func() int {
		b := read(1)[0]
		switch b {
		case 0xfd:
			return int(binary.LittleEndian.Uint16(read(2)))
		case 0xfe:
			return int(binary.LittleEndian.Uint32(read(4)))
		case 0xff:
			return int(binary.LittleEndian.Uint64(read(8)))
		}
		return int(b)
	}
	var tx parsed
	read(4)
	for n := varint(); n > 0; n-- {
		prev := read(32)
		for i, j := 0, 31; i < j; i, j = i+1, j-1 {
			prev[i], prev[j] = prev[j], prev[i]
		}
		vout := binary.LittleEndian.Uint32(read(4))
		script := read(varint())
		read(4)
		tx.inputs = append(tx.inputs, parsedInput{txid: hex.EncodeToString(prev), vout: vout, pushes: pushesOf(script)})
	}
	for n := varint(); n > 0; n-- {
		value := int64(binary.LittleEndian.Uint64(read(8)))
		tx.outputs = append(tx.outputs, parsedOutput{value: value, script: read(varint())})
	}
	return tx
}

// pushesOf is the data a script pushes (direct pushes and PUSHDATA1/2 only).
func pushesOf(script []byte) [][]byte {
	var out [][]byte
	for i := 0; i < len(script); {
		op := script[i]
		i++
		n := 0
		switch {
		case op >= 1 && op < 0x4c:
			n = int(op)
		case op == 0x4c:
			n = int(script[i])
			i++
		case op == 0x4d:
			n = int(binary.LittleEndian.Uint16(script[i:]))
			i += 2
		default:
			continue
		}
		out = append(out, script[i:i+n])
		i += n
	}
	return out
}

// record is a typed record output's type and JSON payload, or "" when the
// output is none.
func record(out parsedOutput) (string, map[string]string) {
	if len(out.script) < 2 || out.script[0] != 0x00 || out.script[1] != 0x6a {
		return "", nil
	}
	pushes := pushesOf(out.script[2:])
	if len(pushes) != 5 || string(pushes[0]) != "nftgate" {
		return "", nil
	}
	var payload map[string]string
	_ = json.Unmarshal(pushes[4], &payload)
	return string(pushes[2]), payload
}

func signedByKey(tx parsed, pub []byte) bool {
	for _, in := range tx.inputs {
		if len(in.pushes) == 2 && bytes.Equal(in.pushes[1], pub) {
			return true
		}
	}
	return false
}

func newIssuingService(t *testing.T, key *btcec.PrivateKey, c *fakeChain) (*Service, *Issuer, string) {
	t.Helper()
	issuer, err := NewIssuer(key, "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5", c)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	dir := t.TempDir()
	// These tests join one phone more often than an hour's send limit lets
	// a phone have codes: they are about issuing, not the limit.
	s, err := Open(dir, WithVerifier(&fakeVerifier{}), WithIssuer(issuer), WithSendLimits(10, 10, 0))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return s, issuer, dir
}

// AC1: confirm issues one mint to the device key, signed by the site key, the
// very bytes the TS issuer writes, and the device keeps its txid.
func TestConfirmIssuesTheTSIssuersMintToTheDeviceAndKeepsItsTxid(t *testing.T) {
	g := loadGolden(t)
	c := &fakeChain{utxos: g.fundingUtxos()}
	s, issuer, dir := newIssuingService(t, goldenKey(t, g), c)

	res, err := register(t, s, email1, phone1, g.HolderPublicKey)
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	sent := c.sent()
	if len(sent) != 1 {
		t.Fatalf("broadcast %d transactions, want one mint", len(sent))
	}
	if sent[0] != g.Mint.Hex {
		t.Fatalf("the mint is not the TS issuer's:\n got %s\nwant %s", sent[0], g.Mint.Hex)
	}
	tx := parseTx(t, sent[0])
	holderAddress, _ := licence.AddressForPublicKey(g.HolderPublicKey)
	kind, payload := record(tx.outputs[2])
	if kind != "M" || payload["collection"] != "lampas" || payload["holder"] != holderAddress {
		t.Fatalf("record %q %v, want M naming %s in lampas", kind, payload, holderAddress)
	}
	pub, _ := hex.DecodeString(issuer.PublicKey())
	if !signedByKey(tx, pub) {
		t.Fatal("the mint is not signed by the site key")
	}
	if !res.Issued || len(res.Devices) != 1 || res.Devices[0].LicenceTxid != g.Mint.TxID {
		t.Fatalf("result = %+v, want issued with the mint's txid on the device", res)
	}

	reopened, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.people.byKey[g.HolderPublicKey].Devices[0].LicenceTxid; got != g.Mint.TxID {
		t.Fatalf("stored txid %q, want %s", got, g.Mint.TxID)
	}
}

// A confirm again from a device that holds its licence issues nothing more.
func TestAKnownLicensedDeviceIsNotIssuedTwice(t *testing.T) {
	g := loadGolden(t)
	c := &fakeChain{utxos: g.fundingUtxos()}
	s, _, _ := newIssuingService(t, goldenKey(t, g), c)
	if _, err := register(t, s, email1, phone1, realKey(0)); err != nil {
		t.Fatal(err)
	}
	res, err := register(t, s, email1, phone1, realKey(0))
	if err != nil {
		t.Fatal(err)
	}
	if n := len(c.sent()); n != 1 || !res.Issued {
		t.Fatalf("broadcasts %d, issued %v; want the one mint, still issued", n, res.Issued)
	}
}

// A failed broadcast stores nothing and keeps the registration, so a retry
// needs no new codes.
func TestAFailedIssueKeepsTheRegistrationForARetry(t *testing.T) {
	g := loadGolden(t)
	c := &fakeChain{utxos: g.fundingUtxos(), broadcastErr: &chain.ProviderError{Provider: "WhatsOnChain", Status: 503}}
	s, _, _ := newIssuingService(t, goldenKey(t, g), c)
	id, err := s.Start(context.Background(), email1, phone1, realKey(0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Confirm(context.Background(), id, emailCode, phoneCode, ""); !errors.Is(err, ErrIssue) {
		t.Fatalf("Confirm = %v, want ErrIssue", err)
	}
	if _, ok := s.Person(realKey(0)); ok {
		t.Fatal("a device whose licence was not issued was stored")
	}
	c.broadcastErr = nil
	res, err := s.Confirm(context.Background(), id, "", "", "")
	if err != nil || !res.Issued {
		t.Fatalf("retry = %+v, %v; want issued with the codes already proven", res, err)
	}
}

// AC2: removing a device revokes its licence with the site key, drops it, and
// a sixth device then joins.
func TestRemovingADeviceRevokesItsLicenceAndFreesTheSlot(t *testing.T) {
	key, _ := btcec.NewPrivateKey()
	c := &fakeChain{utxos: []chain.Utxo{{TxHash: strings.Repeat("ab", 32), TxPos: 0, Value: 1_000_000, Height: 100}}}
	s, issuer, _ := newIssuingService(t, key, c)
	var first Result
	for n := byte(0); n < 5; n++ {
		res, err := register(t, s, email1, phone1, realKey(n))
		if err != nil {
			t.Fatalf("device %d: %v", n, err)
		}
		first = res
	}
	if _, err := register(t, s, email1, phone1, realKey(5)); !errors.Is(err, ErrFull) {
		t.Fatalf("sixth = %v, want ErrFull", err)
	}
	mints := c.sent()
	if len(mints) != 5 {
		t.Fatalf("%d mints, want 5", len(mints))
	}
	// Each mint spends the one before's change: the list never shows it here.
	for i := 1; i < 5; i++ {
		if in := parseTx(t, mints[i]).inputs; len(in) != 1 || in[0].txid != txidOfHex(mints[i-1]) {
			t.Fatalf("mint %d spends %+v, want the change of mint %d", i, in, i-1)
		}
	}
	removed := first.Devices[1]

	res, err := s.RemoveDevice(first.PersonID, realKey(0), removed.Key)
	if err != nil {
		t.Fatalf("RemoveDevice: %v", err)
	}
	sent := c.sent()
	if len(sent) != 6 {
		t.Fatalf("%d broadcasts, want the 5 mints and a revoke", len(sent))
	}
	revoke := parseTx(t, sent[5])
	kind, payload := record(revoke.outputs[0])
	if kind != "W" || payload["kind"] != "revoke" || payload["origin"] != removed.LicenceTxid+":0" {
		t.Fatalf("record %q %v, want a revoke of %s:0", kind, payload, removed.LicenceTxid)
	}
	pub, _ := hex.DecodeString(issuer.PublicKey())
	if !signedByKey(revoke, pub) {
		t.Fatal("the revoke is not signed by the site key")
	}
	if len(res.Devices) != 4 {
		t.Fatalf("devices %+v, want four left", res.Devices)
	}
	if _, ok := s.Person(removed.Key); ok {
		t.Fatal("the removed key still belongs to the person")
	}
	if _, err := register(t, s, email1, phone1, realKey(5)); err != nil {
		t.Fatalf("sixth device after a removal: %v", err)
	}
}

// The revoke a removal broadcasts is the TS issuer's, byte for byte.
func TestTheRevokeARemovalBroadcastsIsTheTSIssuers(t *testing.T) {
	g := loadGolden(t)
	c := &fakeChain{utxos: g.fundingUtxos()}
	s, _, _ := newIssuingService(t, goldenKey(t, g), c)
	res, err := register(t, s, email1, phone1, g.HolderPublicKey)
	if err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	c.utxos = g.revokeUtxos() // the chain now lists the mint's change and two more
	c.mu.Unlock()
	s.issuer.(*Issuer).anchor = g.Revoke.Anchor
	if _, err := s.RemoveDevice(res.PersonID, g.HolderPublicKey, g.HolderPublicKey); err != nil {
		t.Fatalf("RemoveDevice: %v", err)
	}
	if sent := c.sent(); len(sent) != 2 || sent[1] != g.Revoke.Hex {
		t.Fatalf("revoke is not the TS issuer's:\n got %v\nwant %s", sent[1:], g.Revoke.Hex)
	}
}

func TestOnlyADeviceOfTheSamePersonMayRemoveOne(t *testing.T) {
	key, _ := btcec.NewPrivateKey()
	c := &fakeChain{utxos: []chain.Utxo{{TxHash: strings.Repeat("ab", 32), TxPos: 0, Value: 1_000_000, Height: 100}}}
	s, _, _ := newIssuingService(t, key, c)
	ada, err := register(t, s, email1, phone1, realKey(0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := register(t, s, email3, phone2, realKey(5)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RemoveDevice(ada.PersonID, realKey(5), realKey(0)); !errors.Is(err, ErrNotYours) {
		t.Fatalf("another person's device removing = %v, want ErrNotYours", err)
	}
	if _, err := s.RemoveDevice(ada.PersonID, realKey(0), realKey(5)); !errors.Is(err, ErrNoDevice) {
		t.Fatalf("removing another person's device = %v, want ErrNoDevice", err)
	}
	if n := len(c.sent()); n != 2 {
		t.Fatalf("%d broadcasts, want only the two mints", n)
	}
}

// AC3: without the site key registration answers 'licensed by hand'.
func TestWithoutASiteIssuerRegistrationIsLicensedByHand(t *testing.T) {
	s, err := Open(t.TempDir(), WithVerifier(&fakeVerifier{}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(context.Background(), email1, phone1, realKey(0)); !errors.Is(err, ErrByHand) {
		t.Fatalf("Start = %v, want ErrByHand", err)
	}
	if _, err := s.Confirm(context.Background(), "any", emailCode, phoneCode, ""); !errors.Is(err, ErrByHand) {
		t.Fatalf("Confirm = %v, want ErrByHand", err)
	}
	if ErrByHand.Error() != "licensed by hand: ask the Governor" {
		t.Fatalf("message %q", ErrByHand.Error())
	}
}

func TestLowBalanceIsOneWarningLine(t *testing.T) {
	key, _ := btcec.NewPrivateKey()
	for _, tc := range []struct {
		balance int64
		want    string
	}{
		{10*MintCostSatoshis - 1, "site issuer low: 100079"},
		{10 * MintCostSatoshis, ""},
	} {
		issuer, err := NewIssuer(key, "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5", &fakeChain{balance: tc.balance})
		if err != nil {
			t.Fatal(err)
		}
		var lines []string
		issuer.WarnIfLow(func(format string, args ...any) {
			lines = append(lines, strings.TrimSpace(fmt.Sprintf(format, args...)))
		})
		if tc.want == "" && len(lines) != 0 || tc.want != "" && (len(lines) != 1 || lines[0] != tc.want) {
			t.Fatalf("balance %d logged %q, want %q", tc.balance, lines, tc.want)
		}
	}
}

// AC5: neither form of the site key is ever logged, through every path that
// logs: a mint, a refused broadcast, a revoke, the balance warning.
func TestTheSiteKeyNeverAppearsInTheLog(t *testing.T) {
	k := setup.NewKey()
	wif := k.WIF()
	key, err := setup.ParseWIF(wif)
	if err != nil {
		t.Fatal(err)
	}
	secretHex := hex.EncodeToString(key.Serialize())

	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)

	c := &fakeChain{utxos: []chain.Utxo{{TxHash: strings.Repeat("ab", 32), TxPos: 0, Value: 1_000_000, Height: 100}}, balance: 5}
	s, issuer, _ := newIssuingService(t, key, c)
	issuer.WarnIfLow(log.Printf)
	res, err := register(t, s, email1, phone1, realKey(0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RemoveDevice(res.PersonID, realKey(0), realKey(0)); err != nil {
		t.Fatal(err)
	}
	c.broadcastErr = &chain.ProviderError{Provider: "WhatsOnChain", Status: 500, Body: "mempool conflict"}
	if _, err := register(t, s, email1, phone1, realKey(1)); !errors.Is(err, ErrIssue) {
		t.Fatalf("Confirm = %v, want ErrIssue", err)
	}
	poor := &fakeChain{}
	poorIssuer, _ := NewIssuer(key, "mt6vaAWeFxu2qC6pPs7bsqTNvv87dCwMW5", poor)
	if _, err := poorIssuer.Issue(realKey(2)); err == nil {
		t.Fatal("issued with no coins")
	}

	logged := buf.String()
	if !strings.Contains(logged, "site issuer low") {
		t.Fatalf("the log has no low-balance line, so this test saw no log at all:\n%s", logged)
	}
	for _, secret := range []string{wif, secretHex, strings.ToUpper(secretHex)} {
		if strings.Contains(logged, secret) {
			t.Fatalf("the log carries the site key:\n%s", logged)
		}
	}
}

// realKey is a device key on the curve (deviceKey's are not, and the real
// issuer will not mint to one).
func realKey(n byte) string {
	key, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x40 + n}, 32))
	return hex.EncodeToString(key.PubKey().SerializeCompressed())
}
