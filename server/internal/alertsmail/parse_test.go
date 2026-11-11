package alertsmail

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/alerts"
)

// The Chase, Citi, PNC and Amazon fixtures are built by hand from the visible fields
// of real mails printed from Gmail, with every card number, order id, name,
// address and merchant made up and the headers and MIME structure written to
// look right: none is a raw mail. gmail-confirm.eml is the shape of a real raw
// mail (caught 2026-11-03), its values made up.

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
		{"chase.eml", Facts{Kind: alerts.KindCharge, Amount: "9.38", Merchant: "Example Market 0001", Last4: "1234", When: "2026-11-02T12:42:00-05:00"}},
		{"chase-amazon.eml", Facts{Kind: alerts.KindCharge, Amount: "42.17", Merchant: "AMAZON MKTPLACE PMTS", Last4: "1234", When: "2026-10-21T03:12:00-04:00"}},
		{"citi.eml", Facts{Kind: alerts.KindCharge, Amount: "187.53", Merchant: "EXAMPLE OUTFITTERS NEW YORK USA", Last4: "4321", When: "2026-10-31T16:53:00-04:00"}},
		{"citi-costco.eml", Facts{Kind: alerts.KindCharge, Amount: "76.25", Merchant: "EXAMPLE CLUB *ANNUAL RENEWAL 800-555-0100 US", Last4: "8765", When: "2026-11-01T08:18:00-05:00"}},
	} {
		t.Run(tc.file, func(t *testing.T) {
			if got := Parse(fixture(t, tc.file)); got != tc.want {
				t.Fatalf("Parse(%s) =\n %+v\nwant\n %+v", tc.file, got, tc.want)
			}
		})
	}
}

// A pump's $1.00 pre-authorisation never posts as $1.00 and the real amount comes later, so it is a
// hold, not a charge to sort (mw-mr4xgrw.49). The fixtures are the shape of the Governor's Costco Gas
// alert with the card and name made up.
func TestAPumpHoldAtAFuelSellerIsAHoldWhicheverBankSentIt(t *testing.T) {
	for _, tc := range []struct {
		file string
		want Facts
	}{
		{"chase-gas-hold.eml", Facts{Kind: alerts.KindHold, Amount: "1.00", Merchant: "COSTCO GAS #0304 BROOKFIELD US", Last4: "5678", When: "2026-11-08T13:01:00-05:00"}},
		{"citi-gas-hold.eml", Facts{Kind: alerts.KindHold, Amount: "1.00", Merchant: "COSTCO GAS #0304 BROOKFIELD US", Last4: "5678", When: "2026-11-08T13:01:00-05:00"}},
	} {
		t.Run(tc.file, func(t *testing.T) {
			if got := Parse(fixture(t, tc.file)); got != tc.want {
				t.Fatalf("Parse(%s) =\n %+v\nwant\n %+v", tc.file, got, tc.want)
			}
			if alert := tc.want.Alert(); alert.Kind != "hold" {
				t.Fatalf("alert = %+v, want kind hold", alert)
			}
		})
	}
}

func TestOnlyExactlyOneDollarAtAFuelSellerIsAHold(t *testing.T) {
	for _, file := range []string{"chase-gas-hold.eml", "citi-gas-hold.eml"} {
		raw := string(fixture(t, file))
		for _, tc := range []struct {
			name, from, to string
			want           string
		}{
			{"the real fill-up", "$1.00", "$41.27", alerts.KindCharge},
			{"a hold at a shop", "COSTCO GAS #0304", "EXAMPLE MARKET #0304", alerts.KindCharge},
			{"a hold at a pump brand", "COSTCO GAS #0304", "SHELL OIL 0304", alerts.KindHold},
		} {
			t.Run(file+" "+tc.name, func(t *testing.T) {
				got := Parse([]byte(strings.ReplaceAll(raw, tc.from, tc.to)))
				if got.Kind != tc.want {
					t.Fatalf("Parse = %+v, want kind %s", got, tc.want)
				}
				if tc.want == alerts.KindCharge && (got.Amount == "" || got.Merchant == "") {
					t.Fatalf("a charge lost its facts: %+v", got)
				}
			})
		}
	}
}

func TestAPNCZelleSentAlertYieldsPayeeAmountDateAndMemo(t *testing.T) {
	got := Parse(fixture(t, "pnc-zelle-sent.eml"))
	want := Facts{Kind: alerts.KindZelleSent, Amount: "25.00", Merchant: "Sam Example", Last4: "5678",
		When: "2026-11-02T11:34:07-05:00", Memo: "Example lawn care"}
	if got != want {
		t.Fatalf("Parse(pnc-zelle-sent.eml) =\n %+v\nwant\n %+v", got, want)
	}
	if alert := got.Alert(); alert.Memo != "Example lawn care" || alert.Merchant != "Sam Example" || alert.Kind != "zelle-sent" {
		t.Fatalf("alert = %+v, want the memo and payee kept", alert)
	}
}

// The payment date alone is the day; the mail's own time is kept when the mail
// came the same day, and a payment with no memo has none (the next row's label
// is not its memo).
func TestAPNCZelleSentWithNoMemoHasNoMemoAndABodyDateOnADifferentDayIsMidnight(t *testing.T) {
	raw := "From: PNC Alerts <pncalerts@pnc.com>\r\nDate: Tue, 3 Nov 2026 09:00:00 -0500\r\n" +
		"Subject: You sent a Zelle\u00ae payment to Sam Example\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" +
		"You Sent a Payment to Sam Example\r\nFrom Account: x5678\r\nAmount: $10.00\r\nPayment Date: 11/02/26\r\nMemo:\r\nTransaction ID: PNCEXAMPLE02\r\n"
	got := Parse([]byte(raw))
	want := Facts{Kind: alerts.KindZelleSent, Amount: "10.00", Merchant: "Sam Example", Last4: "5678", When: "2026-11-02T00:00:00-05:00"}
	if got != want {
		t.Fatalf("Parse(no memo) =\n %+v\nwant\n %+v", got, want)
	}
}

