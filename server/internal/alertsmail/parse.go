// Package alertsmail is the alerts mail receiver (docs/protocol.md §26,
// docs/alerts-mail.md): an SMTP listener that takes mail only for a family's
// address token, reads each mail in memory into the facts §26 keeps, posts
// them to the backend and keeps nothing of the mail. The one exception is a
// sermon-notes mail's attached notes PDF, whose bytes it posts unread.
package alertsmail

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"html"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/url"
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
	// Notes is a sermon-notes mail's one attached PDF, its bytes as they came
	// and never read; NotesWhy says why a sermon-notes mail has none. Every
	// other kind of mail leaves both empty: its attachments are never read.
	Notes    string
	NotesWhy string
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
		Notes:     f.notesBase64(),
	}
}

// notesBase64 is the notes as POST /api/alerts/inbound takes them: base64, and
// only for a sermon-notes alert.
func (f Facts) notesBase64() string {
	if f.Kind != alerts.KindSermonNotes || f.Notes == "" {
		return ""
	}
	return base64.StdEncoding.EncodeToString([]byte(f.Notes))
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
	m := mailView{subject: subject, from: senderDomain(msg.Header.Get("From")), date: mailDate(msg.Header), misses: new([]string)}
	m.lines = textLines(msg.Header.Get("Content-Type"), msg.Header.Get("Content-Transfer-Encoding"), msg.Body)
	for _, parse := range []func(mailView) (Facts, bool){parseChase, parseCiti, parsePNCZelleSent, parsePNCDeposit, parseAmazon, parseGmailConfirm, parseSermonNotes} {
		if facts, ok := parse(m); ok {
			if facts.Kind == alerts.KindSermonNotes {
				facts.Notes, facts.NotesWhy = sermonNotesPDF(raw)
			}
			return facts
		}
	}
	if len(*m.misses) > 0 {
		log.Printf("alerts-mail: a mail is unread; the checks that nearly fit it failed: %s", strings.Join(*m.misses, "; "))
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
	// misses is what the parsers a mail nearly fit say failed (see miss).
	misses *[]string
}

// miss notes which check of a parser a mail failed, when its sender or its
// subject nearly fit that parser. Parse logs the notes in one line, and only
// if no parser reads the mail, so a PNC deposit that the Zelle parser passes
// over logs nothing. A note is fixed words and, at most, the sender's domain
// through hostName: never a token, an address, a subject, a body, an amount, a
// merchant or an account.
func (m mailView) miss(parser, failed string) {
	if m.misses != nil {
		*m.misses = append(*m.misses, parser+": "+failed)
	}
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
		m.miss("chase", "no amount")
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
	if !m.fromDomain("citi.com") {
		return Facts{}, false
	}
	if !strings.Contains(strings.ToLower(m.subject), "transaction") {
		m.miss("citi", `subject has no "transaction"`)
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
		m.miss("citi", "no amount")
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
	if f.Merchant == "" {
		m.miss("pnc zelle-sent", "no payee")
		return Facts{}, false
	}
	if f.Amount == "" {
		m.miss("pnc zelle-sent", "no amount")
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
	if !m.fromDomain("pnc.com") {
		return Facts{}, false
	}
	if !strings.Contains(strings.ToLower(m.subject), "deposit") {
		m.miss("pnc deposit", `subject has no "deposit"`)
		return Facts{}, false
	}
	f := Facts{Kind: alerts.KindDeposit, Merchant: m.value("Deposit made by"), Amount: money(m.value("Amount"))}
	if f.Amount == "" {
		if s := pncDepositAmount.FindStringSubmatch(m.subject); s != nil {
			f.Amount = money(s[1])
		}
	}
	if f.Amount == "" {
		m.miss("pnc deposit", "no amount")
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
		m.miss("amazon", "no order number")
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
// confirm (https://mail-settings.google.com/mail/vf-..., or on another of
// alerts.ConfirmHosts) and one to cancel (.../uf-...), and no code. A
// "(#123456789) ..." subject or "Confirmation code: 123456789" line, as older
// mails had, is still read.
//
// A mail to a family's address can be forged, From included, so the family
// sees nothing of this mail unless it is from google.com, and a link only when
// its whole form is a confirm link: the cancel link and any link of a forger
// are never kept. A mail that gives neither code nor link is unread; one that
// gives no link says in the log which check failed (logConfirmMiss).
func parseGmailConfirm(m mailView) (Facts, bool) {
	if !strings.Contains(m.subject, "Gmail Forwarding Confirmation") {
		return Facts{}, false
	}
	if m.from != "google.com" {
		log.Printf("alerts-mail: a Gmail forwarding confirmation is unread: sender's domain %q, not google.com", hostName(m.from))
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
	if f.Link == "" {
		logConfirmMiss(m.lines)
	}
	if f.Code == "" && f.Link == "" {
		return Facts{}, false
	}
	return f, true
}

// logConfirmMiss logs why a confirmation from google.com gave no link: the
// host of each link in it and the check that link failed, or that it had no
// link at all. It never logs a token, a path or an address.
func logConfirmMiss(lines []string) {
	var rejected []string
	for _, line := range lines {
		for _, word := range strings.Fields(line) {
			if strings.Contains(word, "://") {
				host, failed := confirmLinkMiss(word)
				rejected = append(rejected, fmt.Sprintf("%q (%s)", host, failed))
			}
		}
	}
	if len(rejected) == 0 {
		log.Printf("alerts-mail: a Gmail forwarding confirmation from google.com gave no confirm link: no link in %d lines", len(lines))
		return
	}
	log.Printf("alerts-mail: a Gmail forwarding confirmation from google.com gave no confirm link: links turned down: %s", strings.Join(rejected, ", "))
}

// confirmLinkMiss is the host of a link that is not a confirm link, and the
// first check of alerts.IsConfirmLink it fails.
func confirmLinkMiss(link string) (host, failed string) {
	u, err := url.Parse(link)
	if err != nil {
		return "", "not a link"
	}
	host = hostName(u.Hostname())
	scheme, rest, _ := strings.Cut(link, "://")
	if scheme != "https" {
		return host, "not https"
	}
	allowed := false
	for _, h := range alerts.ConfirmHosts {
		if strings.HasPrefix(rest, h+"/") {
			allowed, rest = true, strings.TrimPrefix(rest, h)
			break
		}
	}
	switch {
	case !allowed:
		return host, "host not on the allow-list"
	case strings.HasPrefix(rest, "/mail/uf-"):
		return host, "the cancel link"
	case !strings.HasPrefix(rest, "/mail/vf-"):
		return host, "path not /mail/vf-"
	case utf8.RuneCountInString(link) > alerts.MaxLinkRunes:
		return host, fmt.Sprintf("longer than %d characters", alerts.MaxLinkRunes)
	}
	return host, "not a token after /mail/vf-"
}

var hostPattern = regexp.MustCompile(`^[a-z0-9.-]{1,253}$`)

// hostName is a host as the log may hold it: a host name, and nothing that
// could be an address or a token.
func hostName(host string) string {
	if host = strings.ToLower(host); hostPattern.MatchString(host) {
		return host
	}
	return "(not a host name)"
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
// read as text (textLines skips every attachment); Parse takes its bytes with
// sermonNotesPDF. The date is the mail's own Date when no line is a date.
func parseSermonNotes(m mailView) (Facts, bool) {
	s := sermonNotesSubject.FindStringSubmatch(m.subject)
	if !m.fromDomain("subsplash.com") {
		if s != nil {
			m.miss("sermon notes", fmt.Sprintf("sender's domain %q, not subsplash.com", hostName(m.from)))
		}
		return Facts{}, false
	}
	if s == nil {
		m.miss("sermon notes", `subject is not Notes for "title"`)
		return Facts{}, false
	}
	if strings.TrimSpace(s[1]) == "" {
		m.miss("sermon notes", "the title is blank")
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

// sermonNotesPDF is the one PDF attached to a sermon-notes mail, as the bytes
// it came as, or "" and why there is none: no PDF, more than one, one over
// alerts.MaxNotesBytes, one that does not begin '%PDF-' or cannot be decoded.
// A part is a PDF by its type (application/pdf) or its file name (.pdf).
// Nothing reads the PDF past its first five bytes: the sermon index reads it.
func sermonNotesPDF(raw []byte) (notes, why string) {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return "", "the mail could not be read again"
	}
	var pdfs []mimePart
	walkParts(msg.Header.Get("Content-Type"), msg.Header.Get("Content-Transfer-Encoding"), msg.Body, func(p mimePart) {
		if p.mediaType == "application/pdf" || strings.HasSuffix(strings.ToLower(p.filename), ".pdf") {
			pdf := p
			// the body is read before the walk moves on: keep the bytes only
			pdf.data, pdf.err = io.ReadAll(io.LimitReader(decodeReader(p.encoding, p.body), alerts.MaxNotesBytes+1))
			pdfs = append(pdfs, pdf)
		}
	})
	switch {
	case len(pdfs) == 0:
		return "", "no PDF attached"
	case len(pdfs) > 1:
		return "", fmt.Sprintf("%d PDFs attached, not one", len(pdfs))
	}
	pdf := pdfs[0]
	switch {
	case pdf.err != nil:
		return "", "the PDF could not be decoded"
	case len(pdf.data) > alerts.MaxNotesBytes:
		return "", fmt.Sprintf("the PDF is over %d bytes", alerts.MaxNotesBytes)
	case !bytes.HasPrefix(pdf.data, []byte("%PDF-")):
		return "", "the PDF does not begin %PDF-"
	}
	return string(pdf.data), ""
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

// mimePart is one part of a mail that is not a multipart, as walkParts finds
// it: its type, the disposition's kind ("attachment", "inline" or "") and the
// file name the disposition or the type gives, and its body, still encoded.
type mimePart struct {
	mediaType   string
	params      map[string]string
	disposition string
	filename    string
	encoding    string
	body        io.Reader
	// data and err are what sermonNotesPDF decoded of the body.
	data []byte
	err  error
}

// walkParts calls visit with each part of a mail that is not a multipart, in
// order, at most maxParts parts and maxDepth multiparts deep. A part inside a
// multipart that is an attachment is an attachment too. A part's body is good
// only until visit returns.
func walkParts(contentType, encoding string, body io.Reader, visit func(mimePart)) {
	parts := 0
	var walk func(contentType, encoding, disposition string, body io.Reader, depth int, inAttachment bool)
	walk = func(contentType, encoding, disposition string, body io.Reader, depth int, inAttachment bool) {
		parts++
		if parts > maxParts {
			return
		}
		mediaType, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			mediaType, params = "text/plain", map[string]string{}
		}
		kind, dispParams, dispErr := mime.ParseMediaType(disposition)
		if dispErr == nil && kind == "attachment" {
			inAttachment = true
		}
		if strings.HasPrefix(mediaType, "multipart/") {
			if depth >= maxDepth || params["boundary"] == "" {
				return
			}
			reader := multipart.NewReader(body, params["boundary"])
			for {
				part, err := reader.NextRawPart()
				if err != nil {
					return
				}
				walk(part.Header.Get("Content-Type"), part.Header.Get("Content-Transfer-Encoding"), part.Header.Get("Content-Disposition"), part, depth+1, inAttachment)
			}
		}
		p := mimePart{mediaType: mediaType, params: params, encoding: encoding, body: body, filename: params["name"]}
		if dispErr == nil {
			p.disposition = kind
			if dispParams["filename"] != "" {
				p.filename = dispParams["filename"]
			}
		}
		if inAttachment {
			p.disposition = "attachment"
		}
		visit(p)
	}
	walk(contentType, encoding, "", body, 0, false)
}

// textLines is the mail's text, one trimmed line per line of text or block of
// HTML, empty lines dropped. The HTML part is read when there is one, as it
// is the part a mail app shows; the plain part otherwise. An attachment is
// never read.
func textLines(contentType, encoding string, body io.Reader) []string {
	var plain, htmlText string
	walkParts(contentType, encoding, body, func(p mimePart) {
		switch {
		case p.disposition == "attachment":
		case p.mediaType == "text/html" && htmlText == "":
			htmlText = htmlToText(decodeBody(p.encoding, p.params["charset"], p.body))
		case p.mediaType == "text/plain" && plain == "":
			plain = decodeBody(p.encoding, p.params["charset"], p.body)
		}
	})
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

// decodeReader reads a part's body through its transfer encoding.
func decodeReader(encoding string, body io.Reader) io.Reader {
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "quoted-printable":
		return quotedprintable.NewReader(body)
	case "base64":
		return base64.NewDecoder(base64.StdEncoding, &skipSpace{r: body})
	}
	return body
}

func decodeBody(encoding, charset string, body io.Reader) string {
	raw, _ := io.ReadAll(decodeReader(encoding, body))
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
