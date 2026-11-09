// Package alertsmail is the alerts mail receiver (docs/protocol.md §26,
// docs/alerts-mail.md): an SMTP listener that takes mail only for a family's
// address token, reads each mail in memory into the facts §26 keeps, posts
// them to the backend and keeps nothing of the mail.
package alertsmail

import (
	"bytes"
	"encoding/base64"
	"html"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // the card mails say ET; the VPS need not have a zone database
	"unicode"
	"unicode/utf8"

	"github.com/Jonathan-A-White/postern/server/internal/alerts"
)

// Facts is what one mail says, as far as the receiver understands it. OrderID
// and Items are an Amazon mail's; §26 has no field for them, so Alert leaves
// them out.
type Facts struct {
	Kind     string
	Amount   string
	Merchant string
	Last4    string
	When     string
	Subject  string
	Code     string
	Link     string
	OrderID  string
	Items    string
	Memo     string
	// Title and Reference are a sermon-notes mail's: the sermon and its passage.
	Title     string
	Reference string
}

// Alert is the facts as POST /api/alerts/inbound takes them: only §26's
// fields, each cut to its limit.
func (f Facts) Alert() alerts.Alert {
	return alerts.Alert{
		Kind:      f.Kind,
		Amount:    cut(f.Amount),
		Merchant:  cut(f.Merchant),
		Last4:     f.Last4,
		When:      f.When,
		Subject:   cut(f.Subject),
		Code:      cut(f.Code),
		Link:      f.Link,
		Memo:      cut(f.Memo),
		Title:     cut(f.Title),
		Reference: cut(f.Reference),
	}
}

// maxParts caps how many MIME parts are read from one mail, and maxDepth how
// deep multiparts nest, so a crafted mail cannot make the reader work hard.
const (
	maxParts = 20
	maxDepth = 4
)

// Parse reads a mail into its facts. It never fails: a mail it does not
// understand is unread, with its subject only.
func Parse(raw []byte) Facts {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return Facts{Kind: alerts.KindUnread}
	}
	subject := decodeHeader(msg.Header.Get("Subject"))
	unread := Facts{Kind: alerts.KindUnread, Subject: cut(subject)}
	m := mailView{subject: subject, from: senderDomain(msg.Header.Get("From")), date: mailDate(msg.Header)}
	m.lines = textLines(msg.Header.Get("Content-Type"), msg.Header.Get("Content-Transfer-Encoding"), msg.Body)
	for _, parse := range []func(mailView) (Facts, bool){parseChase, parseCiti, parsePNCZelleSent, parsePNCDeposit, parseAmazon, parseGmailConfirm, parseSermonNotes} {
		if facts, ok := parse(m); ok {
			return facts
		}
	}
	return unread
}

// mailView is a mail as the parsers read it: its subject, the domain of its
// sender, its Date header and its text, one line per block of the HTML.
type mailView struct {
	subject string
	from    string
	date    string
	lines   []string
}

func (m mailView) fromDomain(domain string) bool {
	return m.from == domain || strings.HasSuffix(m.from, "."+domain)
}

// ---- Chase -----------------------------------------------------------------

var (
	chaseSubject = regexp.MustCompile(`(?i)^You made an? \$([0-9,]+\.\d{2}) transaction with (.+)$`)
	chaseAccount = regexp.MustCompile(`\(\.\.\.(\d{4})\)`)
)

