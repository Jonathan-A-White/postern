package licence

import (
	"encoding/hex"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// TxCache is a Reader that keeps every transaction hex it fetches on disk,
// one file per txid in dir. A transaction never changes once the chain has
// it, so a walk after a restart reads from disk whatever an earlier walk
// fetched and goes to the chain only for history it has not seen. Only
// GetTransactionHex is cached: an address's history grows, so it is always
// asked of the chain. A file that cannot be written or read back is logged
// and skipped, never an error: the chain is the source of truth.
type TxCache struct {
	Reader
	dir string
}

// NewTxCache wraps reader so transactions are kept under dir (created when
// the first one is stored).
func NewTxCache(reader Reader, dir string) *TxCache {
	return &TxCache{Reader: reader, dir: dir}
}

// GetTransactionHex returns txid's raw hex from disk, else from the wrapped
// reader (and then onto disk).
func (c *TxCache) GetTransactionHex(txid string) (string, error) {
	path, ok := c.path(txid)
	if ok {
		if raw, err := os.ReadFile(path); err == nil {
			if txHex := strings.TrimSpace(string(raw)); isHex(txHex) {
				return txHex, nil
			}
		}
	}
	txHex, err := c.Reader.GetTransactionHex(txid)
	if err != nil || !ok || !isHex(txHex) {
		return txHex, err
	}
	if err := c.store(path, txHex); err != nil {
		log.Printf("keeping transaction %s on disk failed, it will be fetched again: %v", txid, err)
	}
	return txHex, nil
}

// path is the file for txid, and false for anything but a 64-digit hex txid:
// only a real txid names a file.
func (c *TxCache) path(txid string) (string, bool) {
	if len(txid) != 64 || !isHex(txid) {
		return "", false
	}
	return filepath.Join(c.dir, strings.ToLower(txid)+".hex"), true
}

// store writes txHex to path whole or not at all.
func (c *TxCache) store(path, txHex string) error {
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(c.dir, ".tx-*")
	if err != nil {
		return err
	}
	_, werr := tmp.WriteString(txHex)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		os.Remove(tmp.Name())
		if werr != nil {
			return werr
		}
		return cerr
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return nil
}

// isHex reports whether s is a non-empty, even-length string of hex digits.
func isHex(s string) bool {
	if s == "" {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}
