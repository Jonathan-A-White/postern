// Package index holds the durable record index: an append-only JSONL file
// on disk, replayed into an in-memory map on start so every read is served
// from memory.
package index

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const fileName = "postern-index.jsonl"

// Record is one output the poller found carrying an nftgate record, or one
// record script delivered directly (docs/protocol.md §9). Payload is only
// set for a version-1 record whose payload parsed as JSON — the backend
// never decrypts it, just stores it as opaque JSON. Chain is set only on a
// direct record: sha256(previous direct record's chain || its txid), hex.
type Record struct {
	Seq       uint64          `json:"seq"`
	TxID      string          `json:"txid"`
	Vout      int             `json:"vout"`
	ScriptHex string          `json:"scriptHex"`
	Height    int             `json:"height"`
	FirstSeen time.Time       `json:"firstSeen"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	Signer    string          `json:"signer,omitempty"`
	Chain     string          `json:"chain,omitempty"`
}

// Store is the in-memory index, backed by an append-only JSONL file. Safe
// for concurrent use.
type Store struct {
	mu      sync.Mutex
	file    *os.File
	records []Record
	seenTx  map[string]bool
	firstOf map[string]int // txid -> index in records of its first record
	nextSeq uint64
	chain   [sha256.Size]byte // the last direct record's chain; zero before the first
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
		file:    file,
		seenTx:  make(map[string]bool),
		firstOf: make(map[string]int),
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
		if rec.Chain != "" {
			chain, err := hex.DecodeString(rec.Chain)
			if err != nil || len(chain) != sha256.Size {
				file.Close()
				return nil, fmt.Errorf("replaying %s: record %d has a malformed chain %q", path, rec.Seq, rec.Chain)
			}
			copy(store.chain[:], chain)
		}
		store.remember(rec)
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
	return s.appendLocked(rec)
}

// AppendDirect stores a directly delivered record (docs/protocol.md §9),
// unless a record with its txid is already stored, in which case that
// record is returned unchanged with created=false. A new record gets the
// next sequence number and its Chain: sha256(previous direct record's chain
// || []byte(rec.TxID)), hex, with 32 zero bytes before the first. The check,
// the chain and the append happen under one lock, so concurrent deliveries
// of the same script store it once and never fork the chain.
func (s *Store) AppendDirect(rec Record) (stored Record, created bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if i, ok := s.firstOf[rec.TxID]; ok {
		return s.records[i], false, nil
	}

	chain := sha256.Sum256(append(append([]byte{}, s.chain[:]...), rec.TxID...))
	rec.Chain = hex.EncodeToString(chain[:])
	stored, err = s.appendLocked(rec)
	if err != nil {
		return Record{}, false, err
	}
	s.chain = chain
	return stored, true, nil
}

// appendLocked is Append's body. Callers must hold s.mu.
func (s *Store) appendLocked(rec Record) (Record, error) {
	if s.nextSeq+1 == 0 { // guard against uint64 overflow wraparound
		return Record{}, fmt.Errorf("sequence number overflow")
	}
	rec.Seq = s.nextSeq + 1

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

	s.nextSeq = rec.Seq
	s.remember(rec)
	return rec, nil
}

// remember adds rec to the in-memory index. Callers must hold s.mu (or be
// Open, before the store is shared).
func (s *Store) remember(rec Record) {
	if _, ok := s.firstOf[rec.TxID]; !ok {
		s.firstOf[rec.TxID] = len(s.records)
	}
	s.records = append(s.records, rec)
	s.seenTx[rec.TxID] = true
}

// Head returns the latest sequence number stored (0 if the index is empty).
func (s *Store) Head() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextSeq
}

// Since returns every record with a sequence number greater than since, in
// the order they were appended (oldest first), along with the current head
// sequence number (0 if the index is empty).
func (s *Store) Since(since uint64) ([]Record, uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := []Record{}
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