// parseChase reads a Chase transaction alert: "Account Prime Visa (...1234)",
// "Date Nov 2, 2026 at 12:42 PM ET", "Merchant ...", "Amount $9.38".
func parseChase(m mailView) (Facts, bool) {
	if !m.fromDomain("chase.com") {
		return Facts{}, false
	}
	f := Facts{Kind: alerts.KindCharge}
	f.Amount = money(m.value("Amount"))
	f.Merchant = m.value("Merchant")
	if s := chaseSubject.FindStringSubmatch(m.subject); s != nil {
		if f.Amount == "" {
			f.Amount = money(s[1])
		}
		if f.Merchant == "" {
			f.Merchant = strings.TrimSpace(s[2])
		}
	}
	if a := chaseAccount.FindStringSubmatch(m.value("Account")); a != nil {
		f.Last4 = a[1]
	}
	f.When = easternTime(strings.Replace(m.value("Date"), " at ", " ", 1), m.date,
		"Jan 2, 2006 3:04 PM", "January 2, 2006 3:04 PM", "Jan 2, 2006 15:04")
	if f.Amount == "" {
		return Facts{}, false
	}
	return f, true
}

// ---- Citi ------------------------------------------------------------------

var (
	citiAmount = regexp.MustCompile(`(?i)^Amount:?\s*(\$?[0-9,]+\.\d{2})$`)
	citiEnding = regexp.MustCompile(`(?i)ending in:?\s*(\d{4})\b`)
)

// parseCiti reads a Citi custom alert: "Amount: $187.53", "Card Ending In
// 4321", "Merchant ...", "Date 10/31/2026", "Time 04:53 PM ET".
func parseCiti(m mailView) (Facts, bool) {
	if !m.fromDomain("citi.com") || !strings.Contains(strings.ToLower(m.subject), "transaction") {
		return Facts{}, false
	}
	f := Facts{Kind: alerts.KindCharge}
	for _, line := range m.lines {
		if a := citiAmount.FindStringSubmatch(line); a != nil {
			f.Amount = money(a[1])
			break
		}
	}
	if f.Amount == "" {
		f.Amount = money(m.value("Amount"))
	}
	f.Merchant = m.value("Merchant")
	if last4 := m.value("Card Ending In"); isDigits(last4, 4) {
		f.Last4 = last4
	} else {
		for _, line := range m.lines {
			if e := citiEnding.FindStringSubmatch(line); e != nil {
				f.Last4 = e[1]
				break
			}
		}
	}
	f.When = easternTime(m.value("Date")+" "+m.value("Time"), m.date, "01/02/2006 03:04 PM", "1/2/2006 3:04 PM")
	if f.Amount == "" {
		return Facts{}, false
	}
	return f, true
}

// ---- PNC -------------------------------------------------------------------

var (
	pncZelleSubject  = regexp.MustCompile(`(?i)^You sent a Zelle\W*\s+payment to (.+)$`)
	pncZelleHeading  = regexp.MustCompile(`(?i)^You sent a payment to (.+)$`)
	pncDepositAmount = regexp.MustCompile(`(?i)^A \$([0-9,]+\.\d{2}) deposit was credited`)
	pncAccount       = regexp.MustCompile(`(?i)\bx(\d{4})$`)
	pncDate          = []string{"01/02/06", "1/2/06", "01/02/2006", "1/2/2006"}
)

// parsePNCZelleSent reads PNC's "You sent a Zelle payment to <payee>" alert:
// "From Account: x1234", "Amount: $25.00", "Payment Date: 11/02/26",
// "Memo: ...", "Transaction ID: ..." (the id is not kept). A payment with no
// payee or no amount is unread.
func parsePNCZelleSent(m mailView) (Facts, bool) {
	if !m.fromDomain("pnc.com") {
		return Facts{}, false
	}
	var payee string
	if s := pncZelleSubject.FindStringSubmatch(m.subject); s != nil {
		payee = strings.TrimSpace(s[1])
	} else {
		for _, line := range m.lines {
			if h := pncZelleHeading.FindStringSubmatch(line); h != nil {
				payee = strings.TrimSpace(h[1])
				break
			}
		}
	}
	f := Facts{Kind: alerts.KindZelleSent, Merchant: payee, Amount: money(m.value("Amount"))}
	if f.Merchant == "" || f.Amount == "" {
		return Facts{}, false
	}
	if a := pncAccount.FindStringSubmatch(m.value("From Account")); a != nil {
		f.Last4 = a[1]
	}
	f.Memo = m.valueBefore("Memo", "Transaction ID")
	f.When = pncWhen(m.value("Payment Date"), m.date)
	return f, true
}

