// Package poller walks the postern anchor address's history, indexing every
// output that carries an nftgate record and skipping any transaction it has
// already processed.
package poller

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/index"
	"github.com/Jonathan-A-White/postern/server/internal/record"
	"github.com/Jonathan-A-White/postern/server/internal/woc"
)

// DefaultInterval is how often Run polls the anchor address.
const DefaultInterval = 5 * time.Second

// Notifier is told about every record the poller newly stores, so it can
// push to any subscription addressed by that record's payload. A record
// with no payload, or a payload NotifyRecord doesn't recognise as addressed,
// is its business to ignore, not the poller's.
type Notifier interface {
	NotifyRecord(txid string, payload json.RawMessage) error
}

// Poller polls one anchor address via client and stores what it finds in
// store.
type Poller struct {
	client   *woc.Client
	store    *index.Store
	anchor   string
	interval time.Duration
	notifier Notifier
}

// Option configures a Poller constructed by New.
type Option func(*Poller)

// WithNotifier tells the Poller to notify n of every record it newly stores.
func WithNotifier(n Notifier) Option {
	return func(p *Poller) { p.notifier = n }
}

// New builds a Poller for anchor, using DefaultInterval between passes.
func New(client *woc.Client, store *index.Store, anchor string, opts ...Option) *Poller {
	p := &Poller{client: client, store: store, anchor: anchor, interval: DefaultInterval}
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
			p.PollOnce() //nolint:errcheck // logged by the caller's own poll loop in a later story; nothing to do with the error here but try again next tick
		}
	}
}

// PollOnce walks the anchor address's history once: every transaction not
// already seen is fetched exactly once, and every output of it that carries
// an nftgate record is stored. A transaction with no record-carrying output
// is still marked seen, so it isn't re-fetched on the next pass.
func (p *Poller) PollOnce() error {
	history, err := p.client.GetHistory(p.anchor)
	if err != nil {
		return fmt.Errorf("fetching anchor history: %w", err)
	}

	for _, entry := range history {
		if p.store.SeenTx(entry.TxHash) {
			continue
		}

		if err := p.processTx(entry.TxHash, entry.Height); err != nil {
			return fmt.Errorf("processing tx %s: %w", entry.TxHash, err)
		}
	}

	return nil
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

	found := false
	for _, output := range outputs {
		decoded, ok := record.DecodeScript(output.ScriptHex)
		if !ok {
			continue
		}

		found = true
		if _, err := p.store.Append(index.Record{
			TxID:      txid,
			Vout:      output.Vout,
			ScriptHex: output.ScriptHex,
			Height:    height,
			FirstSeen: time.Now().UTC(),
			Payload:   decoded.Payload,
		}); err != nil {
			return fmt.Errorf("storing record: %w", err)
		}

		if p.notifier != nil {
			_ = p.notifier.NotifyRecord(txid, decoded.Payload) //nolint:errcheck // a push failure shouldn't block indexing; nothing to do with the error here but try again on the next matching record
		}
	}

	if !found {
		p.store.MarkSeen(txid)
	}
	return nil
}
