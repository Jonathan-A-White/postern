// tests/support/fake-chain-provider.ts — a ChainProvider double for licence checks and
// mints: holds transactions by address history and txid, and UTXOs and a broadcast outcome
// by hand, with no network involved. Setting `offline` makes every method reject, standing
// in for WhatsOnChain being unreachable.
import type { AddressHistoryEntry, ChainProvider, Utxo } from 'spell-forge-bsv';

export class FakeChainProvider implements ChainProvider {
  offline = false;
  /** Set to make broadcast() reject with this message instead of succeeding. */
  broadcastError: string | null = null;
  /** The txid broadcast() resolves with when broadcastError is unset. */
  broadcastTxid = 'f'.repeat(64);

  private readonly historyByAddress = new Map<string, AddressHistoryEntry[]>();
  private readonly hexByTxid = new Map<string, string>();
  private readonly utxosByAddress = new Map<string, Utxo[]>();

  addTransaction(address: string, txid: string, hex: string, height = 0): void {
    this.hexByTxid.set(txid, hex);
    const history = this.historyByAddress.get(address) ?? [];
    history.push({ txid, height });
    this.historyByAddress.set(address, history);
  }

  setUtxos(address: string, utxos: Utxo[]): void {
    this.utxosByAddress.set(address, utxos);
  }

  private assertOnline(): void {
    if (this.offline) throw new Error('the chain is unreachable');
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    this.assertOnline();
    return this.utxosByAddress.get(address) ?? [];
  }

  async getAddressHistory(address: string): Promise<AddressHistoryEntry[]> {
    this.assertOnline();
    return this.historyByAddress.get(address) ?? [];
  }

  async getTransactionHex(txid: string): Promise<string> {
    this.assertOnline();
    const hex = this.hexByTxid.get(txid);
    if (!hex) throw new Error(`FakeChainProvider has no transaction for ${txid}`);
    return hex;
  }

  async broadcast(): Promise<string> {
    this.assertOnline();
    if (this.broadcastError) throw new Error(this.broadcastError);
    return this.broadcastTxid;
  }
}