// parsePNCDeposit reads PNC's "A $64.20 deposit was credited to your account."
// alert: "Account ending in: x1234", "Amount: $64.20", "Deposit made by:
// <payer>", "Date: 11/01/26". A deposit with no amount is unread.
func parsePNCDeposit(m mailView) (Facts, bool) {
	if !m.fromDomain("pnc.com") || !strings.Contains(strings.ToLower(m.subject), "deposit") {
		return Facts{}, false
	}
	f := Facts{Kind: alerts.KindDeposit, Merchant: m.value("Deposit made by"), Amount: money(m.value("Amount"))}
	if f.Amount == "" {
		if s := pncDepositAmount.FindStringSubmatch(m.subject); s != nil {
			f.Amount = money(s[1])
		}
	}
	if f.Amount == "" {
		return Facts{}, false
	}
	if a := pncAccount.FindStringSubmatch(m.value("Account ending in")); a != nil {
		f.Last4 = a[1]
	}
	f.When = pncWhen(m.value("Date"), m.date)
	return f, true
}

// pncWhen reads a PNC alert's date ("11/02/26", with no time) as RFC 3339:
// the mail's own Date when the mail came that same day (Eastern), which gives
// the time of day, else midnight Eastern of the day the mail names. A date it
// cannot read is the mail's own Date.
func pncWhen(date, mailDate string) string {
	day := easternTime(date, "", pncDate...)
	if day == "" {
		return mailDate
	}
	if sent, err := time.Parse(time.RFC3339, mailDate); err == nil {
		if loc, err := time.LoadLocation("America/New_York"); err == nil && sent.In(loc).Format("2006-01-02") == day[:10] {
			return mailDate
		}
	}
	return day
}

// ---- Amazon ----------------------------------------------------------------

var (
	amazonOrderID   = regexp.MustCompile(`\b(\d{3}-\d{7}-\d{7})\b`)
	amazonItemsLine = regexp.MustCompile(`(?i)^\d+ items?:\s*(.+)$`)
	amazonOrdered   = regexp.MustCompile(`(?i)^Ordered:?\s*(?:\d+ items?:\s*)?(.+)$`)
	amazonTotal     = regexp.MustCompile(`(?i)^(?:Grand|Order) Total:?\s*(\$?[0-9,]+\.\d{2})?$`)
)

// parseAmazon reads an Amazon order or shipment mail: "Order # 111-...",
// "3 items: 2 Widgets, 1 Kitchen Gadgets", "Grand Total: $42.17".
func parseAmazon(m mailView) (Facts, bool) {
	if !m.fromDomain("amazon.com") {
		return Facts{}, false
	}
	f := Facts{Kind: alerts.KindAmazon, Merchant: "Amazon", When: m.date}
	for i, line := range m.lines {
		if f.OrderID == "" && strings.Contains(strings.ToLower(line), "order") {
			if id := amazonOrderID.FindStringSubmatch(line); id != nil {
				f.OrderID = id[1]
			}
		}
		if f.Items == "" {
			if items := amazonItemsLine.FindStringSubmatch(line); items != nil {
				f.Items = items[1]
			}
		}
		if f.Amount == "" {
			if total := amazonTotal.FindStringSubmatch(line); total != nil {
				if total[1] != "" {
					f.Amount = money(total[1])
				} else if i+1 < len(m.lines) {
					f.Amount = money(m.lines[i+1])
				}
			}
		}
	}
	if f.Items == "" {
		if s := amazonOrdered.FindStringSubmatch(m.subject); s != nil {
			f.Items = strings.Trim(s[1], `"“” `)
		}
	}
	if f.OrderID == "" {
		return Facts{}, false
	}
	return f, true
}

// ---- Gmail's forwarding confirmation ---------------------------------------

