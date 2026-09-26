// scripts/mint/ts-bridge-loader.mjs — a Node ESM loader hook (mw-f758y.22.5) that lets
// spell-forge-bsv's buildContractMintTransaction run under plain Node instead of Vite.
//
// The package ships its scrypt-ts contract bridge (dist/contracts/bridge/license-bridge.ts,
// fuel-bridge.ts, and the .ts files they import) as raw TypeScript source, loaded lazily by
// license-contract.js via `import.meta.glob(...)` — a Vite build-time macro, not a real
// JS API; under plain Node `import.meta.glob` is undefined, so calling
// buildContractMintTransaction throws "... .glob is not a function" (confirmed empirically
// while building this script). Vite's own transform for this package (vite.config.ts) also
// forces `experimentalDecorators: true` (scrypt-ts's @prop()/@method() are legacy
// decorators; TC39 standard-decorator semantics make scrypt-ts's method() throw instead).
// This loader reproduces just those two things, and nothing else:
//   - any .ts file under a /contracts/ directory is transformed with esbuild using the
//     same experimentalDecorators override, with .ts-extension resolution (the source
//     imports its siblings without an extension, which Vite resolves but Node's ESM
//     resolver does not);
//   - a .json import under /contracts/ is read directly, sidestepping Node's import
//     assertion requirement (the .ts source has no `with { type: 'json' }`);
//   - any .js source containing a literal `import.meta.glob(` call (only
//     license-contract.js, as of spell-forge-bsv 0.1.0) has that call rewritten to a
//     dynamic import(), which works identically for this package's usage (each call site
//     globs exactly one file and awaits its default export).
// Registered once, in-process, by mint-licence.mjs before it imports spell-forge-bsv:
// `node:module`'s register() only affects imports made after it returns, so this module is
// never loaded via a static top-level `import` alongside the register() call itself.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const CONTRACTS_DIR_MARKER = '/contracts/';
const GLOB_CALL = 'import.meta.glob(';
const GLOB_POLYFILL =
  'function __importMetaGlob(base, pattern) { return { [pattern]: () => import(new URL(pattern, base).href) }; }\n';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.includes(CONTRACTS_DIR_MARKER)) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return await nextResolve(`${specifier}.ts`, context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = await readFile(fileURLToPath(url), 'utf-8');
    const { code } = await esbuild.transform(source, {
      loader: 'ts',
      format: 'esm',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
      sourcefile: fileURLToPath(url),
    });
    return { format: 'module', source: code, shortCircuit: true };
  }

  if (url.endsWith('.json') && url.includes(CONTRACTS_DIR_MARKER)) {
    const source = await readFile(fileURLToPath(url), 'utf-8');
    return { format: 'json', source, shortCircuit: true };
  }

  if (url.endsWith('.js')) {
    const result = await nextLoad(url, context);
    if (typeof result.source === 'string' || Buffer.isBuffer(result.source)) {
      const text = typeof result.source === 'string' ? result.source : result.source.toString('utf-8');
      if (text.includes(GLOB_CALL)) {
        return { ...result, source: GLOB_POLYFILL + text.replaceAll(GLOB_CALL, '__importMetaGlob(import.meta.url, ') };
      }
    }
    return result;
  }

  return nextLoad(url, context);
}
