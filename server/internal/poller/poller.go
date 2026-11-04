// Package poller walks the postern anchor address's history, indexing every
// output that carries an nftgate record and skipping any transaction it has
// already processed.
package poller

import (
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/notify"
	"github.com/Jonathan-A-White/postern/server/internal/record"
)

// DefaultInterval is how often Run polls the anchor address.
const DefaultInterval = 5 * time.Second

// AlarmAfter is how long polls may fail in a row before the poller raises
// its alarm (one log line, and Status.Alarm).
const AlarmAfter = 10 * time.Minute

// relogAfter is how long the same error goes unsaid in the log before it is
// said again, so a failure that goes on is a line every few minutes, not every
// 5 s tick.
const relogAfter = 30 * time.Minute

// Status is what the poller says of itself, for GET /healthz: when it last
// read the anchor to the end, and the error of the polls failing now.
type Status struct {
	OK           bool      `json:"ok"`                    // the last poll succeeded (or none has run yet)
	LastGoodPoll time.Time `json:"lastGoodPoll,omitzero"` // when a poll last read everything new
	LastError    string    `json:"lastError,omitempty"`   // the failing polls' latest error
	LastErrorAt  time.Time `json:"lastErrorAt,omitzero"`  // when it came
	FailingSince time.Time `json:"failingSince,omitzero"` // when the polls began failing in a row
	Alarm        bool      `json:"alarm"`                 // failing for AlarmAfter or more
}

// Poller polls one anchor address via client and stores what it finds in
// store.
type Poller struct {
	client   chain.Reader
	store    *index.Store
	anchor   string
	interval time.Duration
	notifier notify.Notifier
	logf     func(format string, args ...any)
	now      func() time.Time

	// retry holds the transactions that failed in an earlier poll: the
	// next poll's walk stops at a page it knows, which may lie past them.
	retry map[string]int // txid -> height

	mu       sync.Mutex
	status   Status
	loggedAt time.Time // when the error now failing was last said in the log
	alarmed  bool
}

// WithLogf overrides log.Printf for the poller's failure and alarm lines.
func WithLogf(logf func(format string, args ...any)) Option {
	return func(p *Poller) { p.logf = logf }
}

// WithClock overrides time.Now, for the status and the alarm's ten minutes.
func WithClock(now func() time.Time) Option {
	return func(p *Poller) { p.now = now }
}

// Option configures a Poller constructed by New.
type Option func(*Poller)

// WithNotifier tells the Poller to notify n of every record it newly stores
// (the same notify.Notifier direct delivery tells). A record n doesn't care
// about — no payload, not addressed — is n's business to ignore.
func WithNotifier(n notify.Notifier) Option {
	return func(p *Poller) { p.notifier = n }
}

// New builds a Poller for anchor, using DefaultInterval between passes.
func New(client chain.Reader, store *index.Store, anchor string, opts ...Option) *Poller {
	p := &Poller{client: client, store: store, anchor: anchor, interval: DefaultInterval,
		logf: log.Printf, now: time.Now, retry: map[string]int{}, status: Status{OK: true}}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

// Run polls at p.interval until stop is closed.
func (p *Poller) Run(stop <-chan struct{}) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			p.poll()
		}
	}
}

// poll is one tick of Run: PollOnce, then the status and the log say how it
// went. A failure is logged when it starts, again when it changes or has gone
// unsaid for relogAfter, and its alarm once, AlarmAfter into it.
func (p *Poller) poll() {
	err := p.PollOnce()
	now := p.now()

	p.mu.Lock()
	defer p.mu.Unlock()
	if err == nil {
		if !p.status.OK {
			p.logf("poll recovered: failing since %s", p.status.FailingSince.Format(time.RFC3339))
		}
		p.status = Status{OK: true, LastGoodPoll: now}
		p.alarmed, p.loggedAt = false, time.Time{}
		return
	}

	msg := err.Error()
	if p.status.OK {
		p.status.FailingSince = now
	}
	changed := msg != p.status.LastError
	p.status.OK, p.status.LastError, p.status.LastErrorAt = false, msg, now
	if p.loggedAt.IsZero() || changed || now.Sub(p.loggedAt) >= relogAfter {
		p.logf("poll failed: %s", msg)
		p.loggedAt = now
	}
	if !p.alarmed && now.Sub(p.status.FailingSince) >= AlarmAfter {
		p.alarmed = true
		p.logf("poll alarm: polls have failed since %s (%s): new messages are not reaching the Mayor", p.status.FailingSince.Format(time.RFC3339), msg)
	}
	p.status.Alarm = p.alarmed
}

