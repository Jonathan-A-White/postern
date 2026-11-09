package alertsmail

import (
	"bytes"
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

// A mail to a family's address can be forged, and From with it: the link on
// the family's screen is only ever one Gmail's confirmation can carry.
func TestAForgedConfirmationKeepsNoLinkAndIsUnread(t *testing.T) {
	cancel := "https://mail.google.com/mail/uf-%5BMADE-UP-CANCEL-TOKEN%5D--r8dYHz83JJWhOIEjymPq3BFiaY"
	for name, raw := range map[string][]byte{
		"from another domain":           gmailConfirmMail("forwarding-noreply@example.com", confirmLink),
		"from a look-alike domain":      gmailConfirmMail("forwarding-noreply@google.com.evil.example", confirmLink),
		"from a domain ending in it":    gmailConfirmMail("forwarding-noreply@notgoogle.com", confirmLink),
		"from no one":                   []byte("Subject: (Gmail Forwarding Confirmation - Receive Mail from x\r\n\r\n" + confirmLink + "\r\n"),
		"a link on another host":        gmailConfirmMail("forwarding-noreply@google.com", "https://evil.example/mail/vf-%5BX%5D--y"),
		"a link on a look-alike host":   gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com.evil.example/mail/vf-%5BX%5D--y"),
		"a link with userinfo":          gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com@evil.example/mail/vf-%5BX%5D--y"),
		"a link on a sibling host":      gmailConfirmMail("forwarding-noreply@google.com", "https://mail-settings.google.com/mail/vf-%5BX%5D--y"),
		"a link over plain http":        gmailConfirmMail("forwarding-noreply@google.com", "http://mail.google.com/mail/vf-%5BX%5D--y"),
		"a link on another path":        gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/accounts/vf-%5BX%5D--y"),
		"a link with a path before vf-": gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/mail/x/../vf-%5BX%5D--y"),
		"a link that redirects":         gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/mail/vf-%5BX%5D--y?continue=https://evil.example"),
		"a link with a fragment":        gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/mail/vf-%5BX%5D--y#https://evil.example"),
		"a link longer than any real":   gmailConfirmMail("forwarding-noreply@google.com", "https://mail.google.com/mail/vf-"+strings.Repeat("a", alerts.MaxLinkRunes)),
		"only the cancel link":          gmailConfirmMail("forwarding-noreply@google.com", cancel),
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

// A Subsplash notes mail (invented, shaped like the one the church sends): the
// title and passage are in the subject, the date in the body, and the notes PDF
// is attached. Only the title, the reference and the date are kept.
func TestASubsplashNotesMailYieldsTitleReferenceAndTheBodysDate(t *testing.T) {
	got := Parse(fixture(t, "subsplash-notes.eml"))
	want := Facts{Kind: alerts.KindSermonNotes, Title: "The Day of the Lord", Reference: "2 Peter 3:10-18", When: "2026-11-08T00:00:00-05:00"}
	if got != want {
		t.Fatalf("Parse(subsplash-notes.eml) =\n %+v\nwant\n %+v", got, want)
	}
	if alert := got.Alert(); alert != (alerts.Alert{Kind: "sermon-notes", Title: "The Day of the Lord", Reference: "2 Peter 3:10-18", When: "2026-11-08T00:00:00-05:00"}) {
		t.Fatalf("alert = %+v, want the title, reference and date only", alert)
	}
}

// The attached notes are never read: a part that is an attachment is skipped
// whatever its type, and nothing of it reaches the facts.
func TestASermonNotesAttachmentIsNeverReadOrKept(t *testing.T) {
	raw := fixture(t, "subsplash-notes.eml")
	got := Parse(raw)
	for name, field := range map[string]string{"title": got.Title, "reference": got.Reference, "when": got.When, "subject": got.Subject, "memo": got.Memo, "merchant": got.Merchant} {
		if strings.Contains(field, "INVENTED-NOTES-BODY-MARKER") {
			t.Errorf("%s holds the attachment's text", name)
		}
	}
	// a text attachment sorted before the body is still not the body
	text := strings.Replace(string(raw), "Content-Type: application/pdf; name=\"notes.pdf\"", "Content-Type: text/plain; name=\"notes.txt\"", 1)
	text = strings.Replace(text, "SU5WRU5URUQtTk9URVMtQk9EWS1NQVJLRVI=", "Tm92IDEsIDIwMjYK", 1) // "Nov 1, 2026"
	if again := Parse([]byte(text)); again != got {
		t.Fatalf("a text attachment changed the facts: %+v, want %+v", again, got)
	}
	if lines := textLines("multipart/mixed; boundary=\"b\"", "", strings.NewReader("--b\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=\"n.txt\"\r\n\r\nSECRET NOTES\r\n--b--\r\n")); len(lines) != 0 {
		t.Fatalf("an attachment was read: %q", lines)
	}
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
var madeUpAmounts = map[string]bool{"0.00": true, "9.38": true, "187.53": true, "76.25": true, "42.17": true, "10.00": true, "25.00": true, "64.20": true}

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
