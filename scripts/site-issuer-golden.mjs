#!/usr/bin/env node
// scripts/site-issuer-golden.mjs — the mint half of the site issuer's golden fixture
// (mw-cvwm1u.3): a Lampas licence minted by spell-forge-bsv's buildContractMintTransaction,
// called exactly as src/services/issue.ts's issueLicence calls it, from fixed keys and
// coins, printed as JSON. The Go backend's own builder (server/internal/register/issue.go)
// must write the same bytes; tests/unit/site-issuer-golden.test.ts runs this and keeps
// server/internal/register/testdata/site-issuer-golden.json in step with it.
//   node scripts/site-issuer-golden.mjs
// The builder cannot run under vitest (mw-1589l.3), so this registers the same loader
// scripts/mint-licence.mjs does before it touches spell-forge-bsv.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./mint/ts-bridge-loader.mjs', import.meta.url), pathToFileURL('./'));

const { P2PKH, PrivateKey, Transaction } = await import('@bsv/sdk');
const { buildContractMintTransaction, chainConfig } = await import('spell-forge-bsv');

const TESTNET_WIF_PREFIX = [0xef];
const ISSUER_KEY_HEX = '5a'.repeat(32);
const HOLDER_KEY_HEX = '22'.repeat(32);
const COLLECTION = 'lampas';

const issuer = PrivateKey.fromHex(ISSUER_KEY_HEX);
const issuerAddress = issuer.toAddress(chainConfig.network);
const holderPublicKey = PrivateKey.fromHex(HOLDER_KEY_HEX).toPublicKey().toString();

/** A transaction paying the issuer `satoshis` at each output, as a coin's source. */
function source(lockTime, satoshis) {
  const tx = new Transaction();
  tx.lockTime = lockTime;
  for (const value of satoshis) tx.addOutput({ lockingScript: new P2PKH().lock(issuerAddress), satoshis: value });
  return tx;
}

// Two coins and a 1-sat output the builder must pass over (selectFeeUtxos).
const sources = [source(1, [60_000, 1]), source(2, [25_000])];
const funding = [
  { tx: sources[0], vout: 0 },
  { tx: sources[0], vout: 1 },
  { tx: sources[1], vout: 0 },
].map(({ tx, vout }) => ({ txid: tx.id('hex'), vout, satoshis: tx.outputs[vout].satoshis, sourceHex: tx.toHex() }));

const provider = {
  getTransactionHex: async (txid) => {
    const found = funding.find((utxo) => utxo.txid === txid);
    if (!found) throw new Error(`unknown source ${txid}`);
    return found.sourceHex;
  },
};

const built = await buildContractMintTransaction({
  issuerKey: issuer.toWif(TESTNET_WIF_PREFIX),
  utxos: funding.map(({ txid, vout, satoshis }) => ({ txid, vout, satoshis })),
  holderPubKey: holderPublicKey,
  mintFuelSatoshis: chainConfig.mintFuelSatoshis,
  config: { ...chainConfig, collectionId: COLLECTION },
  provider,
});

process.stdout.write(
  JSON.stringify(
    {
      issuerKeyHex: ISSUER_KEY_HEX,
      holderPublicKey,
      collection: COLLECTION,
      mintFuelSatoshis: chainConfig.mintFuelSatoshis,
      feeRateSatPerKb: chainConfig.feeRateSatPerKb,
      funding,
      mint: { txid: built.txid, hex: built.hex },
    },
    null,
    2,
  ) + '\n',
);
