package register

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// PeopleFile is what the store keeps under POSTERN_DATA: every person, by
// fingerprint. No email or phone is ever written to it.
const PeopleFile = "register-people.json"

// Device is one key on a person's licence. LicenceTxid is the mint the site
// issuer licensed it with (its licence's origin is LicenceTxid:0); empty for
// a device added before the site issuer licensed any. LastSeen is when its
// licence last passed a gated route, to the minute (see Seen); nil for a
// device not seen using it yet.
type Device struct {
	Key         string     `json:"key"`
	Name        string     `json:"name"`
	AddedAt     time.Time  `json:"addedAt"`
	LastSeen    *time.Time `json:"lastSeen,omitempty"`
	LicenceTxid string     `json:"licenceTxid,omitempty"`
}

// person is one human who proved an email and a phone: the keyed
// fingerprints of the first email (FpE), any later emails a joining device
// used (MoreFpE: each email is one person's only) and the phone (FpP), the
// keys that share the person's daily budget, and that budget.
type person struct {
	PersonID   string    `json:"personId"`
	FpE        string    `json:"fpE"`
	MoreFpE    []string  `json:"moreFpE,omitempty"`
	FpP        string    `json:"fpP"`
	Devices    []Device  `json:"devices"`
	DailyLimit int       `json:"dailyLimit"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (p *person) clone() *person {
	c := *p
	c.MoreFpE = append([]string(nil), p.MoreFpE...)
	c.Devices = append([]Device(nil), p.Devices...)
	return &c
}

// device is the index of key among p's devices, or -1.
func (p *person) device(key string) int {
	for i, d := range p.Devices {
		if d.Key == key {
			return i
		}
	}
	return -1
}

func (p *person) hasEmail(fp string) bool {
	if p.FpE == fp {
		return true
	}
	for _, more := range p.MoreFpE {
		if more == fp {
			return true
		}
	}
	return false
}

type peopleFile struct {
	People []*person `json:"people"`
}

// people is the persisted set of persons, with the lookups registration
// needs. It is not locked: Service's mutex guards it.
type people struct {
	path  string
	list  []*person
	byFpE map[string]*person
	byFpP map[string]*person
	byKey map[string]*person
}

func openPeople(dir string) (*people, error) {
	ps := &people{path: filepath.Join(dir, PeopleFile)}
	data, err := os.ReadFile(ps.path)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("reading %s: %w", ps.path, err)
	}
	var file peopleFile
	if err == nil {
		if err := json.Unmarshal(data, &file); err != nil {
			return nil, fmt.Errorf("parsing %s: %w", ps.path, err)
		}
	}
	ps.index(file.People)
	return ps, nil
}

func (ps *people) index(list []*person) {
	ps.list = list
	ps.byFpE, ps.byFpP, ps.byKey = map[string]*person{}, map[string]*person{}, map[string]*person{}
	for _, p := range list {
		ps.byFpE[p.FpE] = p
		for _, more := range p.MoreFpE {
			ps.byFpE[more] = p
		}
		ps.byFpP[p.FpP] = p
		for _, d := range p.Devices {
			ps.byKey[d.Key] = p
		}
	}
}

// put stores p (new, or a changed clone of one already here) and writes the
// file whole, to a temporary file renamed into place. If the write fails the
// set is as it was.
func (ps *people) put(p *person) error {
	next := make([]*person, 0, len(ps.list)+1)
	replaced := false
	for _, old := range ps.list {
		if old.PersonID == p.PersonID {
			next, replaced = append(next, p), true
		} else {
			next = append(next, old)
		}
	}
	if !replaced {
		next = append(next, p)
	}
	data, err := json.MarshalIndent(peopleFile{People: next}, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding %s: %w", ps.path, err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(ps.path), PeopleFile+".tmp*")
	if err != nil {
		return fmt.Errorf("writing %s: %w", ps.path, err)
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("writing %s: %w", ps.path, err)
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("writing %s: %w", ps.path, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("writing %s: %w", ps.path, err)
	}
	if err := os.Rename(tmp.Name(), ps.path); err != nil {
		return fmt.Errorf("writing %s: %w", ps.path, err)
	}
	ps.index(next)
	return nil
}

// randomID is 16 random bytes, hex.
func randomID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generating an id: %w", err)
	}
	return hex.EncodeToString(raw), nil
}
