package record

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// MessageClasses are the classes docs/protocol.md §1 defines for a message.
var MessageClasses = map[string]bool{
	"message":         true,
	"decision-needed": true,
	"landing":         true,
	"alarm":           true,
	"move-home":       true,
	ClassGrist:        true,
	ClassTalk:         true,
	ClassCall:         true,
	ClassEvents:       true,
}

// ClassGrist is an app's AI work for the factory, and the mill's answer to
// it (docs/protocol.md §19).
const ClassGrist = "grist"

// ClassTalk is a turn on the Talk line between the Governor and the Mayor
// (docs/protocol.md §20): it reaches the event stream only, never a push or
// a hook.
const ClassTalk = "talk"

// ClassCall is a call record between the Governor and the Mayor
// (docs/protocol.md §21): his Call me request, the Mayor's ring and his Later
// tap. The sealed plaintext holds the role, so the backend knows it only from the
// clear `role` the sender puts beside `ct` (Envelope.Role); like a talk turn a call
// record reaches the event stream and nothing else, but for a ring (RoleRing),
// which is also pushed.
const ClassCall = "call"

// RoleRing is the clear `role` of the Mayor's call-back, the one call record that is pushed.
const RoleRing = "ring"

// ClassEvents is a batch of factory events from the Mayor's host to the
// Governor (docs/protocol.md §22): like a talk turn it reaches the event
// stream and nothing else, never a hook, and no push but for an emergency
// (Envelope.Lane, LaneEmergency).
const ClassEvents = "events"

// LaneEmergency is the clear `lane` of an unbatched emergency events record, the one events record that is pushed.
const LaneEmergency = "emergency"

// Envelope is docs/protocol.md §1's clear message payload. The backend never
// decrypts Ct; it only checks the envelope's shape.
type Envelope struct {
	Class string
	To    string
	From  string
	Ts    json.Number
	Ct    string
	// Role is a call record's optional clear role (docs/protocol.md §21); empty when absent.
	Role string
	// Lane is an events record's optional clear lane (docs/protocol.md §22); empty when absent.
	Lane string
}

// ParseEnvelope checks payload is exactly §1's envelope — v 1, kind "msg",
// a known class, 66-hex to and from, a numeric ts and a string ct — and
// returns its fields, or an error naming the first thing wrong. Extra fields
// are ignored.
func ParseEnvelope(payload []byte) (Envelope, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil || fields == nil {
		return Envelope{}, fmt.Errorf("payload is not a JSON object")
	}

	var v json.Number
	if err := numberField(fields, "v", &v); err != nil {
		return Envelope{}, err
	}
	if v.String() != "1" {
		return Envelope{}, fmt.Errorf("payload v must be 1")
	}

	var env Envelope
	var kind string
	if err := stringField(fields, "kind", &kind); err != nil {
		return Envelope{}, err
	}
	if kind != "msg" {
		return Envelope{}, fmt.Errorf(`payload kind must be "msg"`)
	}
	if err := stringField(fields, "class", &env.Class); err != nil {
		return Envelope{}, err
	}
	if !MessageClasses[env.Class] {
		return Envelope{}, fmt.Errorf("payload class %q is not a known class", env.Class)
	}
	for _, key := range []struct {
		name string
		dst  *string
	}{{"to", &env.To}, {"from", &env.From}} {
		if err := stringField(fields, key.name, key.dst); err != nil {
			return Envelope{}, err
		}
		if raw, err := hex.DecodeString(*key.dst); err != nil || len(raw) != 33 {
			return Envelope{}, fmt.Errorf("payload %s must be 66 hex characters", key.name)
		}
	}
	if err := numberField(fields, "ts", &env.Ts); err != nil {
		return Envelope{}, err
	}
	if err := stringField(fields, "ct", &env.Ct); err != nil {
		return Envelope{}, err
	}
	if raw, ok := fields["role"]; ok {
		// A role that is not a string is no role: it never makes a record push-worthy.
		_ = json.Unmarshal(raw, &env.Role)
	}
	if raw, ok := fields["lane"]; ok {
		// A lane that is not a string is no lane: it never makes a record push-worthy.
		_ = json.Unmarshal(raw, &env.Lane)
	}
	return env, nil
}

func stringField(fields map[string]json.RawMessage, name string, dst *string) error {
	raw, ok := fields[name]
	if !ok || json.Unmarshal(raw, dst) != nil {
		return fmt.Errorf("payload %s must be a string", name)
	}
	return nil
}

func numberField(fields map[string]json.RawMessage, name string, dst *json.Number) error {
	raw, ok := fields[name]
	if !ok {
		return fmt.Errorf("payload %s must be a number", name)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("payload %s must be a number", name)
	}
	number, ok := value.(json.Number)
	if !ok {
		return fmt.Errorf("payload %s must be a number", name)
	}
	*dst = number
	return nil
}
