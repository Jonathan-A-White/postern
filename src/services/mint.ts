// src/services/mint.ts — mints a License to the key's own testnet address, funded by its
// own balance, through the package's contract-locked mint builder (buildContractMintTransaction)
// used directly rather than mintContractLicenseToken: a one-shot self-mint needs neither the
// package's pending-spend bookkeeping (built for races between rapid repeat spends and
// WhatsOnChain's indexing lag) nor an event bus — Postern has neither yet (mw-1589l.3).
import { PrivateKey, Utils } from '@bsv/sdk';
import {
  buildContractMintTransaction,
  chainConfig,
  createChainProvider,
  type ChainConfig,
  type ChainProvider,
} from 'spell-forge-bsv';
import { addressForPublicKey, checkLicence } from './licence';

const TESTNET_WIF_PREFIX = [0xef];
const LICENSE_TOKEN_SATOSHIS = 1;

export interface MintResult {
  txid: string;
}

/** The License output (1 sat) plus its Fuel: the balance a mint needs to succeed. */
export function mintCostSatoshis(config: ChainConfig = chainConfig): number {
  return (config.mintFuelSatoshis ?? 0) + LICENSE_TOKEN_SATOSHIS;
}

/** The key's own testnet balance: the sum of its UTXOs, from the same provider a mint would spend from. */
export async function fetchBalanceSatoshis(
  publicKeyHex: string,
  provider: ChainProvider = createChainProvider(),
): Promise<number> {
  const utxos = await provider.getUtxos(addressForPublicKey(publicKeyHex));
  return utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);
}

/**
 * Mints a License to the key's own address, funded by the key's own testnet UTXOs, and
 * refreshes the licence cache once the mint is broadcast (so the gate opens on its next
 * check). Nothing is cached when the build or the broadcast fails — the caller shows
 * whatever error surfaces.
 */
export async function mintMyLicence(key: Uint8Array, provider: ChainProvider = createChainProvider()): Promise<MintResult> {
  const privateKey = PrivateKey.fromHex(Utils.toHex(Array.from(key)));
  const publicKeyHex = privateKey.toPublicKey().toString();
  const address = addressForPublicKey(publicKeyHex);

  const utxos = await provider.getUtxos(address);
  const built = await buildContractMintTransaction({
    issuerKey: privateKey.toWif(TESTNET_WIF_PREFIX),
    utxos,
    holderPubKey: publicKeyHex,
    mintFuelSatoshis: chainConfig.mintFuelSatoshis,
    config: chainConfig,
    provider,
  });

  const txid = await provider.broadcast(built.hex);
  await checkLicence(publicKeyHex, provider);
  return { txid };
}
