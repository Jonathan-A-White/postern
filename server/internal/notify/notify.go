// Package notify is the one fan-out for "a record was indexed": the poller
// (a record found on chain) and direct delivery (docs/protocol.md §9) both
// hand every record they newly store to a Notifier, which in the running
// backend is a Fanout of the web push sender, the event stream's hub and the
// on-message hook.
package notify

import "github.com/Jonathan-A-White/postern/server/internal/index"

// Notifier is told about every record newly stored in the index, whichever
// channel it arrived by. RecordIndexed must not block for long: it runs on
// the poller's loop and in a direct delivery's request.
type Notifier interface {
	RecordIndexed(rec index.Record)
}

// Fanout tells each of its notifiers about a record, in order, skipping nil
// entries (an unconfigured hook, say).
type Fanout []Notifier

// RecordIndexed tells every notifier in f about rec.
func (f Fanout) RecordIndexed(rec index.Record) {
	for _, n := range f {
		if n != nil {
			n.RecordIndexed(rec)
		}
	}
}

// Func adapts a plain function to a Notifier.
type Func func(rec index.Record)

// RecordIndexed calls fn(rec).
func (fn Func) RecordIndexed(rec index.Record) { fn(rec) }

// Only tells Notifier about the records Keep keeps and no others: the
// on-message hook skips grist for the mill, and the on-grist hook takes
// only that (docs/protocol.md §19).
type Only struct {
	Notifier Notifier
	Keep     func(rec index.Record) bool
}

// RecordIndexed tells o.Notifier about rec if o.Keep keeps it.
func (o Only) RecordIndexed(rec index.Record) {
	if o.Notifier != nil && o.Keep(rec) {
		o.Notifier.RecordIndexed(rec)
	}
}
