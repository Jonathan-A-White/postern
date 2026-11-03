package alertsmail

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/alerts"
)

// The fixtures are built from the visible fields of real mails printed from
// Gmail, with every card number, order id, name, address and merchant made up.

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestCardAlertsYieldAmountMerchantLast4AndWhen(t *testing.T) {
	for _, tc := range []struct {
		file string
		want Facts
	}{
		{"chase.eml", Facts{Kind: alerts.KindCharge, Amount: "6.04", Merchant: "Example Market 0001", Last4: "1234", When: "2026-11-02T12:42:00-05:00"}},
		{"chase-amazon.eml", Facts{Kind: alerts.KindCharge, Amount: "42.17", Merchant: "AMAZON MKTPLACE PMTS", Last4: "1234", When: "2026-10-21T03:12:00-04:00"}},
		{"citi.eml", Facts{Kind: alerts.KindCharge, Amount: "292.46", Merchant: "EXAMPLE OUTFITTERS NEW YORK USA", Last4: "4321", When: "2026-10-31T16:53:00-04:00"}},
		{"citi-costco.eml", Facts{Kind: alerts.KindCharge, Amount: "130.00", Merchant: "EXAMPLE CLUB *ANNUAL RENEWAL 800-555-0100 US", Last4: "8765", When: "2026-11-01T08:18:00-05:00"}},
	} {
		t.Run(tc.file, func(t *testing.T) {
			if got := Parse(fixture(t, tc.file)); got != tc.want {
				t.Fatalf("Parse(%s) =\n %+v\nwant\n %+v", tc.file, got, tc.want)
			}
		})
	}
}

func TestAnAmazonOrderYieldsItsOrderIDItemsAndTotal(t *testing.T) {
	got := Parse(fixture(t, "amazon-order.eml"))
	want := Facts{Kind: alerts.KindAmazon, Amount: "42.17", Merchant: "Amazon", When: "2026-10-20T23:46:12-04:00",
		OrderID: "111-0000000-0000000", Items: "2 Widgets, 1 Kitchen Gadgets"}
	if got != want {
		t.Fatalf("Parse(amazon-order.eml) =\n %+v\nwant\n %+v", got, want)
	}
}

func TestAnAmazonShipmentYieldsItsOrderID(t *testing.T) {
	raw := "From: Amazon.com <shipment-tracking@amazon.com>\r\n" +
		"Date: Thu, 22 Oct 2026 10:00:00 -0400\r\n" +
		"Subject: Shipped: \"Widget, blue...\" and 1 more item\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
		"Your package was shipped!\r\nOrder # 111-0000000-0000000\r\n"
	got := Parse([]byte(raw))
	want := Facts{Kind: alerts.KindAmazon, Merchant: "Amazon", When: "2026-10-22T10:00:00-04:00", OrderID: "111-0000000-0000000"}
	if got != want {
		t.Fatalf("Parse(shipment) =\n %+v\nwant\n %+v", got, want)
	}
}

func TestGmailsForwardingConfirmationYieldsItsCode(t *testing.T) {
	got := Parse(fixture(t, "gmail-confirm.eml"))
	if got.Kind != alerts.KindForwardConfirm || got.Code != "123456789" {
		t.Fatalf("Parse(gmail-confirm.eml) = %+v, want forward-confirm with code 123456789", got)
	}
}

func TestAnUnknownMailYieldsUnreadWithItsSubjectOnly(t *testing.T) {
	got := Parse(fixture(t, "unknown.eml"))
	want := Facts{Kind: alerts.KindUnread, Subject: "Your November statement is ready — view it online"}
	if got != want {
		t.Fatalf("Parse(unknown.eml) = %+v, want %+v", got, want)
	}
}

func TestMailThatIsNotMailIsUnread(t *testing.T) {
	for name, raw := range map[string]string{
		"empty":                  "",
		"no headers":             "just some words\r\n",
		"a broken multipart":     "From: Chase <no.reply.alerts@chase.com>\r\nSubject: You made a transaction\r\nContent-Type: multipart/alternative\r\n\r\n--x\r\n",
		"a chase mail no amount": "From: Chase <no.reply.alerts@chase.com>\r\nSubject: Your statement\r\nContent-Type: text/plain\r\n\r\nMerchant\r\nSomewhere\r\n",
	} {
		got := Parse([]byte(raw))
		if got.Kind != alerts.KindUnread || got.Amount != "" || got.Merchant != "" {
			t.Fatalf("%s: Parse = %+v, want unread and nothing else", name, got)
		}
	}
}

func TestAnOverLongSubjectIsCutToTheFieldLimit(t *testing.T) {
	raw := "From: x@example.com\r\nSubject: " + strings.Repeat("é", 500) + "\r\n\r\nbody\r\n"
	got := Parse([]byte(raw))
	if n := len([]rune(got.Subject)); n != alerts.MaxFieldRunes {
		t.Fatalf("subject is %d runes, want %d", n, alerts.MaxFieldRunes)
	}
}

func TestTheAlertPostedHoldsOnlyTheFieldsTheBackendKeeps(t *testing.T) {
	order := Parse(fixture(t, "amazon-order.eml")).Alert()
	if order != (alerts.Alert{Kind: alerts.KindAmazon, Amount: "42.17", Merchant: "Amazon", When: "2026-10-20T23:46:12-04:00"}) {
		t.Fatalf("amazon alert = %+v", order)
	}
	unread := Parse(fixture(t, "unknown.eml")).Alert()
	if unread != (alerts.Alert{Kind: alerts.KindUnread, Subject: "Your November statement is ready — view it online"}) {
		t.Fatalf("unread alert = %+v", unread)
	}
}