var (
	gmailConfirmSubject = regexp.MustCompile(`^\(#(\d+)\) Gmail Forwarding Confirmation`)
	gmailConfirmBody    = regexp.MustCompile(`(?i)^Confirmation code:\s*(\d+)$`)
)

// parseGmailConfirm reads the mail Gmail sends to a new forwarding address:
// "(Gmail Forwarding Confirmation - Receive Mail from ...", with a link to
// confirm (https://mail.google.com/mail/vf-...) and one to cancel (.../uf-...)
// and no code. A "(#123456789) ..." subject or "Confirmation code: 123456789"
// line is still read, should Gmail ever send one.
//
// A mail to a family's address can be forged, From included, so the family
// sees nothing of this mail unless it is from google.com, and a link only when
// its whole form is a confirm link: the cancel link and any link of a forger
// are never kept. A mail that gives neither code nor link is unread.
func parseGmailConfirm(m mailView) (Facts, bool) {
	if m.from != "google.com" || !strings.Contains(m.subject, "Gmail Forwarding Confirmation") {
		return Facts{}, false
	}
	f := Facts{Kind: alerts.KindForwardConfirm, When: m.date}
	if s := gmailConfirmSubject.FindStringSubmatch(m.subject); s != nil {
		f.Code = s[1]
	}
	for _, line := range m.lines {
		if f.Code == "" {
			if b := gmailConfirmBody.FindStringSubmatch(line); b != nil {
				f.Code = b[1]
			}
		}
		if f.Link == "" {
			for _, word := range strings.Fields(line) {
				if alerts.IsConfirmLink(word) {
					f.Link = word
					break
				}
			}
		}
	}
	if f.Code == "" && f.Link == "" {
		return Facts{}, false
	}
	return f, true
}

// ---- Subsplash sermon notes ------------------------------------------------

var (
	// sermonNotesSubject: Notes for "The Day of the Lord" - 2 Peter 3:10-18,
	// the title in straight or curly quotes, the passage after a hyphen or a
	// typographic dash, the passage optional, a forward's prefix allowed. The
	// title takes everything up to the last closing quote before the dash.
	sermonNotesSubject = regexp.MustCompile(`(?i)^(?:(?:fwd?|re):\s*)*Notes for [“"](.+)[”"](?:\s+[-–—]\s+(.+))?$`)
	// sermonNotesDate: the layouts a notes mail's date line may take.
	sermonNotesDate = []string{
		"January 2, 2006", "Jan 2, 2006", "Monday, January 2, 2006", "Mon, Jan 2, 2006",
		"1/2/2006", "01/02/2006", "1/2/06", "01/02/06", "2006-01-02",
	}
	sermonNotesLabel = regexp.MustCompile(`(?i)^(?:sermon\s+)?date:\s*`)
)

// parseSermonNotes reads the notes mail a church sends from Subsplash, as the
// family forwards it to its sermon-notes address: the title and passage are in
// the subject ('Notes for "The Day of the Lord" - 2 Peter 3:10-18'), the date
// is a line of the body, and the notes are an attached PDF, which is never
// read (textLines skips every attachment). Only the title, the passage and
// the date are kept; the date is the mail's own Date when no line is a date.
func parseSermonNotes(m mailView) (Facts, bool) {
	if !m.fromDomain("subsplash.com") {
		return Facts{}, false
	}
	s := sermonNotesSubject.FindStringSubmatch(m.subject)
	if s == nil || strings.TrimSpace(s[1]) == "" {
		return Facts{}, false
	}
	f := Facts{Kind: alerts.KindSermonNotes, Title: strings.TrimSpace(s[1]), Reference: strings.TrimSpace(s[2]), When: m.date}
	for _, line := range m.lines {
		if when := easternTime(sermonNotesLabel.ReplaceAllString(line, ""), "", sermonNotesDate...); when != "" {
			f.When = when
			break
		}
	}
	return f, true
}

// ---- reading a mail --------------------------------------------------------

