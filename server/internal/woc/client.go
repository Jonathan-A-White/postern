// Package woc is a client for the WhatsOnChain REST API: the one place in
// this backend that talks to it, so the poller and the /api proxy endpoints
// share its rate limiting and retry behaviour.
package woc

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Jonathan-A-White/postern/server/internal/chain"
)

// DefaultTestnetBase is WhatsOnChain's testnet API base URL.
const DefaultTestnetBase = "https://api.whatsonchain.com/v1/bsv/test"

// WhatsOnChain rate-limits at 3 requests/s per IP without a key.
const defaultMinSpacing = 350 * time.Millisecond

// defaultRequestTimeout bounds one HTTP request to WhatsOnChain, so a provider
// that accepts the connection and never answers fails the request instead of
// hanging whoever waits on it (a licence walk holds a phone's request open).
const defaultRequestTimeout = 10 * time.Second

const (
	defaultMaxAttempts       = 5
	defaultInitialRetryDelay = 500 * time.Millisecond
)

// APIError is a non-2xx response from WhatsOnChain, surfaced to callers
// instead of being retried further (except 429, which Client retries
// itself before giving up). It is chain.ProviderError, which the handlers
// map to 502.
type APIError = chain.ProviderError

// HistoryEntry, Utxo and Balance are the chain package's types, which Client
// returns.
type (
	HistoryEntry = chain.HistoryEntry
	Utxo         = chain.Utxo
	Balance      = chain.Balance
)

// Client implements chain.Chain.
var _ chain.Chain = (*Client)(nil)

// providerName is how a *chain.ProviderError from Client names its source.
const providerName = "WhatsOnChain"

// Client talks to WhatsOnChain, pacing requests under its rate limit and
// retrying a 429 with exponential backoff and bounding each request with a
// timeout. Its HTTP client, sleep function, and timing are all overridable so
// tests never touch the network or a real clock.
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

// WithTimeout overrides the per-request timeout of the default HTTP client
// (defaultRequestTimeout). It replaces any client set by WithHTTPClient
// before it.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.httpClient = &http.Client{Timeout: d} }
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
		httpClient:  &http.Client{Timeout: defaultRequestTimeout},
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

// maxHistoryPages caps how many pages of confirmed history GetHistory reads
// for one address (WhatsOnChain serves 100 transactions a page).
const maxHistoryPages = 50

// historyPage is one reply of WhatsOnChain's /confirmed/history or
// /unconfirmed/history.
type historyPage struct {
	Result []struct {
		TxHash string `json:"tx_hash"`
		Height int    `json:"height"`
	} `json:"result"`
	NextPageToken string `json:"nextPageToken"`
	Error         string `json:"error"`
}

// GetHistory returns address's whole transaction history, each transaction
// once: every confirmed one oldest first, then the unconfirmed ones (height
// 0). WhatsOnChain's /history holds only the newest 100, so it reads every
// page of /confirmed/history (the newest page first, older ones by
// nextPageToken) and /unconfirmed/history. Past maxHistoryPages it returns
// an error, never a short list: a list missing its oldest pages would read
// as a key that holds no licence.
//
// WhatsOnChain answers a plain-text 404 on /confirmed/history for an address
// it has never seen (while /unconfirmed/history answers an empty 200), so a
// 404 on the first confirmed page means no confirmed history. Any other
// failure, including a 404 on a later page, stays an error.
func (c *Client) GetHistory(address string) ([]HistoryEntry, error) {
	// Unconfirmed first: a transaction confirming between the reads then
	// shows in both (and is kept as confirmed), rather than in neither.
	unconfirmed, err := c.getHistoryPage(fmt.Sprintf("/address/%s/unconfirmed/history", address))
	if err != nil {
		return nil, err
	}

	var pages []historyPage
	token := ""
	for {
		if len(pages) == maxHistoryPages {
			return nil, fmt.Errorf("history of %s runs past %d pages (%d transactions): not read", address, maxHistoryPages, maxHistoryPages*100)
		}
		path := fmt.Sprintf("/address/%s/confirmed/history", address)
		if token != "" {
			path += "?token=" + url.QueryEscape(token)
		}
		page, err := c.getHistoryPage(path)
		if err != nil {
			var apiErr *chain.ProviderError
			if len(pages) > 0 || !errors.As(err, &apiErr) || apiErr.Status != http.StatusNotFound {
				return nil, err
			}
			page = historyPage{} // never seen: no confirmed history
		}
		pages = append(pages, page)
		if page.NextPageToken == "" {
			break
		}
		token = page.NextPageToken
	}

	var confirmed []HistoryEntry
	for i := len(pages) - 1; i >= 0; i-- {
		for _, r := range pages[i].Result {
			confirmed = append(confirmed, HistoryEntry{TxHash: r.TxHash, Height: r.Height})
		}
	}
	sort.SliceStable(confirmed, func(i, j int) bool { return confirmed[i].Height < confirmed[j].Height })

	seen := make(map[string]bool)
	var history []HistoryEntry
	for _, entry := range confirmed {
		if !seen[entry.TxHash] {
			seen[entry.TxHash] = true
			history = append(history, entry)
		}
	}
	for _, r := range unconfirmed.Result {
		if !seen[r.TxHash] {
			seen[r.TxHash] = true
			history = append(history, HistoryEntry{TxHash: r.TxHash})
		}
	}
	return history, nil
}

func (c *Client) getHistoryPage(path string) (historyPage, error) {
	body, err := c.get(path)
	if err != nil {
		return historyPage{}, err
	}
	var page historyPage
	if err := json.Unmarshal(body, &page); err != nil {
		return historyPage{}, fmt.Errorf("parsing history response: %w", err)
	}
	if page.Error != "" {
		return historyPage{}, fmt.Errorf("WhatsOnChain history error for %s: %s", path, page.Error)
	}
	return page, nil
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
// its txid, or a *chain.ProviderError if the provider rejected it.
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
			// A timed-out request is not retried: the provider is not
			// answering, and another try would only add its timeout to the
			// wait of whoever is blocked on this call.
			var netErr net.Error
			if attempt == c.maxAttempts || (errors.As(err, &netErr) && netErr.Timeout()) {
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
			lastErr = &chain.ProviderError{Provider: providerName, Status: resp.StatusCode, Body: strings.TrimSpace(string(respBody))}
			if attempt == c.maxAttempts {
				return nil, lastErr
			}
			c.sleep(delay)
			delay *= 2
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, &chain.ProviderError{Provider: providerName, Status: resp.StatusCode, Body: strings.TrimSpace(string(respBody))}
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
