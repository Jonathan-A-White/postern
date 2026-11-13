package alerts

import (
	"strings"
	"testing"
)

// A pump's $1.00 pre-authorisation is a hold, not a charge to sort (mw-mr4xgrw.49). The rule is
// exactly $1.00 at a fuel seller; each line of the table is one merchant and what the rule calls it.
func TestAPumpHoldIsExactlyOneDollarAtAFuelSeller(t *testing.T) {
	for _, tc := range []struct {
		amount, merchant string
		hold             bool
	}{
		// the word GAS or FUEL, as a whole word, any case, anywhere in the name
		{"1.00", "COSTCO GAS #0304 BROOKFIELD US", true},
		{"1.00", "Costco Gas 0304", true},
		{"1.00", "SAMS FUEL CENTER", true},
		{"1.00", "GAS-N-GO 12", true},
		{"1.00", "Quick Fuel", true},
		// a pump brand, at the start, whole or followed by digits or punctuation
		{"1.00", "SHELL OIL 57444212345", true},
		{"1.00", "SHELL12345678", true},
		{"1.00", "EXXON 4123", true},
		{"1.00", "EXXONMOBIL 4123", true},
		{"1.00", "MOBIL #44", true},
		{"1.00", "BP#1234567", true},
		{"1.00", "BP 1234567", true},
		{"1.00", "  sunoco 0891", true},
		{"1.00", "CITGO 66", true},
		{"1.00", "GULF OIL 21", true},
		{"1.00", "VALERO 7", true},
		{"1.00", "CHEVRON 0012", true},
		{"1.00", "SPEEDWAY 9021", true},
		{"1.00", "CUMBERLAND FARMS 1019", true},
		// the amount may be written as the store or a card mail writes it
		{"$1.00", "COSTCO GAS #0304", true},
		{"1", "COSTCO GAS #0304", true},
		{"1.0", "COSTCO GAS #0304", true},
		// any other amount at a fuel seller is a charge
		{"41.27", "COSTCO GAS #0304 BROOKFIELD US", false},
		{"1.01", "COSTCO GAS #0304", false},
		{"0.99", "COSTCO GAS #0304", false},
		{"10.00", "COSTCO GAS #0304", false},
		{"", "COSTCO GAS #0304", false},
		// $1.00 anywhere else is a charge
		{"1.00", "Example Market 0001", false},
		{"1.00", "", false},
		{"1.00", "COSTCO WHOLESALE #0304", false},
		{"1.00", "GASTON'S DINER", false},
		{"1.00", "SHELLEY'S BAKERY", false},
		{"1.00", "BPX ENERGY SERVICES", false},
		{"1.00", "THE SHELL SHOP", false},
		{"1.00", "FUELING STATION CAFE", false},
		{"1.00", "GULFSTREAM CAFE", false},
		{"1.00", "AMAZON MKTPLACE PMTS", false},
	} {
		t.Run(tc.amount+" "+tc.merchant, func(t *testing.T) {
			if got := IsPumpHold(tc.amount, tc.merchant); got != tc.hold {
				t.Fatalf("IsPumpHold(%q, %q) = %v, want %v", tc.amount, tc.merchant, got, tc.hold)
			}
		})
	}
}

func TestAHoldIsAKindTheStoreTakesAndKeeps(t *testing.T) {
	dir, c := t.TempDir(), newClock()
	s := openStore(t, dir, c)
	token, _ := s.Address("family-a")
	added, _, err := s.Add(token, Alert{Kind: KindHold, Amount: "1.00", Merchant: "COSTCO GAS #0304 BROOKFIELD US", Last4: "5678", When: "2026-11-08T13:01:00-05:00"})
	if err != nil {
		t.Fatalf("Add a hold: %v", err)
	}
	if got := openStore(t, dir, c).List("family-a", 0); len(got) != 1 || got[0] != added || got[0].Kind != "hold" {
		t.Fatalf("after a restart: %+v, want the hold %+v", got, added)
	}
}

// A Google Pay card check: Google asks the card for $1.00 to see it is good, the alert says
// GOOGLE*GPAY TEMP, and it never posts as $1.00 (mw-6ww.148.43; Trade Tracker's mw-6ww.148.42). It is a
// hold too, and IsHold is the one rule both call sites ask: the pump's and this one. Each line of the
// table is one merchant and what the rule calls it.
func TestAHoldIsExactlyOneDollarAtAPumpOrAtGooglePayTemp(t *testing.T) {
	for _, tc := range []struct {
		amount, merchant string
		hold             bool
	}{
		// a Google Pay card check, any case, spaced or punctuated as a bank writes it
		{"1.00", "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", true},
		{"1.00", "GOOGLE*GPAY TEMP", true},
		{"1.00", "google*gpay temp mountain view", true},
		{"1.00", "GOOGLE *GPAY TEMP", true},
		{"$1.00", "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", true},
		{"1", "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", true},
		// a pump's hold is still a hold
		{"1.00", "COSTCO GAS #0304 BROOKFIELD US", true},
		{"1.00", "SHELL OIL 57444212345", true},
		// a real charge from the same card is a charge
		{"12.99", "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", false},
		{"1.01", "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", false},
		{"", "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", false},
		// $1.00 at an ordinary shop, or at Google for something else, is a charge
		{"1.00", "TEMPE MARKET", false},
		{"1.00", "TEMPE MARKET MOUNTAIN VIEW USA", false},
		{"1.00", "GOOGLE*GSUITE EXAMPLE", false},
		{"1.00", "GOOGLE*YOUTUBEPREMIUM", false},
		{"1.00", "GOOGLE*GPAY", false},
		{"1.00", "GPAY TEMPLE BAKERY", false},
		{"1.00", "GOOGLE*GPAYTEMP", false},
		{"1.00", "GOOGLE*GPAY TEMPLATE SHOP", false},
		{"1.00", "Example Market 0001", false},
	} {
		t.Run(tc.amount+" "+tc.merchant, func(t *testing.T) {
			if got := IsHold(tc.amount, tc.merchant); got != tc.hold {
				t.Fatalf("IsHold(%q, %q) = %v, want %v", tc.amount, tc.merchant, got, tc.hold)
			}
		})
	}
}

// A stored $1.00 GPAY TEMP charge, kept as a charge before this rule, is made a hold when the store opens,
// once, as a pump's is (holdStoredPumpHolds).
func TestAStoredGooglePayCardCheckChargeBecomesAHoldAtStart(t *testing.T) {
	dir, c := t.TempDir(), newClock()
	s := openStore(t, dir, c)
	token, _ := s.Address("family-a")
	for _, a := range []Alert{
		{Kind: KindCharge, Amount: "1.00", Merchant: "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", Last4: "5678", When: "2026-11-08T13:01:00-05:00"},
		{Kind: KindCharge, Amount: "1.00", Merchant: "TEMPE MARKET", Last4: "5678", When: "2026-11-08T13:02:00-05:00"},
		{Kind: KindCharge, Amount: "12.99", Merchant: "GOOGLE*GPAY TEMP MOUNTAIN VIEW USA", Last4: "5678", When: "2026-11-08T13:03:00-05:00"},
	} {
		if _, _, err := s.Add(token, a); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	var kinds []string
	for _, a := range openStore(t, dir, c).List("family-a", 0) {
		kinds = append(kinds, a.Kind)
	}
	if got, want := strings.Join(kinds, ","), "hold,charge,charge"; got != want {
		t.Fatalf("kinds after a restart = %s, want %s", got, want)
	}
}