// value is what follows a label: the rest of the line ("Label: value") or,
// as a table renders, the next line ("Label" then "value").
func (m mailView) value(label string) string {
	for i, line := range m.lines {
		head, rest, found := strings.Cut(line, ":")
		if found && strings.EqualFold(strings.TrimSpace(head), label) {
			if rest = strings.TrimSpace(rest); rest != "" {
				return rest
			}
			if i+1 < len(m.lines) {
				return m.lines[i+1]
			}
		}
		if strings.EqualFold(line, label) && i+1 < len(m.lines) {
			return m.lines[i+1]
		}
	}
	return ""
}

// valueBefore is value for a field that may be empty: "Memo:" with nothing
// after it, then the next row's label (stop), has no value, where value would
// take that label for it.
func (m mailView) valueBefore(label, stop string) string {
	v := m.value(label)
	if strings.HasPrefix(strings.ToLower(v), strings.ToLower(stop)) {
		return ""
	}
	return v
}

var wordDecoder = &mime.WordDecoder{CharsetReader: charsetReader}

func decodeHeader(v string) string {
	if decoded, err := wordDecoder.DecodeHeader(v); err == nil {
		v = decoded
	}
	return strings.Join(strings.Fields(v), " ")
}

func senderDomain(from string) string {
	addr, err := mail.ParseAddress(decodeHeader(from))
	if err != nil {
		return ""
	}
	_, domain, _ := strings.Cut(addr.Address, "@")
	return strings.ToLower(domain)
}

