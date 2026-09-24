// Package woc is a client for the WhatsOnChain REST API: the one place in
// this backend that talks to it, so the poller and the /api proxy endpoints
// share its rate limiting and retry behaviour.
package woc

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// DefaultTestnetBase is WhatsOnChain's testnet API base URL.
const DefaultTestnetBase = "https://api.whatsonchain.com/v1/bsv/test"

// WhatsOnChain rate-limits at 3 requests/s per IP without a key.
const defaultMinSpacing = 350 * time.Millisecond

const (
	defaultMaxAttempts       = 5
	defaultInitialRetryDelay = 500 * time.Millisecond
)

// APIError is a non-2xx response from WhatsOnChain, surfaced to callers
// instead of being retried further (except 429, which Client retries
// itself before giving up).
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("WhatsOnChain said %d", e.Status)
	}
	return fmt.Sprintf("WhatsOnChain said %d: %s", e.Status, e.Body)
}

// HistoryEntry is one entry of an address's transaction history. Height is
// 0 for an unconfirmed (mempool) transaction.
type HistoryEntry struct {
	TxHash string
	Height int
}

// Utxo is one unspent output of an address.
type Utxo struct {
	TxHash string
	TxPos  int
	Value  int64
	Height int
}

// Balance is an address's confirmed and unconfirmed balance, in satoshis.
type Balance struct {
	Confirmed   int64 `json:"confirmed"`
	Unconfirmed int64 `json:"unconfirmed"`
}

// Client talks to WhatsOnChain, pacing requests under its rate limit and
// retrying a 429 with exponential backoff. Its HTTP client, sleep function,
// and timing are all overridable so tests never touch the network or a real
// clock.
type Client struct {
	baseURL     string
	httpClient  *http.Client
	minSpacing  time.Duration
	maxAttempts int
	retryDelay  time.Duration
	sleep       func(time.Duration)

	mu          sync.Mutex
	lastRequest time.Time
	hasSent     bool
}

// Option configures a Client constructed by NewClient.
type Option func(*Client)

// WithHTTPClient overrides the underlying *http.Client.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) { c.httpClient = hc }
}

// WithMinSpacing overrides the minimum spacing enforced between requests.
func WithMinSpacing(d time.Duration) Option {
	return func(c *Client) { c.minSpacing = d }
}

// WithMaxAttempts overrides how many times a request is attempted before a
// 429 or network error is given up on.
func WithMaxAttempts(n int) Option {
	return func(c *Client) { c.maxAttempts = n }
}

// WithRetryDelay overrides the initial retry delay (doubled each attempt).
func WithRetryDelay(d time.Duration) Option {
	return func(c *Client) { c.retryDelay = d }
}

// WithSleep overrides the function called to wait out spacing and backoff
// delays, so tests can capture or skip them instead of actually sleeping.
func WithSleep(fn func(time.Duration)) Option {
	return func(c *Client) { c.sleep = fn }
}

