// tests/support/fake-chain-provider.ts — a ChainProvider double for licence checks:
// holds transactions by address history and txid, with no network involved. Setting
// `offline` makes every method reject, standing in for WhatsOnChain being unreachable.
import type { AddressHistoryEntry, ChainProvider, Utxo } from 'spell-forge-bsv';

export class FakeChainProvider implements ChainProvider {
  offline = false;

  private readonly historyByAddress = new Map<string, AddressHistoryEntry[]>();
  private readonly hexByTxid = new Map<string, string>();

  addTransaction(address: string, txid: string, hex: string, height = 0): void {
    this.hexByTxid.set(txid, hex);
    const history = this.historyByAddress.get(address) ?? [];
    history.push({ txid, height });
    this.historyByAddress.set(address, history);
  }

  private assertOnline(): void {
    if (this.offline) throw new Error('the chain is unreachable');
  }

  async getUtxos(): Promise<Utxo[]> {
    this.assertOnline();
    return [];
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
    throw new Error('FakeChainProvider.broadcast is not implemented');
  }
}