// Status says when the last good poll was and what the failing ones say.
func (p *Poller) Status() Status {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.status
}

// history is what is new at the anchor: when the client can read only the
// newest pages (chain.RecentReader) it reads back to the first page it knows
// every transaction of, else the whole history.
func (p *Poller) history() ([]chain.HistoryEntry, error) {
	if recent, ok := p.client.(chain.RecentReader); ok {
		return recent.GetRecentHistory(p.anchor, p.store.SeenTx)
	}
	return p.client.GetHistory(p.anchor)
}

// PollOnce walks the anchor address's history once: every transaction not
// already seen is fetched exactly once, and every output of it that carries
// an nftgate record is stored. A transaction with no record-carrying output
// is still marked seen, so it isn't re-fetched on the next pass. A
// transaction that fails does not hold back the ones behind it: every one is
// tried, the failures are retried by the next poll, and the error names them.
func (p *Poller) PollOnce() error {
	history, err := p.history()
	if err != nil {
		return fmt.Errorf("fetching anchor history: %w", err)
	}

	// What failed before comes first (it is older), unless the walk met it again.
	inWalk := make(map[string]bool, len(history))
	for _, entry := range history {
		inWalk[entry.TxHash] = true
	}
	var todo []chain.HistoryEntry
	for txid, height := range p.retry {
		if !inWalk[txid] {
			todo = append(todo, chain.HistoryEntry{TxHash: txid, Height: height})
		}
	}
	todo = append(todo, history...)

	var failures []error
	for _, entry := range todo {
		if p.store.SeenTx(entry.TxHash) {
			delete(p.retry, entry.TxHash)
			continue
		}

		if err := p.processTx(entry.TxHash, entry.Height); err != nil {
			p.retry[entry.TxHash] = entry.Height
			failures = append(failures, fmt.Errorf("processing tx %s: %w", entry.TxHash, err))
			continue
		}
		delete(p.retry, entry.TxHash)
	}

	if len(failures) > 3 {
		return fmt.Errorf("%d transactions failed, the first: %w", len(failures), failures[0])
	}
	return errors.Join(failures...)
}

func (p *Poller) processTx(txid string, height int) error {
	rawTxHex, err := p.client.GetTransactionHex(txid)
	if err != nil {
		return fmt.Errorf("fetching tx hex: %w", err)
	}

	outputs, err := record.ParseTransactionOutputs(rawTxHex)
	if err != nil {
		return fmt.Errorf("parsing tx: %w", err)
	}
	signer, _ := record.ExtractSignerPublicKey(rawTxHex) // "" if the scriptSig isn't pubkey-shaped

	found := false
	for _, output := range outputs {
		decoded, ok := record.DecodeScript(output.ScriptHex)
		if !ok {
			continue
		}

		found = true
		stored, err := p.store.Append(index.Record{
			TxID:      txid,
			Vout:      output.Vout,
			ScriptHex: output.ScriptHex,
			Height:    height,
			FirstSeen: time.Now().UTC(),
			Payload:   decoded.Payload,
			Signer:    signer,
		})
		if err != nil {
			return fmt.Errorf("storing record: %w", err)
		}

		if p.notifier != nil {
			p.notifier.RecordIndexed(stored)
		}
	}

	if !found {
		p.store.MarkSeen(txid)
	}
	return nil
}
