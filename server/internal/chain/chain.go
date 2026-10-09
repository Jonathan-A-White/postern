// Package chain is what the rest of the backend knows of a blockchain: the
// handlers, the poller and the licence walk reach it through Chain (or one of
// the smaller interfaces it is composed of) and carry its value types. It
// imports no implementation; internal/woc (WhatsOnChain) is the one there is,
// and cmd/postern wires it in.
package chain

import (
	"errors"
	"fmt"
)

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

// ProviderError is a non-2xx answer from the chain provider, surfaced to
// callers as it came: the handlers answer 502 naming its status and body.
// Provider names who answered, for the message.
type ProviderError struct {
	Provider string
	Status   int
	Body     string
}

func (e *ProviderError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("%s said %d", e.Provider, e.Status)
	}
	return fmt.Sprintf("%s said %d: %s", e.Provider, e.Status, e.Body)
}

// HistoryTooLongError says an address's history runs past the pages a provider
// client reads (Pages): never a short list, because a list missing its oldest
// pages would read as a key that holds no licence.
type HistoryTooLongError struct {
	Address string
	Pages   int
}

func (e *HistoryTooLongError) Error() string {
	return fmt.Sprintf("history of %s runs past %d pages (%d transactions): not read", e.Address, e.Pages, e.Pages*100)
}

// ErrNoSpendLookup is what a SpendReader answers when the reader it wraps
// cannot look spends up: the caller reads history instead.
var ErrNoSpendLookup = errors.New("this chain reader cannot look up who spent an output")

// SpendReader names who spent an output, which is how a licence's token is
// followed without reading its holder's whole history. spent is false for an
// unspent output. A Reader may implement it as well; callers ask by type
// assertion.
type SpendReader interface {
	GetSpender(txid string, vout int) (spender string, spent bool, err error)
}

// Reader reads history: an address's transaction history (oldest first,
// height 0 for unconfirmed) and a transaction's raw hex. The poller and the
// licence walk need only this.
type Reader interface {
	GetHistory(address string) ([]HistoryEntry, error)
	GetTransactionHex(txid string) (string, error)
}

// Broadcaster sends a raw transaction (hex) to the network and returns its
// txid, or a *ProviderError if the provider rejected it.
type Broadcaster interface {
	Broadcast(rawTxHex string) (string, error)
}

// Wallet answers what an address can spend: its unspent outputs and its
// balance.
type Wallet interface {
	GetUtxos(address string) ([]Utxo, error)
	GetBalance(address string) (Balance, error)
}

// Chain is everything the backend asks of a chain.
type Chain interface {
	Reader
	Broadcaster
	Wallet
}