func TestAPNCDepositAlertYieldsPayerAmountAndDate(t *testing.T) {
	got := Parse(fixture(t, "pnc-deposit.eml"))
	want := Facts{Kind: alerts.KindDeposit, Amount: "64.20", Merchant: "ACH DEP EXAMPLE CARDS CASH REWARD", Last4: "5678",
		When: "2026-11-01T00:00:00-04:00"}
	if got != want {
		t.Fatalf("Parse(pnc-deposit.eml) =\n %+v\nwant\n %+v", got, want)
	}
}

// Any other PNC mail, and a PNC-looking mail from anyone else, is unread with
// its subject only.
func TestAnyOtherPNCMailIsUnreadWithItsSubject(t *testing.T) {
	zelle := string(fixture(t, "pnc-zelle-sent.eml"))
	for name, raw := range map[string]string{
		"a statement notice":          "From: PNC Alerts <pncalerts@pnc.com>\r\nSubject: Your statement is ready\r\nContent-Type: text/plain\r\n\r\nAmount: $10.00\r\nDate: 11/01/26\r\n",
		"a zelle received":            "From: PNC Alerts <pncalerts@pnc.com>\r\nSubject: You received a Zelle\u00ae payment from Sam Example\r\nContent-Type: text/plain\r\n\r\nAmount: $10.00\r\nPayment Date: 11/01/26\r\n",
		"a deposit, no amount":        "From: PNC Alerts <pncalerts@pnc.com>\r\nSubject: A deposit was credited to your account.\r\nContent-Type: text/plain\r\n\r\nDeposit made by: SOMEONE\r\n",
		"a zelle from another domain": strings.Replace(zelle, "pncalerts@pnc.com", "pncalerts@pnc.example.com", 2),
	} {
		got := Parse([]byte(raw))
		if got.Kind != alerts.KindUnread || got.Amount != "" || got.Merchant != "" || got.Memo != "" || got.Subject == "" {
			t.Errorf("%s: Parse = %+v, want unread with its subject only", name, got)
		}
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

const confirmLink = "https://mail.google.com/mail/vf-%5BMADE-UP-CONFIRM-TOKEN%5D--r8dYHz83JJWhOIEjymPq3BFiaY"

// gmailConfirmMail is a forwarding confirmation as Gmail sends it, with the
// sender and the body's link lines the test chooses.
func gmailConfirmMail(from string, body ...string) []byte {
	return []byte("Date: Tue, 3 Nov 2026 15:15:48 -0500\r\n" +
		"Subject: (Gmail Forwarding Confirmation - Receive Mail from someone@gmail.com\r\n" +
		"From: Gmail Team <" + from + ">\r\n" +
		"Content-Type: text/plain; charset=\"UTF-8\"\r\n\r\n" +
		strings.Join(body, "\r\n") + "\r\n")
}

// gmail-confirm.eml is the real mail's shape (caught 2026-11-03, values made
// up): a link to confirm and a link to cancel, and no confirmation code.
func TestGmailsRealForwardingConfirmationYieldsItsConfirmLink(t *testing.T) {
	got := Parse(fixture(t, "gmail-confirm.eml"))
	want := Facts{Kind: alerts.KindForwardConfirm, When: "2026-11-03T15:15:48-05:00", Link: confirmLink}
	if got != want {
		t.Fatalf("Parse(gmail-confirm.eml) =\n %+v\nwant\n %+v", got, want)
	}
	if strings.Contains(got.Link, "/uf-") {
		t.Fatalf("the cancel link was kept: %s", got.Link)
	}
	if alert := got.Alert(); alert.Link != confirmLink || alert.Subject != "" {
		t.Fatalf("alert = %+v, want the confirm link and no subject", alert)
	}
}

func TestGmailsConfirmationCodeIsStillReadWhenItComes(t *testing.T) {
	for name, raw := range map[string][]byte{
		"in the subject": []byte("From: Gmail Team <forwarding-noreply@google.com>\r\n" +
			"Subject: (#123456789) Gmail Forwarding Confirmation - Receive Mail from pat@example.com\r\n\r\nHello\r\n"),
		"in the body": gmailConfirmMail("forwarding-noreply@google.com", "Confirmation code: 123456789"),
	} {
		got := Parse(raw)
		if got.Kind != alerts.KindForwardConfirm || got.Code != "123456789" || got.Link != "" {
			t.Fatalf("%s: Parse = %+v, want forward-confirm with code 123456789", name, got)
		}
	}
	both := Parse(gmailConfirmMail("forwarding-noreply@google.com", "Confirmation code: 123456789", confirmLink))
	if both.Code != "123456789" || both.Link != confirmLink {
		t.Fatalf("a mail with both: %+v", both)
	}
}

// The mail Gmail sent him on 2026-11-10 (mw-qtu3zvz.49.5) was filed unread:
// its subject had no code and its link, as Google's real mails show it, is on
// mail-settings.google.com, not mail.google.com. gmail-confirm-mail-settings.eml
// is that shape, quoted-printable with the link wrapped by soft breaks, its
// token and addresses made up.
func TestGmailsConfirmationOnMailSettingsYieldsItsConfirmLink(t *testing.T) {
	got := Parse(fixture(t, "gmail-confirm-mail-settings.eml"))
	want := Facts{Kind: alerts.KindForwardConfirm, When: "2026-11-09T20:32:10-05:00",
		Link: "https://mail-settings.google.com/mail/vf-%5BMADE-UP-SETTINGS_CONFIRM-TOKEN-0123456789abcdefABCDEF%5D-MadeUpSuffix0123456789ab"}
	if got != want {
		t.Fatalf("Parse(gmail-confirm-mail-settings.eml) =\n %+v\nwant\n %+v", got, want)
	}
	if alert := got.Alert(); alert.Link != want.Link || alert.Subject != "" {
		t.Fatalf("alert = %+v, want the confirm link and no subject", alert)
	}
}

// Each real confirmation read in an archive, values made up: a 2021 mail
// (lkml.rescloud.iu.edu/2101.2/01750.html), its link on mail-settings.google.com,
// and a 2012 mail (lists.ubuntu.com/archives/ubuntu-sn/2012-July/000010.html),
// its link on isolated.mail.google.com; both with a code and a cancel link.
func TestEveryRealConfirmationShapeYieldsItsConfirmLink(t *testing.T) {
	for _, tc := range []struct {
		file string
		want Facts
	}{
		{"gmail-confirm-2021.eml", Facts{Kind: alerts.KindForwardConfirm, When: "2021-01-18T13:13:39-05:00", Code: "12345678",
			Link: "https://mail-settings.google.com/mail/vf-%5BMADE-UP-2021_CONFIRM-TOKEN-0123456789abcdef%5D-MadeUpSuffix-0123456789"}},
		{"gmail-confirm-2012.eml", Facts{Kind: alerts.KindForwardConfirm, When: "2012-07-10T14:43:27Z", Code: "87654321",
			Link: "https://isolated.mail.google.com/mail/vf-0a1b2c3d4e-abcdefghijkl%40alerts.allmymind.org-tlr-MadeUp_Token-01"}},
	} {
		t.Run(tc.file, func(t *testing.T) {
			if got := Parse(fixture(t, tc.file)); got != tc.want {
				t.Fatalf("Parse(%s) =\n %+v\nwant\n %+v", tc.file, got, tc.want)
			}
		})
	}
}

// A mail to a family's address can be forged, and From with it: the link on
// the family's screen is only ever one Gmail's confirmation can carry.
func TestAForgedConfirmationKeepsNoLinkAndIsUnread(t *testing.T) {
	cancel := "https://mail.google.com/mail/uf-%5BMADE-UP-CANCEL-TOKEN%5D--r8dYHz83JJWhOIEjymPq3BFiaY"
	for name, raw := range map[string][]byte{
		"from another domain":            gmailConfirmMail("forwarding-noreply@example.com", confirmLink),
		"from a look-alike domain":       gmailConfirmMail("forwarding-noreply@google.com.evil.example", confirmLink),
		"from a domain ending in it":     gmailConfirmMail("forwarding-noreply@notgoogle.com", confirmLink),
		"from no one":                    []byte("Subject: (Gmail Forwarding Confirmation - Receive Mail from x\r\n\r\n" + confirmLink + "\r\n"),
		"a link on another host":         gmailConfirmMail("forwarding-noreply@google.com", "https://evil.example/mail/vf-%5BX%5D--y"),
		"a link on a look-alike host":    gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com.evil.example/mail/vf-%5BX%5D--y"),
		"a link with userinfo":           gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com@evil.example/mail/vf-%5BX%5D--y"),
		"a link on a sibling host":       gmailConfirmMail("forwarding-noreply@google.com", "https://accounts.google.com/mail/vf-%5BX%5D--y"),
		"a link on google.com itself":    gmailConfirmMail("forwarding-noreply@google.com", "https://google.com/mail/vf-%5BX%5D--y"),
		"a link under an allowed host":   gmailConfirmMail("forwarding-noreply@google.com", "https://evil.mail-settings.google.com/mail/vf-%5BX%5D--y"),
		"a link on a host ending in it":  gmailConfirmMail("forwarding-noreply@google.com", "https://notmail-settings.google.com/mail/vf-%5BX%5D--y"),
		"a link past an allowed host":    gmailConfirmMail("forwarding-noreply@google.com", "https://isolated.mail.google.com.evil.example/mail/vf-%5BX%5D--y"),
		"a link with a port":             gmailConfirmMail("forwarding-noreply@google.com", "https://mail-settings.google.com:8443/mail/vf-%5BX%5D--y"),
		"the settings cancel link":       gmailConfirmMail("forwarding-noreply@google.com", "https://mail-settings.google.com/mail/uf-%5BX%5D--y"),
		"the isolated cancel link":       gmailConfirmMail("forwarding-noreply@google.com", "https://isolated.mail.google.com/mail/uf-0a1b-x%40example.org-tlr-y"),
		"a settings link redirecting":    gmailConfirmMail("forwarding-noreply@google.com", "https://mail-settings.google.com/mail/vf-%5BX%5D--y?continue=https://evil.example"),
		"a settings link from elsewhere": gmailConfirmMail("forwarding-noreply@example.com", "https://mail-settings.google.com/mail/vf-%5BX%5D--y"),
		"a link over plain http":         gmailConfirmMail("forwarding-noreply@google.com", "http://mail.google.com/mail/vf-%5BX%5D--y"),
		"a link on another path":         gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/accounts/vf-%5BX%5D--y"),
		"a link with a path before vf-":  gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/mail/x/../vf-%5BX%5D--y"),
		"a link that redirects":          gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/mail/vf-%5BX%5D--y?continue=https://evil.example"),
		"a link with a fragment":         gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/mail/vf-%5BX%5D--y#https://evil.example"),
		"a link longer than any real":    gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/mail/vf-"+strings.Repeat("a", alerts.MaxLinkRunes)),
		"only the cancel link":           gmailConfirmMail("forwarding-noreply@google.com", cancel),
	} {
		got := Parse(raw)
		if got.Kind != alerts.KindUnread || got.Link != "" || got.Code != "" {
			t.Errorf("%s: Parse = %+v, want unread with no link", name, got)
		}
		if alert := got.Alert(); alert.Link != "" {
			t.Errorf("%s: alert keeps link %q", name, alert.Link)
		}
	}
}

func TestTheCancelLinkIsNeverKeptEvenBesideTheConfirmLink(t *testing.T) {
	cancel := "https://mail.google.com/mail/uf-%5BMADE-UP-CANCEL-TOKEN%5D--r8dYHz83JJWhOIEjymPq3BFiaY"
	got := Parse(gmailConfirmMail("forwarding-noreply@google.com", cancel, confirmLink, cancel))
	if got.Link != confirmLink {
		t.Fatalf("link = %q, want the confirm link", got.Link)
	}
}

// fixtureNotesPDF is the notes attached to subsplash-notes.eml: '%PDF-' and
// then garbage, never a real PDF, as the receiver never reads one.
const fixtureNotesPDF = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\nINVENTED-NOTES-BODY-MARKER: not a real PDF, garbage after the magic\n\x00\x01\xfe\xff\x80 stream endstream\n%%EOF\n"

// A Subsplash notes mail (invented, shaped like the one the church sends): the
// title and passage are in the subject, the date in the body, and the notes PDF
// is attached. The title, the reference, the date and the PDF's bytes are kept.
func TestASubsplashNotesMailYieldsTitleReferenceAndTheBodysDate(t *testing.T) {
	got := Parse(fixture(t, "subsplash-notes.eml"))
	want := Facts{Kind: alerts.KindSermonNotes, Title: "The Day of the Lord", Reference: "2 Peter 3:10-18", When: "2026-11-08T00:00:00-05:00", Notes: fixtureNotesPDF}
	if got != want {
		t.Fatalf("Parse(subsplash-notes.eml) =\n %+v\nwant\n %+v", got, want)
	}
	if alert := got.Alert(); alert != (alerts.Alert{Kind: "sermon-notes", Title: "The Day of the Lord", Reference: "2 Peter 3:10-18", When: "2026-11-08T00:00:00-05:00",
		Notes: base64.StdEncoding.EncodeToString([]byte(fixtureNotesPDF))}) {
		t.Fatalf("alert = %+v, want the title, reference, date and the notes' bytes", alert)
	}
}

// The attached notes are never read as text: a part that is an attachment is
// skipped by textLines whatever its type, and nothing of it reaches the text
// facts. An attachment that is not a PDF is not kept either.
func TestASermonNotesAttachmentIsNeverReadAsText(t *testing.T) {
	raw := fixture(t, "subsplash-notes.eml")
	got := Parse(raw)
	for name, field := range map[string]string{"title": got.Title, "reference": got.Reference, "when": got.When, "subject": got.Subject, "memo": got.Memo, "merchant": got.Merchant} {
		if strings.Contains(field, "INVENTED-NOTES-BODY-MARKER") {
			t.Errorf("%s holds the attachment's text", name)
		}
	}
	// a text attachment sorted before the body is still not the body, nor notes
	text := strings.Replace(string(raw), "Content-Type: application/pdf; name=\"notes.pdf\"", "Content-Type: text/plain; name=\"notes.txt\"", 1)
	text = strings.Replace(text, "filename=\"notes.pdf\"", "filename=\"notes.txt\"", 1)
	text = strings.Replace(text, fixtureNotesBase64(t, raw), "Tm92IDEsIDIwMjYK", 1) // "Nov 1, 2026"
	want := got
	want.Notes, want.NotesWhy = "", "no PDF attached"
	if again := Parse([]byte(text)); again != want {
		t.Fatalf("a text attachment changed the facts: %+v, want %+v", again, want)
	}
	if lines := textLines("multipart/mixed; boundary=\"b\"", "", strings.NewReader("--b\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=\"n.txt\"\r\n\r\nSECRET NOTES\r\n--b--\r\n")); len(lines) != 0 {
		t.Fatalf("an attachment was read: %q", lines)
	}
	// nor is the text inside a multipart that is attached
	nested := "--b\r\nContent-Type: multipart/alternative; boundary=\"n\"\r\nContent-Disposition: attachment\r\n\r\n--n\r\nContent-Type: text/plain\r\n\r\nSECRET NOTES\r\n--n--\r\n--b--\r\n"
	if lines := textLines("multipart/mixed; boundary=\"b\"", "", strings.NewReader(nested)); len(lines) != 0 {
		t.Fatalf("the text of an attached multipart was read: %q", lines)
	}
}

// fixtureNotesBase64 is the base64 body of subsplash-notes.eml's attachment,
// as it stands in the file.
func fixtureNotesBase64(t *testing.T, raw []byte) string {
	t.Helper()
	_, after, ok := strings.Cut(string(raw), "Content-Transfer-Encoding: base64\n\n")
	body, _, ok2 := strings.Cut(after, "\n\n")
	if !ok || !ok2 {
		t.Fatal("subsplash-notes.eml has no base64 attachment")
	}
	return body
}

// The body's date is read whatever way the church writes it; with none, the
// mail's own Date is the date. The subject's dash may be a typographic one,
// and a forward's prefix is dropped.
func TestASermonNotesDateAndSubjectAreReadInTheShapesTheyComeIn(t *testing.T) {
	mail := func(subject string, body string) []byte {
		return []byte("From: Example Church <noreply@subsplash.com>\r\nDate: Mon, 9 Nov 2026 09:00:00 -0500\r\nSubject: " + subject +
			"\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body)
	}
	for name, tc := range map[string]struct {
		raw  []byte
		want Facts
	}{
		"a labelled short date": {mail("Notes for \"Grace\" - Romans 8:1-4", "Date: Nov 1, 2026\r\n"),
			Facts{Kind: alerts.KindSermonNotes, Title: "Grace", Reference: "Romans 8:1-4", When: "2026-11-01T00:00:00-04:00"}},
		"a numeric date and curly quotes": {mail("Notes for \u201cGrace\u201d \u2013 Romans 8:1-4", "10/25/2026\r\n"),
			Facts{Kind: alerts.KindSermonNotes, Title: "Grace", Reference: "Romans 8:1-4", When: "2026-10-25T00:00:00-04:00"}},
		"a forwarded subject, no date in the body": {mail("Fwd: Notes for \"Grace\" - Romans 8:1-4", "Your notes are attached.\r\n"),
			Facts{Kind: alerts.KindSermonNotes, Title: "Grace", Reference: "Romans 8:1-4", When: "2026-11-09T09:00:00-05:00"}},
		"a title with a dash and a quote in it": {mail("Notes for \"Rest - the \"quiet\" kind\" - Psalm 23", "November 1, 2026\r\n"),
			Facts{Kind: alerts.KindSermonNotes, Title: "Rest - the \"quiet\" kind", Reference: "Psalm 23", When: "2026-11-01T00:00:00-04:00"}},
		"no passage": {mail("Notes for \"Grace\"", "Date: Nov 1, 2026\r\n"),
			Facts{Kind: alerts.KindSermonNotes, Title: "Grace", When: "2026-11-01T00:00:00-04:00"}},
	} {
		tc.want.NotesWhy = "no PDF attached"
		if got := Parse(tc.raw); got != tc.want {
			t.Errorf("%s: Parse =\n %+v\nwant\n %+v", name, got, tc.want)
		}
	}
}

// A notes-looking subject from anyone but Subsplash, or a subject that is not
// "Notes for "...", is unread with its subject only: nothing of a forger's body
// is kept.
func TestSermonNotesFromAnyoneButSubsplashOrOfAnotherShapeAreUnread(t *testing.T) {
	for name, raw := range map[string]string{
		"another sender":  "From: x <x@example.com>\r\nSubject: Notes for \"Grace\" - Romans 8:1-4\r\nContent-Type: text/plain\r\n\r\nNov 1, 2026\r\n",
		"a lookalike":     "From: x <x@notsubsplash.com>\r\nSubject: Notes for \"Grace\" - Romans 8:1-4\r\nContent-Type: text/plain\r\n\r\nNov 1, 2026\r\n",
		"another subject": "From: x <noreply@subsplash.com>\r\nSubject: Your receipt\r\nContent-Type: text/plain\r\n\r\nNov 1, 2026\r\n",
		"no quoted title": "From: x <noreply@subsplash.com>\r\nSubject: Notes for Grace - Romans\r\nContent-Type: text/plain\r\n\r\nNov 1, 2026\r\n",
	} {
		got := Parse([]byte(raw))
		if got.Kind != alerts.KindUnread || got.Title != "" || got.Reference != "" || got.When != "" || got.Subject == "" {
			t.Errorf("%s: Parse = %+v, want unread with its subject only", name, got)
		}
	}
}

// A title or passage over the field limit is cut to it, as a subject is.
func TestAnOverLongSermonTitleIsCutToTheFieldLimit(t *testing.T) {
	raw := "From: x <noreply@subsplash.com>\r\nSubject: Notes for \"" + strings.Repeat("é", 500) + "\" - " + strings.Repeat("r", 500) + "\r\nContent-Type: text/plain\r\n\r\nNov 1, 2026\r\n"
	alert := Parse([]byte(raw)).Alert()
	if len([]rune(alert.Title)) != alerts.MaxFieldRunes || len([]rune(alert.Reference)) != alerts.MaxFieldRunes {
		t.Fatalf("title %d, reference %d runes, want %d each", len([]rune(alert.Title)), len([]rune(alert.Reference)), alerts.MaxFieldRunes)
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

// Every dollar amount in a fixture must be one of these made-up ones: the
// repo is public and a mail printed from a real inbox carries a real purchase.
var madeUpAmounts = map[string]bool{"0.00": true, "9.38": true, "187.53": true, "76.25": true, "42.17": true, "10.00": true, "25.00": true, "64.20": true, "1.00": true, "41.27": true}

func TestFixturesHoldOnlyMadeUpAmounts(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "*.eml"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no fixtures found: %v", err)
	}
	amount := regexp.MustCompile(`\$[0-9][0-9,]*\.[0-9]{2}`)
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		// the decoded subject and text too: a body can be base64
		msg, err := mail.ReadMessage(bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw) + "\n" + decodeHeader(msg.Header.Get("Subject")) + "\n" +
			strings.Join(textLines(msg.Header.Get("Content-Type"), msg.Header.Get("Content-Transfer-Encoding"), msg.Body), "\n")
		for _, m := range amount.FindAllString(text, -1) {
			if !madeUpAmounts[strings.ReplaceAll(strings.TrimPrefix(m, "$"), ",", "")] {
				t.Errorf("%s holds an amount that is not a made-up one", f)
			}
		}
	}
}

// parseLogged is Parse with what it logs.
func parseLogged(t *testing.T, raw []byte) (Facts, string) {
	t.Helper()
	var buf bytes.Buffer
	out, flags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() { log.SetOutput(out); log.SetFlags(flags) })
	got := Parse(raw)
	return got, buf.String()
}

// A confirmation from google.com that still yields no link says in the log
// which check failed and the host of each link it turned down, so the next
// miss can be read; the log never holds a token or an address.
func TestAConfirmationWithNoLinkLogsWhichCheckFailedAndEachHost(t *testing.T) {
	secrets := []string{"MADE-UP", "someone", "gmail.com", "abcdefghijkl", "allmymind", "%5B", "://", "/mail/vf-%", "/mail/uf-%"}
	for _, tc := range []struct {
		name  string
		raw   []byte
		wants []string
	}{
		{"links on hosts not allowed", gmailConfirmMail("forwarding-noreply@google.com",
			"someone@gmail.com wants to forward to abcdefghijkl@alerts.allmymind.org",
			"https://evil.example/mail/vf-%5BMADE-UP-TOKEN%5D--y",
			"https://mail-settings.google.com/mail/uf-%5BMADE-UP-CANCEL%5D--y",
			"http://support.google.com/mail/bin/answer.py?answer=184973."),
			[]string{"alerts-mail: a Gmail forwarding confirmation from google.com gave no confirm link: links turned down: ",
				`"evil.example" (host not on the allow-list)`, `"mail-settings.google.com" (the cancel link)`,
				`"support.google.com" (not https)`}},
		{"a confirm link with more after it", gmailConfirmMail("forwarding-noreply@google.com",
			"https://mail-settings.google.com/mail/vf-%5BMADE-UP-TOKEN%5D--y?continue=x"),
			[]string{`"mail-settings.google.com" (not a token after /mail/vf-)`}},
		{"a confirm link too long", gmailConfirmMail("forwarding-noreply@google.com",
			"https://mail-settings.google.com/mail/vf-MADE-UP"+strings.Repeat("a", alerts.MaxLinkRunes)),
			[]string{`"mail-settings.google.com" (longer than 500 characters)`}},
		{"a link on another path", gmailConfirmMail("forwarding-noreply@google.com",
			"https://mail.google.com/accounts/MADE-UP"),
			[]string{`"mail.google.com" (path not /mail/vf-)`}},
		{"no link at all", gmailConfirmMail("forwarding-noreply@google.com", "someone@gmail.com wants to forward"),
			[]string{"gave no confirm link: no link in 1 lines"}},
		{"a sender not google.com", gmailConfirmMail("forwarding-noreply@example.com", confirmLink),
			[]string{`alerts-mail: a Gmail forwarding confirmation is unread: sender's domain "example.com", not google.com`}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, logged := parseLogged(t, tc.raw)
			if got.Kind != alerts.KindUnread {
				t.Fatalf("Parse = %+v, want unread", got)
			}
			if strings.Count(logged, "\n") != 1 {
				t.Fatalf("logged %q, want one line", logged)
			}
			for _, want := range tc.wants {
				if !strings.Contains(logged, want) {
					t.Errorf("logged %q, want it to hold %q", logged, want)
				}
			}
			for _, secret := range secrets {
				if strings.Contains(logged, secret) {
					t.Errorf("logged %q, which holds %q", logged, secret)
				}
			}
		})
	}
}

// A confirmation read for its code alone still logs why it has no link.
func TestAConfirmationWithACodeButNoLinkLogsTheMiss(t *testing.T) {
	got, logged := parseLogged(t, gmailConfirmMail("forwarding-noreply@google.com",
		"Confirmation code: 123456789", "https://mail-settings.google.com/mail/uf-%5BMADE-UP-CANCEL%5D--y"))
	if got.Kind != alerts.KindForwardConfirm || got.Code != "123456789" || got.Link != "" {
		t.Fatalf("Parse = %+v, want forward-confirm with its code and no link", got)
	}
	if want := `gave no confirm link: links turned down: "mail-settings.google.com" (the cancel link)`; !strings.Contains(logged, want) || strings.Contains(logged, "MADE-UP") {
		t.Fatalf("logged %q, want it to hold %q and no token", logged, want)
	}
}

// A confirmation that is read with its link, and any other mail, logs nothing
// from the parse.
func TestOnlyAMissedConfirmationIsLogged(t *testing.T) {
	for _, file := range []string{"gmail-confirm-mail-settings.eml", "gmail-confirm.eml", "chase.eml", "unknown.eml"} {
		if _, logged := parseLogged(t, fixture(t, file)); logged != "" {
			t.Errorf("%s: logged %q, want nothing", file, logged)
		}
	}
}

// A mail that nearly fits a parser (its sender or its subject) but is filed
// unread says in the log which check failed, in one line; the line holds only
// fixed words and a sender's domain, never a token, an address, the subject,
// the body, an amount, a merchant or an account.
func TestAMailThatNearlyFitsAParserButIsUnreadLogsWhichCheckFailed(t *testing.T) {
	const head = "alerts-mail: a mail is unread; the checks that nearly fit it failed: "
	secrets := []string{"Grace", "Romans", "noreply", "x@", "@", "MADE-UP", "25.00", "9.38", "1234", "4321", "Sam Example", "SOMEONE", "ACME", "111-", "Widget", "Nov 1"}
	mailOf := func(from, subject string, body ...string) []byte {
		return []byte("From: x <" + from + ">\r\nSubject: " + subject + "\r\nContent-Type: text/plain\r\n\r\n" + strings.Join(body, "\r\n") + "\r\n")
	}
	for _, tc := range []struct {
		name string
		raw  []byte
		want string
	}{
		{"notes, another sender", mailOf("x@example.com", `Notes for "Grace" - Romans 8:1-4`, "Nov 1, 2026"),
			`sermon notes: sender's domain "example.com", not subsplash.com`},
		{"notes, a lookalike sender", mailOf("x@notsubsplash.com", `Notes for "Grace" - Romans 8:1-4`, "Nov 1, 2026"),
			`sermon notes: sender's domain "notsubsplash.com", not subsplash.com`},
		{"notes, another subject", mailOf("noreply@subsplash.com", "Your receipt", "Nov 1, 2026"),
			"sermon notes: subject is not Notes for \"title\""},
		{"notes, no quoted title", mailOf("noreply@subsplash.com", "Notes for Grace - Romans", "Nov 1, 2026"),
			"sermon notes: subject is not Notes for \"title\""},
		{"notes, a blank title", mailOf("noreply@subsplash.com", `Notes for " " - Romans`, "Nov 1, 2026"),
			"sermon notes: the title is blank"},
		{"chase, no amount", mailOf("alerts@chase.com", "Your card", "Merchant ACME", "Account Prime Visa (...1234)"),
			"chase: no amount"},
		{"citi, no transaction subject", mailOf("alerts@citi.com", "Your statement", "Amount: $25.00", "Card Ending In 4321"),
			`citi: subject has no "transaction"`},
		{"citi, no amount", mailOf("alerts@citi.com", "A transaction was made", "Merchant ACME", "Card Ending In 4321"),
			"citi: no amount"},
		{"zelle, no payee", mailOf("pncalerts@pnc.com", "Your statement is ready", "Amount: $25.00", "From Account: x1234"),
			"pnc zelle-sent: no payee"},
		{"zelle, no amount", mailOf("pncalerts@pnc.com", "You sent a Zelle® payment to Sam Example", "From Account: x1234"),
			"pnc zelle-sent: no amount"},
		{"pnc, no deposit subject", mailOf("pncalerts@pnc.com", "Your statement is ready", "Amount: $25.00", "Account ending in: x1234"),
			`pnc deposit: subject has no "deposit"`},
		{"pnc deposit, no amount", mailOf("pncalerts@pnc.com", "A deposit was credited to your account.", "Deposit made by: SOMEONE", "Account ending in: x1234"),
			"pnc deposit: no amount"},
		{"amazon, no order id", mailOf("auto-confirm@amazon.com", "Ordered: Widget", "Order # 12-34", "Grand Total: $25.00"),
			"amazon: no order number"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, logged := parseLogged(t, tc.raw)
			if got.Kind != alerts.KindUnread {
				t.Fatalf("Parse = %+v, want unread", got)
			}
			if strings.Count(logged, "\n") != 1 || !strings.HasPrefix(logged, head) {
				t.Fatalf("logged %q, want one line starting %q", logged, head)
			}
			if !strings.Contains(logged, tc.want) {
				t.Errorf("logged %q, want it to hold %q", logged, tc.want)
			}
			for _, secret := range secrets {
				if strings.Contains(logged[len(head):], secret) {
					t.Errorf("logged %q, which holds %q", logged, secret)
				}
			}
		})
	}
}

