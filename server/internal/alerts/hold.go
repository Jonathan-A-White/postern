package alerts

import (
	"strings"
	"unicode"
)

// A gas pump's pre-authorisation: the card is asked for $1.00 before the fill-up, the alert says so,
// and it never posts as $1.00; the real amount comes later (the Governor, 2026-11-11; mw-mr4xgrw.49).
// It is kept as its own kind, hold, so the fact is kept, but it is no charge to sort: it pings nobody
// and the apps' Waiting lists, which keep only charges, never show it.
//
// The rule, in one place: a card alert of exactly $1.00 whose merchant is a fuel seller. A fuel seller's
// name holds the whole word GAS or FUEL, or begins with a pump brand (a whole word, or a word followed
// by digits or punctuation: SHELL12345, BP#123).

// FuelWords are the words that make a merchant a fuel seller wherever they stand in its name.
var FuelWords = []string{"GAS", "FUEL"}

// PumpBrands are the names a fuel seller's merchant may begin with. Add a brand here and a line to
// TestAPumpHoldIsExactlyOneDollarAtAFuelSeller (hold_test.go), and nowhere else.
var PumpBrands = []string{"SHELL", "EXXONMOBIL", "EXXON", "MOBIL", "BP", "SUNOCO", "CITGO", "GULF", "VALERO", "CHEVRON", "SPEEDWAY", "CUMBERLAND"}

// IsPumpHold reports whether a card alert of this amount at this merchant is a pump's $1.00 hold.
func IsPumpHold(amount, merchant string) bool {
	return isOneDollar(amount) && isFuelSeller(merchant)
}

// isOneDollar: the amount is exactly one dollar, written as a card mail writes it ("1.00", "$1.00",
// "1", "1.0").
func isOneDollar(amount string) bool {
	whole, cents, _ := strings.Cut(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(amount), "$")), ".")
	if whole != "1" {
		return false
	}
	return strings.Trim(cents, "0") == ""
}

func isFuelSeller(merchant string) bool {
	upper := strings.ToUpper(merchant)
	words := strings.FieldsFunc(upper, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	for _, word := range words {
		for _, fuel := range FuelWords {
			if word == fuel {
				return true
			}
		}
	}
	name := strings.TrimLeftFunc(upper, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	for _, brand := range PumpBrands {
		rest, ok := strings.CutPrefix(name, brand)
		if !ok {
			continue
		}
		if rest == "" {
			return true
		}
		if next := []rune(rest)[0]; !unicode.IsLetter(next) {
			return true
		}
	}
	return false
}