func mailDate(h mail.Header) string {
	t, err := h.Date()
	if err != nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

// textLines is the mail's text, one trimmed line per line of text or block of
// HTML, empty lines dropped. The HTML part is read when there is one, as it
// is the part a mail app shows; the plain part otherwise.
func textLines(contentType, encoding string, body io.Reader) []string {
	var plain, htmlText string
	parts := 0
	var walk func(contentType, encoding, disposition string, body io.Reader, depth int)
	walk = func(contentType, encoding, disposition string, body io.Reader, depth int) {
		parts++
		if parts > maxParts {
			return
		}
		if kind, _, err := mime.ParseMediaType(disposition); err == nil && kind == "attachment" {
			return
		}
		mediaType, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			mediaType, params = "text/plain", map[string]string{}
		}
		switch {
		case strings.HasPrefix(mediaType, "multipart/"):
			if depth >= maxDepth || params["boundary"] == "" {
				return
			}
			reader := multipart.NewReader(body, params["boundary"])
			for {
				part, err := reader.NextRawPart()
				if err != nil {
					return
				}
				walk(part.Header.Get("Content-Type"), part.Header.Get("Content-Transfer-Encoding"), part.Header.Get("Content-Disposition"), part, depth+1)
			}
		case mediaType == "text/html" && htmlText == "":
			htmlText = htmlToText(decodeBody(encoding, params["charset"], body))
		case mediaType == "text/plain" && plain == "":
			plain = decodeBody(encoding, params["charset"], body)
		}
	}
	walk(contentType, encoding, "", body, 0)
	text := htmlText
	if strings.TrimSpace(text) == "" {
		text = plain
	}
	var lines []string
	for _, line := range strings.Split(text, "\n") {
		if line = clean(line); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func decodeBody(encoding, charset string, body io.Reader) string {
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "quoted-printable":
		body = quotedprintable.NewReader(body)
	case "base64":
		body = base64.NewDecoder(base64.StdEncoding, &skipSpace{r: body})
	}
	raw, _ := io.ReadAll(body)
	if r, err := charsetReader(charset, bytes.NewReader(raw)); err == nil {
		raw, _ = io.ReadAll(r)
	}
	return strings.ToValidUTF8(string(raw), "")
}

// charsetReader reads UTF-8 and ASCII as they are and Latin-1 (and the
// Windows code page mail calls it) a byte to a rune; any other charset is
// read as UTF-8, and what is not UTF-8 is dropped.
func charsetReader(charset string, input io.Reader) (io.Reader, error) {
	switch strings.ToLower(strings.TrimSpace(charset)) {
	case "iso-8859-1", "latin1", "windows-1252", "cp1252":
		raw, err := io.ReadAll(input)
		if err != nil {
			return nil, err
		}
		runes := make([]rune, len(raw))
		for i, b := range raw {
			runes[i] = rune(b)
		}
		return strings.NewReader(string(runes)), nil
	}
	return input, nil
}

// skipSpace drops the line breaks of a base64 body, which encoding/base64
// does not.
type skipSpace struct{ r io.Reader }

func (s *skipSpace) Read(p []byte) (int, error) {
	n, err := s.r.Read(p)
	kept := 0
	for _, b := range p[:n] {
		if b != '\r' && b != '\n' && b != ' ' && b != '\t' {
			p[kept] = b
			kept++
		}
	}
	return kept, err
}

var (
	htmlDropped = regexp.MustCompile(`(?is)<!--.*?-->|<(script|style|head|title)\b[^>]*>.*?</(script|style|head|title)\s*>`)
	htmlBlock   = regexp.MustCompile(`(?i)<\s*/?\s*(br|p|div|td|th|tr|table|tbody|thead|li|ul|ol|h[1-6]|center|section|article|header|footer|hr)\b[^>]*>`)
	htmlTag     = regexp.MustCompile(`(?s)<[^>]*>`)
)

// htmlToText is the text an HTML body shows: every block (a table cell, a
// paragraph, a line break) on its own line, the rest of the tags gone and
// entities read.
func htmlToText(body string) string {
	body = htmlDropped.ReplaceAllString(body, " ")
	// A block's own text may run over source lines; it is one line on screen.
	body = strings.NewReplacer("\r", " ", "\n", " ").Replace(body)
	body = htmlBlock.ReplaceAllString(body, "\n")
	body = htmlTag.ReplaceAllString(body, "")
	return html.UnescapeString(body)
}

// clean collapses a line's spaces and drops the invisible marks (bidi
// controls, zero-width spaces) mail puts around numbers.
func clean(line string) string {
	line = strings.Map(func(r rune) rune {
		switch {
		case r == ' ':
			return ' '
		case unicode.Is(unicode.Cf, r):
			return -1
		}
		return r
	}, line)
	return strings.Join(strings.Fields(line), " ")
}

var moneyPattern = regexp.MustCompile(`^\$?\s*([0-9][0-9,]*\.\d{2})$`)

// money is "$1,234.56" as "1234.56", or "" for anything that is not an amount.
func money(s string) string {
	m := moneyPattern.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return ""
	}
	return strings.ReplaceAll(m[1], ",", "")
}

var zoneNames = map[string]string{
	"ET": "America/New_York", "EST": "America/New_York", "EDT": "America/New_York",
	"CT": "America/Chicago", "CST": "America/Chicago", "CDT": "America/Chicago",
	"MT": "America/Denver", "MST": "America/Denver", "MDT": "America/Denver",
	"PT": "America/Los_Angeles", "PST": "America/Los_Angeles", "PDT": "America/Los_Angeles",
}

// easternTime reads a card mail's time ("Nov 2, 2026 12:42 PM ET"), in the
// zone it names (Eastern when it names none), as RFC 3339; or the mail's own
// Date when the time cannot be read.
func easternTime(s, fallback string, layouts ...string) string {
	s = strings.TrimSpace(s)
	zone := "America/New_York"
	if i := strings.LastIndexByte(s, ' '); i > 0 {
		if name, ok := zoneNames[strings.ToUpper(s[i+1:])]; ok {
			zone, s = name, s[:i]
		}
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return fallback
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t.Format(time.RFC3339)
		}
	}
	return fallback
}

func isDigits(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// cut keeps a text field to §26's limit.
func cut(s string) string {
	if utf8.RuneCountInString(s) <= alerts.MaxFieldRunes {
		return s
	}
	return string([]rune(s)[:alerts.MaxFieldRunes])
}