// A mail that is read, one no parser nearly fits, and a mail that one parser
// misses but another reads, log nothing of this kind.
func TestOnlyAMailThatNearlyFitsAndIsUnreadLogsAMiss(t *testing.T) {
	for _, file := range []string{"subsplash-notes.eml", "chase.eml", "chase-amazon.eml", "citi.eml", "citi-costco.eml", "chase-gas-hold.eml", "citi-gas-hold.eml", "pnc-zelle-sent.eml", "pnc-deposit.eml", "amazon-order.eml", "unknown.eml"} {
		if _, logged := parseLogged(t, fixture(t, file)); logged != "" {
			t.Errorf("%s: logged %q, want nothing", file, logged)
		}
	}
	for name, raw := range map[string]string{
		"from nobody we read": "From: x <x@example.com>\r\nSubject: Hello\r\nContent-Type: text/plain\r\n\r\nAmount: $10.00\r\n",
		"not mail":            "not mail at all",
	} {
		if got, logged := parseLogged(t, []byte(raw)); got.Kind != alerts.KindUnread || logged != "" {
			t.Errorf("%s: Parse = %+v, logged %q, want unread and nothing logged", name, got, logged)
		}
	}
}

// ---- the notes PDF of a sermon-notes mail ----------------------------------

// notesMail is a sermon-notes mail from Subsplash with the given parts after
// its HTML body, each part whole (its headers, a blank line, its body).
func notesMail(parts ...string) []byte {
	var b strings.Builder
	b.WriteString("From: Example Church <noreply@mail.subsplash.com>\r\nDate: Sun, 8 Nov 2026 18:20:05 -0500\r\n" +
		"Subject: Notes for \"Grace\" - Romans 8:1-4\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"mix\"\r\n\r\n" +
		"--mix\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>Sunday, November 8, 2026</p><p>Your notes are attached.</p>\r\n")
	for _, part := range parts {
		b.WriteString("--mix\r\n" + part + "\r\n")
	}
	b.WriteString("--mix--\r\n")
	return []byte(b.String())
}

