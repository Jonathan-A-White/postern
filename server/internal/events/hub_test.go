package events

import (
	"testing"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/index"
)

func receive(t *testing.T, ch <-chan Event) (Event, bool) {
	t.Helper()
	select {
	case ev, ok := <-ch:
		return ev, ok
	case <-time.After(2 * time.Second):
		t.Fatal("no event within 2s")
		return Event{}, false
	}
}

func TestRecordIndexedPublishesAMessageEventToEverySubscriber(t *testing.T) {
	hub := NewHub()
	a, cancelA := hub.Subscribe()
	defer cancelA()
	b, cancelB := hub.Subscribe()
	defer cancelB()

	hub.RecordIndexed(index.Record{Seq: 43, TxID: "direct:ab"})

	for _, ch := range []<-chan Event{a, b} {
		ev, ok := receive(t, ch)
		if !ok || ev.Name != "message" || ev.Data != `{"seq":43}` {
			t.Fatalf("event = %+v (open=%v), want message {\"seq\":43}", ev, ok)
		}
	}
}

func TestViewChangedPublishesAViewEvent(t *testing.T) {
	hub := NewHub()
	ch, cancel := hub.Subscribe()
	defer cancel()

	hub.ViewChanged(`"abc123"`)

	ev, _ := receive(t, ch)
	if ev.Name != "view" || ev.Data != `{"etag":"\"abc123\""}` {
		t.Fatalf("event = %+v, want view {\"etag\":\"\\\"abc123\\\"\"}", ev)
	}
}

func TestASlowSubscriberIsDisconnectedWithoutBlockingOthers(t *testing.T) {
	hub := NewHub(WithBuffer(2))
	slow, cancelSlow := hub.Subscribe()
	defer cancelSlow()
	fast, cancelFast := hub.Subscribe()
	defer cancelFast()

	published := make(chan int)
	go func() {
		received := 0
		for seq := uint64(1); seq <= 5; seq++ {
			hub.RecordIndexed(index.Record{Seq: seq})
			select {
			case <-fast:
				received++
			case <-time.After(2 * time.Second):
			}
		}
		published <- received
	}()
	select {
	case received := <-published:
		if received != 5 {
			t.Fatalf("fast subscriber received %d events, want all 5", received)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("publishing blocked on a subscriber that never reads")
	}

	// The slow subscriber got what fit in its buffer, then its channel was
	// closed: its stream ends and the client reconnects to a fresh hello.
	for i := 0; i < 2; i++ {
		if _, ok := receive(t, slow); !ok {
			t.Fatalf("slow channel closed after %d events, want its 2 buffered ones first", i)
		}
	}
	if _, ok := receive(t, slow); ok {
		t.Fatal("slow subscriber still open after overflowing its buffer")
	}
	if n := hub.Subscribers(); n != 1 {
		t.Fatalf("Subscribers() = %d, want only the fast one left", n)
	}
}

func TestCancelRemovesTheSubscriberAndIsSafeToRepeat(t *testing.T) {
	hub := NewHub(WithBuffer(1))
	ch, cancel := hub.Subscribe()
	if hub.Subscribers() != 1 {
		t.Fatalf("Subscribers() = %d, want 1", hub.Subscribers())
	}
	cancel()
	cancel()
	if hub.Subscribers() != 0 {
		t.Fatalf("Subscribers() = %d after cancel, want 0", hub.Subscribers())
	}
	if _, ok := <-ch; ok {
		t.Fatal("channel still open after cancel")
	}

	// Overflow-closed, then cancelled by the stream's own cleanup.
	ch2, cancel2 := hub.Subscribe()
	hub.RecordIndexed(index.Record{Seq: 1})
	hub.RecordIndexed(index.Record{Seq: 2})
	cancel2()
	<-ch2
}
