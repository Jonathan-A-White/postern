// scripts/mint/cli.mjs — registers the scrypt-ts bridge loader (ts-bridge-loader.mjs) before
// touching spell-forge-bsv, then runs runCli (lib.mjs). module.register() only affects
// imports made after it returns, so lib.mjs (and spell-forge-bsv, transitively) must be
// loaded with a dynamic import here, never a static one alongside register() in this file.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./ts-bridge-loader.mjs', import.meta.url), pathToFileURL('./'));

const { runCli } = await import('./lib.mjs');

process.exitCode = await runCli(process.argv.slice(2));