// pdfPart is an attached part: its Content-Type, its filename ("" for none)
// and its bytes, base64 in lines of 76.
func pdfPart(contentType, filename string, data []byte) string {
	head := "Content-Type: " + contentType + "\r\n"
	if filename != "" {
		head += "Content-Disposition: attachment; filename=\"" + filename + "\"\r\n"
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	var lines []string
	for len(encoded) > 76 {
		lines = append(lines, encoded[:76])
		encoded = encoded[76:]
	}
	lines = append(lines, encoded)
	return head + "Content-Transfer-Encoding: base64\r\n\r\n" + strings.Join(lines, "\r\n")
}

// garbagePDF is n bytes that begin '%PDF-' and are otherwise noise, every
// byte value among them.
func garbagePDF(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i*7 + 3)
	}
	copy(b, "%PDF-")
	return b
}

var graceFacts = Facts{Kind: alerts.KindSermonNotes, Title: "Grace", Reference: "Romans 8:1-4", When: "2026-11-08T00:00:00-05:00"}

// The one attached PDF is kept as its bytes, whether the mail says so by its
// type or by its file name, and nothing reads it: bytes that begin '%PDF-' and
// are garbage after are passed through as they are, up to the limit exactly.
func TestASermonNotesMailKeepsItsOnePDFAsItsBytesUnread(t *testing.T) {
	for name, tc := range map[string]struct {
		part string
		pdf  []byte
	}{
		"typed application/pdf":     {pdfPart("application/pdf; name=\"notes.pdf\"", "notes.pdf", garbagePDF(4000)), garbagePDF(4000)},
		"typed only, no file name":  {pdfPart("application/pdf", "", garbagePDF(300)), garbagePDF(300)},
		"a .pdf name, octet-stream": {pdfPart("application/octet-stream", "Sermon Notes.PDF", garbagePDF(300)), garbagePDF(300)},
		"at the limit exactly":      {pdfPart("application/pdf", "notes.pdf", garbagePDF(alerts.MaxNotesBytes)), garbagePDF(alerts.MaxNotesBytes)},
	} {
		got := Parse(notesMail(tc.part, pdfPart("image/png", "logo.png", []byte("\x89PNG not a pdf"))))
		want := graceFacts
		want.Notes = string(tc.pdf)
		if got != want {
			t.Errorf("%s: Parse kept %d bytes of notes (why %q), want %d bytes; facts %+v", name, len(got.Notes), got.NotesWhy, len(tc.pdf), Facts{Kind: got.Kind, Title: got.Title, Reference: got.Reference, When: got.When})
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(got.Alert().Notes)
		if err != nil || !bytes.Equal(decoded, tc.pdf) {
			t.Errorf("%s: the alert's notes are not the PDF's bytes (%v)", name, err)
		}
	}
}

// A sermon-notes mail whose notes cannot be kept is still read and posted with
// its title, reference and when, and says why it has no notes.
func TestASermonNotesMailWithoutOneGoodPDFIsReadWithoutNotes(t *testing.T) {
	for name, tc := range map[string]struct {
		parts []string
		why   string
	}{
		"no attachment":     {nil, "no PDF attached"},
		"an image only":     {[]string{pdfPart("image/png", "logo.png", []byte("\x89PNG"))}, "no PDF attached"},
		"two PDFs":          {[]string{pdfPart("application/pdf", "a.pdf", garbagePDF(100)), pdfPart("application/pdf", "b.pdf", garbagePDF(100))}, "2 PDFs attached, not one"},
		"over the limit":    {[]string{pdfPart("application/pdf", "notes.pdf", garbagePDF(alerts.MaxNotesBytes+1))}, fmt.Sprintf("the PDF is over %d bytes", alerts.MaxNotesBytes)},
		"not '%PDF-'":       {[]string{pdfPart("application/pdf", "notes.pdf", []byte("<html>a page, not a PDF</html>"))}, "the PDF does not begin %PDF-"},
		"a .pdf, not a PDF": {[]string{pdfPart("application/octet-stream", "notes.pdf", []byte("PK\x03\x04 a zip"))}, "the PDF does not begin %PDF-"},
		"broken base64":     {[]string{"Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0x!!!!not base64"}, "the PDF could not be decoded"},
	} {
		got := Parse(notesMail(tc.parts...))
		want := graceFacts
		want.NotesWhy = tc.why
		if got != want {
			t.Errorf("%s: Parse =\n %+v\nwant\n %+v", name, Facts{Kind: got.Kind, Title: got.Title, Reference: got.Reference, When: got.When, NotesWhy: got.NotesWhy, Subject: got.Subject}, want)
		}
		if got.Alert().Notes != "" {
			t.Errorf("%s: the alert carries notes", name)
		}
	}
}

// withPDF is a fixture with a PDF attached: the mail made multipart/mixed, its
// own body the first part.
func withPDF(t *testing.T, raw []byte) []byte {
	t.Helper()
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(msg.Body)
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	for name, values := range msg.Header {
		if strings.EqualFold(name, "Content-Type") || strings.EqualFold(name, "Content-Transfer-Encoding") {
			continue
		}
		for _, v := range values {
			b.WriteString(name + ": " + v + "\r\n")
		}
	}
	b.WriteString("Content-Type: multipart/mixed; boundary=\"withpdf\"\r\n\r\n--withpdf\r\n")
	b.WriteString("Content-Type: " + msg.Header.Get("Content-Type") + "\r\n")
	if cte := msg.Header.Get("Content-Transfer-Encoding"); cte != "" {
		b.WriteString("Content-Transfer-Encoding: " + cte + "\r\n")
	}
	b.WriteString("\r\n" + string(body) + "\r\n--withpdf\r\n" + pdfPart("application/pdf", "statement.pdf", garbagePDF(500)) + "\r\n--withpdf--\r\n")
	return []byte(b.String())
}

// Nothing but a sermon-notes mail keeps an attachment: a bank alert, a Gmail
// confirmation and a "Notes for" subject from another domain, each with a PDF
// attached, are read as before and carry no notes.
func TestOnlyASermonNotesMailKeepsItsPDF(t *testing.T) {
	for _, file := range []string{"chase.eml", "citi.eml", "pnc-deposit.eml", "pnc-zelle-sent.eml", "amazon-order.eml", "gmail-confirm.eml", "unknown.eml"} {
		plain := Parse(fixture(t, file))
		got := Parse(withPDF(t, fixture(t, file)))
		if got != plain {
			t.Errorf("%s with a PDF attached: Parse =\n %+v\nwant, as without it,\n %+v", file, got, plain)
		}
		if got.Notes != "" || got.Alert().Notes != "" {
			t.Errorf("%s: a PDF was kept", file)
		}
	}
	forged := strings.Replace(string(notesMail(pdfPart("application/pdf", "notes.pdf", garbagePDF(500)))), "noreply@mail.subsplash.com", "x@example.com", 1)
	if got := Parse([]byte(forged)); got.Kind != alerts.KindUnread || got.Notes != "" || got.Alert().Notes != "" {
		t.Fatalf("a Notes for subject from another domain = kind %q, %d bytes of notes; want unread with none", got.Kind, len(got.Notes))
	}
}

// The receiver keeps the PDF's bytes and never reads one, so it needs no PDF
// library: go.mod requires none.
func TestNoPDFLibraryIsRequired(t *testing.T) {
	mod, err := os.ReadFile(filepath.Join("..", "..", "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(mod)), "pdf") {
		t.Fatalf("go.mod requires a PDF library:\n%s", mod)
	}
}
