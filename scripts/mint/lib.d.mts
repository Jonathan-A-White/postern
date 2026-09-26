import type { ChainConfig, ChainProvider } from 'spell-forge-bsv';

export declare class UsageError extends Error {}
export declare class KeyFileError extends Error {}
export declare class InsufficientBalanceError extends Error {}

export declare function mintMarginSatoshis(config: ChainConfig): number;
export declare function mintCostSatoshis(config?: ChainConfig): number;
export declare function addressForPublicKey(publicKeyHex: string, config?: ChainConfig): string;

export interface ParsedArgs {
  keyFile: string;
  dryRun: boolean;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
export declare function readWif(keyFile: string): string;

export interface MintFromKeyOptions {
  wif: string;
  dryRun?: boolean;
  provider?: ChainProvider;
  config?: ChainConfig;
  buildMint?: (params: {
    issuerKey: string;
    utxos: { txid: string; vout: number; satoshis: number }[];
    holderPubKey: string;
    mintFuelSatoshis: number | undefined;
    config: ChainConfig;
    provider: ChainProvider;
  }) => Promise<{ hex: string; txid?: string }>;
  log?: (line: string) => void;
}
export interface MintFromKeyResult {
  address: string;
  balance: number;
  cost: number;
  hex: string;
  txid?: string;
}
export declare function mintFromKey(options: MintFromKeyOptions): Promise<MintFromKeyResult>;

export interface RunCliOptions {
  provider?: ChainProvider;
  config?: ChainConfig;
  buildMint?: MintFromKeyOptions['buildMint'];
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
}
export declare function runCli(argv: string[], options?: RunCliOptions): Promise<number>;
