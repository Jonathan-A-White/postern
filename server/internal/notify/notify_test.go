package notify

import (
	"testing"

	"github.com/Jonathan-A-White/postern/server/internal/index"
)

func TestFanoutTellsEveryNotifierInOrderSkippingNil(t *testing.T) {
	var calls []string
	record := func(name string) Notifier {
		return Func(func(rec index.Record) { calls = append(calls, name+":"+rec.TxID) })
	}

	fan := Fanout{record("push"), nil, record("events"), record("hook")}
	fan.RecordIndexed(index.Record{Seq: 7, TxID: "direct:ab"})

	want := []string{"push:direct:ab", "events:direct:ab", "hook:direct:ab"}
	if len(calls) != len(want) {
		t.Fatalf("calls = %v, want %v", calls, want)
	}
	for i := range want {
		if calls[i] != want[i] {
			t.Fatalf("calls = %v, want %v", calls, want)
		}
	}
}

func TestOnlyTellsItsNotifierJustTheRecordsItKeeps(t *testing.T) {
	var told []string
	only := Only{
		Notifier: Func(func(rec index.Record) { told = append(told, rec.TxID) }),
		Keep:     func(rec index.Record) bool { return rec.TxID != "direct:skip" },
	}
	only.RecordIndexed(index.Record{TxID: "direct:keep"})
	only.RecordIndexed(index.Record{TxID: "direct:skip"})
	if len(told) != 1 || told[0] != "direct:keep" {
		t.Fatalf("told = %v, want just direct:keep", told)
	}
}
