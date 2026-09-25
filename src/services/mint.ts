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

// buildContractMintTransaction (spell-forge-bsv's license-contract.js) builds [0] the 1-sat
// License, [1] the Fuel, [2] a 0-sat Data output and [3] a P2PKH change output flagged
// change:true, then calls transaction.fee(new SatoshisPerKilobyte(config.feeRateSatPerKb)).
// @bsv/sdk's Transaction.fee/calculateChange (node_modules/@bsv/sdk/dist/esm/src/transaction/Transaction.js)
// drops the change output entirely once change <= 0, and the builder then throws "Not
// enough satoshis to mint a token, fund its Fuel and cover the fee" because it is left with
// only 3 outputs — so a mint needs the fee *and* at least 1 sat of change kept back, not
// just the Fuel and the License. A real build of this transaction against chainConfig
// (License ~4,305 B + Fuel ~1,202 B + Data ~111 B + one P2PKH input ~108 B + the P2PKH
// change output ~25 B + tx overhead) comes to ~5,841 bytes; ESTIMATED_MINT_TX_BYTES rounds
// that up for headroom (address-length and similar variance).
const ESTIMATED_MINT_TX_BYTES = 6_000;
const MINIMUM_CHANGE_SATOSHIS = 1;

/** The fee at config's rate for a mint-sized transaction, plus the smallest change @bsv/sdk
 * will keep (any less and it drops the change output rather than shrinking it). */
function mintMarginSatoshis(config: ChainConfig): number {
  return Math.ceil((ESTIMATED_MINT_TX_BYTES / 1000) * config.feeRateSatPerKb) + MINIMUM_CHANGE_SATOSHIS;
}

export interface MintResult {
  txid: string;
}

/** The License output (1 sat), its Fuel, and the margin (fee plus change) a mint needs on
 * top of those to succeed — see mintMarginSatoshis. */
export function mintCostSatoshis(config: ChainConfig = chainConfig): number {
  return (config.mintFuelSatoshis ?? 0) + LICENSE_TOKEN_SATOSHIS + mintMarginSatoshis(config);
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
