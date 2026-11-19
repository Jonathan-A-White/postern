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
	// Billing is the Governor's mark on who pays for this person's grists:
	// BillingAPI, or empty for BillingMax (a record written before the field
	// reads as max, and a person billed max carries no mark).
	Billing string `json:"billing,omitempty"`
}

// The two billing marks (GET /api/register/person's billing). The mill bills
// a "max" person's grists to the Governor's Max subscription and an "api"
// person's to the API credit only.
const (
	BillingMax = "max"
	BillingAPI = "api"
)

// billing is the person's mark as the API shows it: always max or api.
func (p *person) billing() string {
	if p.Billing == BillingAPI {
		return BillingAPI
	}
	return BillingMax
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
	// KeyBilling is the "api" mark of a key no person holds yet (the
	// Governor marked a licence holder who has not registered): key -> mark.
	// A person made from the key starts with it, and it is dropped then.
	KeyBilling map[string]string `json:"keyBilling,omitempty"`
}

// people is the persisted set of persons, with the lookups registration
// needs. It is not locked: Service's mutex guards it.
type people struct {
	path  string
	list  []*person
	byFpE map[string]*person
	byFpP map[string]*person
	byKey map[string]*person
	// keyBilling is peopleFile.KeyBilling: marks on keys no person holds.
	keyBilling map[string]string
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
	ps.keyBilling = file.KeyBilling
	if ps.keyBilling == nil {
		ps.keyBilling = map[string]string{}
	}
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
	return ps.write(p, ps.keyBilling)
}

// putKeyBilling sets (or, for max, drops) the mark on a key no person holds,
// and writes the file.
func (ps *people) putKeyBilling(key, billing string) error {
	marks := make(map[string]string, len(ps.keyBilling)+1)
	for k, v := range ps.keyBilling {
		marks[k] = v
	}
	if billing == BillingAPI {
		marks[key] = BillingAPI
	} else {
		delete(marks, key)
	}
	return ps.write(nil, marks)
}

// write stores p (nil for none) and marks, and writes the file whole. A
// person holding a key takes over the key's own mark: it is dropped here.
func (ps *people) write(p *person, marks map[string]string) error {
	next := make([]*person, 0, len(ps.list)+1)
	replaced := false
	if p != nil {
		kept := make(map[string]string, len(marks))
		for k, v := range marks {
			kept[k] = v
		}
		for _, d := range p.Devices {
			delete(kept, d.Key)
		}
		marks = kept
	}
	for _, old := range ps.list {
		if p != nil && old.PersonID == p.PersonID {
			next, replaced = append(next, p), true
		} else {
			next = append(next, old)
		}
	}
	if !replaced && p != nil {
		next = append(next, p)
	}
	data, err := json.MarshalIndent(peopleFile{People: next, KeyBilling: marks}, "", "  ")
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
	ps.keyBilling = marks
	if ps.keyBilling == nil {
		ps.keyBilling = map[string]string{}
	}
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
