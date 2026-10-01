// Package prompts is the backend's store of saved prompts: a name, the
// options it takes (its signature) and its body, kept as one JSON file in
// POSTERN_DATA so every app and the Mayor read the same list (server/README.md).
package prompts

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const fileName = "prompts.json"

// The four types an option may have.
const (
	TypeDuration = "duration"
	TypeString   = "string"
	TypeInt      = "int"
	TypeBool     = "bool"
)

var (
	namePattern = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)
	flagPattern = regexp.MustCompile(`^--\S+$`)
)

// Option is one flag a prompt takes: "--duration", its type, the default
// (a string that parses as Type; "" means none), whether it must be given,
// and a line of help.
type Option struct {
	Flag     string `json:"flag"`
	Type     string `json:"type"`
	Default  string `json:"default,omitempty"`
	Required bool   `json:"required,omitempty"`
	Help     string `json:"help,omitempty"`
}

// Prompt is one saved prompt. UpdatedBy is the key that last wrote it.
type Prompt struct {
	Name      string    `json:"name"`
	Summary   string    `json:"summary"`
	Signature []Option  `json:"signature"`
	Body      string    `json:"body"`
	UpdatedAt time.Time `json:"updatedAt"`
	UpdatedBy string    `json:"updatedBy"`
}

// ValidName reports whether name is a prompt name: lowercase letters, digits
// and '-', 1 to 32 of them.
func ValidName(name string) bool { return namePattern.MatchString(name) }

// Validate says, in one line, what is wrong with p: its name, a flag that does
// not begin "--" or is given twice, a type that is not one of the four, or a
// default that does not parse as its type.
func (p Prompt) Validate() error {
	if !ValidName(p.Name) {
		return errors.New("name must be 1 to 32 characters of a-z, 0-9 and -")
	}
	seen := map[string]bool{}
	for _, opt := range p.Signature {
		if !flagPattern.MatchString(opt.Flag) {
			return fmt.Errorf("option flag %q must begin with -- and have no spaces", opt.Flag)
		}
		if seen[opt.Flag] {
			return fmt.Errorf("option flag %s is given twice", opt.Flag)
		}
		seen[opt.Flag] = true
		if err := opt.checkDefault(); err != nil {
			return err
		}
	}
	return nil
}

func (o Option) checkDefault() error {
	var err error
	switch o.Type {
	case TypeString:
	case TypeDuration:
		if o.Default != "" {
			_, err = time.ParseDuration(o.Default)
		}
	case TypeInt:
		if o.Default != "" {
			_, err = strconv.Atoi(o.Default)
		}
	case TypeBool:
		if o.Default != "" {
			_, err = strconv.ParseBool(o.Default)
		}
	default:
		return fmt.Errorf("option %s has type %q, want duration, string, int or bool", o.Flag, o.Type)
	}
	if err != nil {
		return fmt.Errorf("option %s default %q is not a %s", o.Flag, o.Default, o.Type)
	}
	return nil
}

// Store is the durable set of prompts, persisted whole as dir/prompts.json
// (written to a temp file and renamed into place). Safe for concurrent use.
type Store struct {
	mu     sync.Mutex
	path   string
	byName map[string]Prompt
}

// OpenStore loads dir/prompts.json (starting empty if it does not exist yet).
func OpenStore(dir string) (*Store, error) {
	path := filepath.Join(dir, fileName)
	store := &Store{path: path, byName: map[string]Prompt{}}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var list []Prompt
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	for _, p := range list {
		store.byName[p.Name] = p
	}
	return store, nil
}

// List returns every prompt sorted by name; never nil.
func (s *Store) List() []Prompt {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sorted()
}

// Get returns the prompt called name.
func (s *Store) Get(name string) (Prompt, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byName[name]
	return p, ok
}

// Put stores p, replacing any prompt of the same name. The caller has
// validated and stamped it.
func (s *Store) Put(p Prompt) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, had := s.byName[p.Name]
	s.byName[p.Name] = p
	if err := s.save(); err != nil {
		if had {
			s.byName[p.Name] = previous
		} else {
			delete(s.byName, p.Name)
		}
		return err
	}
	return nil
}

// Delete removes the prompt called name, reporting whether there was one.
func (s *Store) Delete(name string) (existed bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, had := s.byName[name]
	if !had {
		return false, nil
	}
	delete(s.byName, name)
	if err := s.save(); err != nil {
		s.byName[name] = previous
		return false, err
	}
	return true, nil
}

// sorted is the prompts by name. Callers must hold s.mu.
func (s *Store) sorted() []Prompt {
	out := make([]Prompt, 0, len(s.byName))
	for _, p := range s.byName {
		if p.Signature == nil {
			p.Signature = []Option{}
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return strings.Compare(out[i].Name, out[j].Name) < 0 })
	return out
}

// save writes every prompt to a temp file beside the real one and renames it
// into place, so a reader never sees a partial file. Callers must hold s.mu.
func (s *Store) save() error {
	data, err := json.Marshal(s.sorted())
	if err != nil {
		return fmt.Errorf("marshaling prompts: %w", err)
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating data directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, "prompts-*.tmp")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("setting permissions: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("renaming into place: %w", err)
	}
	return nil
}
