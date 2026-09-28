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
