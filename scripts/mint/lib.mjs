// scripts/mint/lib.mjs — the testable core of mint-licence.mjs (mw-f758y.22.5): mints a
// License to a WIF key's own address from that key's own testnet balance, the same shape
// mint.ts's mintMyLicence builds (buildContractMintTransaction, License + Fuel + a type-M
// Data output + change), but driven from a key file instead of the vault, and printing
// rather than caching the result. Kept free of src/ imports: mint.ts and licence.ts pull in
// Dexie (browser-only IndexedDB), which this script does not carry.
import { readFileSync } from 'node:fs';
import { PrivateKey, PublicKey } from '@bsv/sdk';
import { buildContractMintTransaction, chainConfig, createChainProvider } from 'spell-forge-bsv';

const LICENSE_TOKEN_SATOSHIS = 1;
// See src/services/mint.ts's ESTIMATED_MINT_TX_BYTES comment for the arithmetic this mirrors.
const ESTIMATED_MINT_TX_BYTES = 6_000;
const MINIMUM_CHANGE_SATOSHIS = 1;

export class UsageError extends Error {}
export class KeyFileError extends Error {}
export class InsufficientBalanceError extends Error {}

/** The fee at config's rate for a mint-sized transaction, plus the smallest change @bsv/sdk
 * will keep. Mirrors src/services/mint.ts's mintMarginSatoshis exactly. */
export function mintMarginSatoshis(config) {
  return Math.ceil((ESTIMATED_MINT_TX_BYTES / 1000) * config.feeRateSatPerKb) + MINIMUM_CHANGE_SATOSHIS;
}

/** Mirrors src/services/mint.ts's mintCostSatoshis exactly (kept independent of src/, which
 * pulls in Dexie). */
export function mintCostSatoshis(config = chainConfig) {
  return (config.mintFuelSatoshis ?? 0) + LICENSE_TOKEN_SATOSHIS + mintMarginSatoshis(config);
}

/** Mirrors src/services/licence.ts's addressForPublicKey exactly. */
export function addressForPublicKey(publicKeyHex, config = chainConfig) {
  return PublicKey.fromString(publicKeyHex).toAddress(config.network);
}

export function parseArgs(argv) {
  let keyFile;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--key-file') {
      keyFile = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }
  if (!keyFile) {
    throw new UsageError('Usage: mint-licence.mjs --key-file <path> [--dry-run]');
  }
  return { keyFile, dryRun };
}

/** Reads a single testnet WIF from a key file (mw postern key init's format: one line, the
 * WIF). Never includes the file's content in a thrown message: a malformed file's contents
 * might themselves be a secret pasted into the wrong place. */
export function readWif(keyFile) {
  let content;
  try {
    content = readFileSync(keyFile, 'utf-8');
  } catch (error) {
    const reason = error instanceof Error ? error.message.split(',')[0] : String(error);
    throw new KeyFileError(`Could not read key file ${keyFile} (${reason})`);
  }
  const wif = content.split('\n')[0].trim();
  if (!wif) {
    throw new KeyFileError(`Key file ${keyFile} is empty`);
  }
  try {
    PrivateKey.fromWif(wif);
  } catch {
    throw new KeyFileError(`Key file ${keyFile} does not contain a valid testnet WIF`);
  }
  return wif;
}

/**
 * Mints a License to the key's own address, funded by the key's own testnet UTXOs. Prints
 * the address, balance, cost and the built transaction's hex before deciding whether to
 * broadcast, so --dry-run and a real run share one path up to the broadcast itself.
 */
export async function mintFromKey({
  wif,
  dryRun = false,
  provider = createChainProvider(),
  config = chainConfig,
  buildMint = buildContractMintTransaction,
  log = () => {},
}) {
  const privateKey = PrivateKey.fromWif(wif);
  const publicKeyHex = privateKey.toPublicKey().toString();
  const address = addressForPublicKey(publicKeyHex, config);

  const utxos = await provider.getUtxos(address);
  const balance = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);
  const cost = mintCostSatoshis(config);

  log(`Address: ${address}`);
  log(`Balance: ${balance} sat`);
  log(`Mint cost: ${cost} sat`);

  if (balance < cost) {
    const shortfall = cost - balance;
    throw new InsufficientBalanceError(
      `Balance ${balance} sat is below the mint's cost of ${cost} sat (short ${shortfall} sat)`,
    );
  }

  const built = await buildMint({
    issuerKey: wif,
    utxos,
    holderPubKey: publicKeyHex,
    mintFuelSatoshis: config.mintFuelSatoshis,
    config,
    provider,
  });

  log(`Transaction hex: ${built.hex}`);

  if (dryRun) {
    return { address, balance, cost, hex: built.hex };
  }

  const txid = await provider.broadcast(built.hex);
  log(`Broadcast txid: ${txid}`);
  return { address, balance, cost, hex: built.hex, txid };
}

/** Parses argv, reads the key file, mints, and returns the process exit code — the whole
 * CLI, testable without spawning a process (a real run also needs the loader registered in
 * mint-licence.mjs, so buildContractMintTransaction can reach its scrypt-ts bridge). */
export async function runCli(argv, { provider, config = chainConfig, buildMint, log = console.log, errorLog = console.error } = {}) {
  let keyFile;
  let dryRun;
  try {
    ({ keyFile, dryRun } = parseArgs(argv));
  } catch (error) {
    errorLog(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let wif;
  try {
    wif = readWif(keyFile);
  } catch (error) {
    errorLog(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    await mintFromKey({ wif, dryRun, provider, config, buildMint, log });
    return 0;
  } catch (error) {
    errorLog(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