// NewClient builds a Client against baseURL (e.g. DefaultTestnetBase).
func NewClient(baseURL string, opts ...Option) *Client {
	c := &Client{
		baseURL:     strings.TrimRight(baseURL, "/"),
		httpClient:  http.DefaultClient,
		minSpacing:  defaultMinSpacing,
		maxAttempts: defaultMaxAttempts,
		retryDelay:  defaultInitialRetryDelay,
		sleep:       time.Sleep,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// GetHistory returns address's confirmed and unconfirmed transaction
// history, oldest first (as WhatsOnChain returns it).
func (c *Client) GetHistory(address string) ([]HistoryEntry, error) {
	body, err := c.get(fmt.Sprintf("/address/%s/history", address))
	if err != nil {
		return nil, err
	}

	var raw []struct {
		TxHash string `json:"tx_hash"`
		Height int    `json:"height"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parsing history response: %w", err)
	}

	history := make([]HistoryEntry, len(raw))
	for i, r := range raw {
		history[i] = HistoryEntry{TxHash: r.TxHash, Height: r.Height}
	}
	return history, nil
}

// GetTransactionHex returns a transaction's raw hex.
func (c *Client) GetTransactionHex(txid string) (string, error) {
	body, err := c.get(fmt.Sprintf("/tx/%s/hex", txid))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(body)), nil
}

// Broadcast forwards a raw transaction (as hex) to WhatsOnChain and returns
// its txid, or an *APIError if the provider rejected it.
func (c *Client) Broadcast(rawTxHex string) (string, error) {
	reqBody, err := json.Marshal(struct {
		TxHex string `json:"txhex"`
	}{TxHex: rawTxHex})
	if err != nil {
		return "", fmt.Errorf("marshaling broadcast request: %w", err)
	}

	body, err := c.do(http.MethodPost, "/tx/raw", reqBody)
	if err != nil {
		return "", err
	}
	return strings.Trim(strings.TrimSpace(string(body)), `"`), nil
}

// GetUtxos returns address's unspent outputs.
func (c *Client) GetUtxos(address string) ([]Utxo, error) {
	body, err := c.get(fmt.Sprintf("/address/%s/unspent", address))
	if err != nil {
		return nil, err
	}

	var raw []struct {
		TxHash string `json:"tx_hash"`
		TxPos  int    `json:"tx_pos"`
		Value  int64  `json:"value"`
		Height int    `json:"height"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parsing unspent response: %w", err)
	}

	utxos := make([]Utxo, len(raw))
	for i, r := range raw {
		utxos[i] = Utxo{TxHash: r.TxHash, TxPos: r.TxPos, Value: r.Value, Height: r.Height}
	}
	return utxos, nil
}

// GetBalance returns address's confirmed and unconfirmed balance.
func (c *Client) GetBalance(address string) (Balance, error) {
	body, err := c.get(fmt.Sprintf("/address/%s/balance", address))
	if err != nil {
		return Balance{}, err
	}

	var balance Balance
	if err := json.Unmarshal(body, &balance); err != nil {
		return Balance{}, fmt.Errorf("parsing balance response: %w", err)
	}
	return balance, nil
}

func (c *Client) get(path string) ([]byte, error) {
	return c.do(http.MethodGet, path, nil)
}

// do performs one logical request, retrying a 429 or network error up to
// maxAttempts times with exponential backoff, and pacing every attempt at
// least minSpacing apart from the previous request this client made.
func (c *Client) do(method, path string, body []byte) ([]byte, error) {
	url := c.baseURL + path
	delay := c.retryDelay

	var lastErr error
	for attempt := 1; attempt <= c.maxAttempts; attempt++ {
		c.waitForSlot()

		var reqBody io.Reader
		if body != nil {
			reqBody = strings.NewReader(string(body))
		}
		req, err := http.NewRequest(method, url, reqBody)
		if err != nil {
			return nil, fmt.Errorf("building request: %w", err)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("requesting %s: %w", url, err)
			if attempt == c.maxAttempts {
				return nil, lastErr
			}
			c.sleep(delay)
			delay *= 2
			continue
		}

		respBody, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("reading response from %s: %w", url, readErr)
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			lastErr = &APIError{Status: resp.StatusCode, Body: strings.TrimSpace(string(respBody))}
			if attempt == c.maxAttempts {
				return nil, lastErr
			}
			c.sleep(delay)
			delay *= 2
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, &APIError{Status: resp.StatusCode, Body: strings.TrimSpace(string(respBody))}
		}

		return respBody, nil
	}

	return nil, lastErr
}

// waitForSlot blocks until at least minSpacing has passed since this
// client's previous request.
func (c *Client) waitForSlot() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.hasSent {
		wait := c.minSpacing - time.Since(c.lastRequest)
		if wait > 0 {
			c.sleep(wait)
		}
	}
	c.hasSent = true
	c.lastRequest = time.Now()
}
