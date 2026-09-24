// Package index holds the durable record index: an append-only JSONL file
// on disk, replayed into an in-memory map on start so every read is served
// from memory.
package index

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const fileName = "postern-index.jsonl"

// Record is one output the poller found carrying an nftgate record. Payload
// is only set for a version-1 record whose payload parsed as JSON — the
// backend never decrypts it, just stores it as opaque JSON.
type Record struct {
	Seq       uint64          `json:"seq"`
	TxID      string          `json:"txid"`
	Vout      int             `json:"vout"`
	ScriptHex string          `json:"scriptHex"`
	Height    int             `json:"height"`
	FirstSeen time.Time       `json:"firstSeen"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// Store is the in-memory index, backed by an append-only JSONL file. Safe
// for concurrent use.
type Store struct {
	mu      sync.Mutex
	file    *os.File
	records []Record
	seenTx  map[string]bool
	nextSeq uint64
}

// Open loads dir/postern-index.jsonl into memory (creating dir and the file
// if neither exists yet) and returns a Store ready for Append and Since.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating data directory %s: %w", dir, err)
	}

	path := filepath.Join(dir, fileName)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o644)
	if err != nil {
		return nil, fmt.Errorf("opening index file %s: %w", path, err)
	}

	store := &Store{
		file:   file,
		seenTx: make(map[string]bool),
	}

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var rec Record
		if err := json.Unmarshal(line, &rec); err != nil {
			file.Close()
			return nil, fmt.Errorf("replaying %s: %w", path, err)
		}
		store.records = append(store.records, rec)
		store.seenTx[rec.TxID] = true
		if rec.Seq > store.nextSeq {
			store.nextSeq = rec.Seq
		}
	}
	if err := scanner.Err(); err != nil {
		file.Close()
		return nil, fmt.Errorf("replaying %s: %w", path, err)
	}

	return store, nil
}

// Close closes the underlying file. The in-memory index remains readable
// but Append will fail afterwards.
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.file.Close()
}

// Append assigns the next sequence number to rec, persists it, marks its
// txid seen, and returns the stored copy (with Seq set).
func (s *Store) Append(rec Record) (Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextSeq++
	rec.Seq = s.nextSeq
	if s.nextSeq == 0 { // guard against uint64 overflow wraparound
		return Record{}, fmt.Errorf("sequence number overflow")
	}

	line, err := json.Marshal(rec)
	if err != nil {
		return Record{}, fmt.Errorf("marshaling record: %w", err)
	}
	line = append(line, '\n')
	if _, err := s.file.Write(line); err != nil {
		return Record{}, fmt.Errorf("writing record: %w", err)
	}
	if err := s.file.Sync(); err != nil {
		return Record{}, fmt.Errorf("syncing index file: %w", err)
	}

	s.records = append(s.records, rec)
	s.seenTx[rec.TxID] = true
	return rec, nil
}

// Since returns every record with a sequence number greater than since, in
// the order they were appended (oldest first), along with the current head
// sequence number (0 if the index is empty).
func (s *Store) Since(since uint64) ([]Record, uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var out []Record
	for _, rec := range s.records {
		if rec.Seq > since {
			out = append(out, rec)
		}
	}

	head := s.nextSeq
	if head < since {
		head = since
	}
	return out, head
}

// SeenTx reports whether txid has already been processed (whether or not it
// carried any record-bearing outputs).
func (s *Store) SeenTx(txid string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.seenTx[txid]
}

// MarkSeen marks txid processed without storing a record for it — used for
// a transaction whose outputs carried no record, so the poller doesn't
// re-fetch it every pass. Not persisted: a restart simply re-checks it once,
// which is harmless since it still finds nothing to store.
func (s *Store) MarkSeen(txid string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seenTx[txid] = true
}
