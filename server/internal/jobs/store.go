// Package jobs serves the factory's by-hand jobs: one JSON file per job under
// POSTERN_DATA/jobs/<job-id>.json, kept current by whoever owns the job (the
// factory, an hourly sweep). Postern only reads them; a missing or bad file is
// skipped with a log line, never an error to the app (docs/jobs.md).
package jobs

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	dirName = "jobs"
	// maxFileBytes caps one feed file; a job of a few hundred items is some tens of KiB.
	maxFileBytes = 4 << 20
)

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// Item is one thing the job is done over: a sermon, say. Done says, per check
// named in the job's Checks, whether that check passes; a check it leaves out has not passed.
type Item struct {
	Label string          `json:"label"`
	Date  string          `json:"date,omitempty"`
	Link  string          `json:"link,omitempty"`
	Done  map[string]bool `json:"done"`
}

// Job is one feed file. Items are in the order the owner wants them shown
// (newest first). Here is the index of the 'you are here' item, if any.
type Job struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Updated string   `json:"updated"`
	Checks  []string `json:"checks"`
	Items   []Item   `json:"items"`
	Here    *int     `json:"here,omitempty"`
	Note    string   `json:"note,omitempty"`
}

// Summary is a job in GET /api/jobs: how many of its items have every check.
type Summary struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Updated string `json:"updated"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
}

// ItemDone reports whether every check of the job passes for the item. A job that names no checks is never done.
func (j Job) ItemDone(it Item) bool {
	if len(j.Checks) == 0 {
		return false
	}
	for _, c := range j.Checks {
		if !it.Done[c] {
			return false
		}
	}
	return true
}

// Summary is the job as the list shows it.
func (j Job) Summary() Summary {
	done := 0
	for _, it := range j.Items {
		if j.ItemDone(it) {
			done++
		}
	}
	return Summary{ID: j.ID, Title: j.Title, Updated: j.Updated, Done: done, Total: len(j.Items)}
}

// Validate says, in one line, what is wrong with j as the file called id.
func (j Job) Validate(id string) error {
	if j.ID != id {
		return errors.New("id " + quote(j.ID) + " is not the file name " + quote(id))
	}
	if strings.TrimSpace(j.Title) == "" {
		return errors.New("no title")
	}
	if _, err := time.Parse(time.RFC3339, j.Updated); err != nil {
		return errors.New("updated is not an RFC 3339 time")
	}
	known := map[string]bool{}
	for _, c := range j.Checks {
		if strings.TrimSpace(c) == "" {
			return errors.New("a check has no name")
		}
		if known[c] {
			return errors.New("check " + quote(c) + " is named twice")
		}
		known[c] = true
	}
	for _, it := range j.Items {
		if strings.TrimSpace(it.Label) == "" {
			return errors.New("an item has no label")
		}
		for c := range it.Done {
			if !known[c] {
				return errors.New("item " + quote(it.Label) + " has a check " + quote(c) + " the job does not name")
			}
		}
		if it.Link != "" {
			u, err := url.Parse(it.Link)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
				return errors.New("item " + quote(it.Label) + " has a link that is not http or https")
			}
		}
	}
	if j.Here != nil && (*j.Here < 0 || *j.Here >= len(j.Items)) {
		return errors.New("here is not the index of an item")
	}
	return nil
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// Store reads the feed files under one data directory.
type Store struct{ dir string }

// Open is the store over dataDir/jobs. The directory is the factory's to make;
// without it there are no jobs.
func Open(dataDir string) *Store { return &Store{dir: filepath.Join(dataDir, dirName)} }

func (s *Store) read(id string) (Job, error) {
	path := filepath.Join(s.dir, id+".json")
	info, err := os.Stat(path)
	if err != nil {
		return Job{}, err
	}
	if info.Size() > maxFileBytes {
		return Job{}, errors.New("file is too large")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Job{}, err
	}
	var j Job
	if err := json.Unmarshal(data, &j); err != nil {
		return Job{}, err
	}
	if err := j.Validate(id); err != nil {
		return Job{}, err
	}
	if j.Items == nil {
		j.Items = []Item{}
	}
	if j.Checks == nil {
		j.Checks = []string{}
	}
	for i := range j.Items {
		if j.Items[i].Done == nil {
			j.Items[i].Done = map[string]bool{}
		}
	}
	return j, nil
}

// Get answers the job called id, or false if there is none or its file is bad (logged).
func (s *Store) Get(id string) (Job, bool) {
	if !idPattern.MatchString(id) {
		return Job{}, false
	}
	j, err := s.read(id)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("jobs: skipping %s.json: %v", id, err)
		}
		return Job{}, false
	}
	return j, true
}

// List is every good job, newest updated first (ties by id). Bad files are logged and left out.
func (s *Store) List() []Summary {
	out := []Summary{}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("jobs: reading %s: %v", s.dir, err)
		}
		return out
	}
	for _, e := range entries {
		name := e.Name()
		id, ok := strings.CutSuffix(name, ".json")
		if e.IsDir() || !ok || !idPattern.MatchString(id) {
			continue
		}
		j, err := s.read(id)
		if err != nil {
			log.Printf("jobs: skipping %s: %v", name, err)
			continue
		}
		out = append(out, j.Summary())
	}
	sort.SliceStable(out, func(a, b int) bool {
		ta, _ := time.Parse(time.RFC3339, out[a].Updated)
		tb, _ := time.Parse(time.RFC3339, out[b].Updated)
		if !ta.Equal(tb) {
			return ta.After(tb)
		}
		return out[a].ID < out[b].ID
	})
	return out
}
