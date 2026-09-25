// @vitest-environment node
//
// mw-1589l.20: tapping "Mint my licence (testnet)" in the deployed build fails with
// "Cannot read properties of undefined (reading 'value')". Vite/esbuild picks decorator
// semantics from the nearest tsconfig of the file being compiled; spell-forge-bsv ships
// its contract classes (dist/contracts/fuel.ts, license.ts) as .ts source with no tsconfig
// of its own, so esbuild falls back to postern's root tsconfig.json (no compilerOptions)
// and lowers scrypt-ts's legacy @prop()/@method() decorators with TC39 STANDARD-decorator
// semantics instead of the legacy semantics scrypt-ts 1.4.5 expects. Under standard
// semantics a decorator is called as dec(value, context); scrypt-ts's method() reads
// legacy's third `descriptor` argument, gets `undefined` for it, and its first line —
// `const originalMethod = descriptor.value` — throws.
//
// This builds a tiny standalone bundle, with vite.config.ts's real resolve+esbuild
// settings, of an entry that imports spell-forge-bsv's fuel and license bridges directly
// (node_modules/spell-forge-bsv/dist/contracts/bridge/{fuel,license}-bridge.ts) and calls
// each bridge's lockingScript, then runs the bundle in Node — the same method
// tests/unit/vite-events-alias.test.ts (mw-1589l.19) used for the events-externalization
// bug one module earlier in the same load path.
import { describe, it, expect, afterAll } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import viteConfig from '../../vite.config';
import fuelArtifact from '../../node_modules/spell-forge-bsv/dist/contracts/artifacts/fuel.json';
import licenseArtifact from '../../node_modules/spell-forge-bsv/dist/contracts/artifacts/license.json';

// A committed artifact's `hex` is the contract's locking script template, with each
// constructor prop written as a literal `<propName>` placeholder. The real locking script
// substitutes each placeholder with that prop's value, minimally push-encoded (a single
// length byte plus the data, valid for every value used below, all well under 76 bytes).
// Computing the substituted template from the artifact (rather than hard-coding a byte
// count) keeps the assertion tied to the artifact actually shipped, not a snapshot of today's.
function substituteLockingScriptTemplate(templateHex: string, substitutions: [placeholder: string, valueHex: string][]): string {
  return substitutions.reduce((hex, [placeholder, valueHex]) => {
    const pushHex = (valueHex.length / 2).toString(16).padStart(2, '0') + valueHex;
    return hex.replace(placeholder, pushHex);
  }, templateHex);
}

describe('vite.config.ts decorator settings for spell-forge-bsv contract classes', () => {
  // Nested under node_modules so the entry inherits the real module tree (see
  // vite-events-alias.test.ts for why this must live under node_modules, not os.tmpdir()).
  const tmpDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.postern-contract-decorators-'));

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // A real vite build, run alongside the rest of the suite, comfortably exceeds vitest's
  // default 5s test timeout.
  it('lets the fuel and license bridges build a locking script from the committed artifacts', async () => {
    const fuelBridgePath = path.join(process.cwd(), 'node_modules/spell-forge-bsv/dist/contracts/bridge/fuel-bridge.ts');
    const licenseBridgePath = path.join(process.cwd(), 'node_modules/spell-forge-bsv/dist/contracts/bridge/license-bridge.ts');
    const entry = path.join(tmpDir, 'entry.ts');
    writeFileSync(
      entry,
      [
        `import { fuelBridge } from ${JSON.stringify(fuelBridgePath)};`,
        `import { licenseBridge } from ${JSON.stringify(licenseBridgePath)};`,
        "import { chainConfig } from 'spell-forge-bsv';",
        '',
        'function collectionIdHex(): string {',
        "  return Buffer.from(chainConfig.collectionId, 'utf8').toString('hex');",
        '}',
        '',
        // A fixed, valid-shaped compressed pubkey (secp256k1's generator point) and an
        // all-zero fuel script hash: the License bridge only encodes these into the
        // script, it does not verify them against a real Fuel or key.
        "const OWNER_PUBKEY_HEX = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';",
        "const FUEL_SCRIPT_HASH_HEX = '00'.repeat(32);",
        '',
        'export const fuelLockingScriptHex = fuelBridge.lockingScript(collectionIdHex());',
        'const licenseState = {',
        '  collectionIdHex: collectionIdHex(),',
        '  fuelScriptHashHex: FUEL_SCRIPT_HASH_HEX,',
        '  ownerPubKeyHex: OWNER_PUBKEY_HEX,',
        '};',
        'export const licenseLockingScriptHex = licenseBridge.lockingScript(licenseState);',
      ].join('\n'),
    );
    const outDir = path.join(tmpDir, 'out');

    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: viteConfig.resolve,
      esbuild: viteConfig.esbuild,
      build: {
        lib: { entry, formats: ['es'], fileName: () => 'probe.js' },
        outDir,
        minify: false,
        write: true,
      },
    });

    const outFile = path.join(outDir, 'probe.js');
    const source = readFileSync(outFile, 'utf-8');

    // esbuild's TC39-standard-decorator lowering routes every field/method decoration
    // through a shared `__decorateElement` helper; its legacy-decorator lowering (what
    // scrypt-ts 1.4.5's @prop()/@method() need) uses `__decorateClass` instead. Before the
    // fix the built chunk carries the former; this is the same distinction that, at import
    // time, throws "Cannot read properties of undefined (reading 'value')" inside
    // scrypt-ts's method() decorator (it destructures a legacy third `descriptor` argument
    // standard-decorator calling convention never supplies).
    expect(source).not.toContain('__decorateElement');
    expect(source).toContain('__decorateClass');

    const built = (await import(/* @vite-ignore */ pathToFileURL(outFile).href)) as {
      fuelLockingScriptHex: string;
      licenseLockingScriptHex: string;
    };

    const collectionIdHex = Buffer.from('spellforge-leaderboard-testnet', 'utf8').toString('hex');
    const fuelScriptHashHex = '00'.repeat(32);
    const ownerPubKeyHex = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

    // Fuel carries no mutable state: its whole locking script is exactly the artifact's
    // code template with the collectionId placeholder substituted.
    const expectedFuelHex = substituteLockingScriptTemplate(fuelArtifact.hex, [['<collectionId>', collectionIdHex]]);
    expect(built.fuelLockingScriptHex).toBe(expectedFuelHex);

    // License's ownerPubKey is a mutable @prop(true): scrypt-ts appends a serialized
    // current-state suffix after the code template (a format this test does not
    // reverse-engineer), so the built script is the substituted template followed by more
    // bytes, not equal to it. Checking the prefix still proves every constructor prop was
    // substituted correctly by a correctly-decorated License class.
    const expectedLicensePrefix = substituteLockingScriptTemplate(licenseArtifact.hex, [
      ['<collectionId>', collectionIdHex],
      ['<fuelScriptHash>', fuelScriptHashHex],
      ['<ownerPubKey>', ownerPubKeyHex],
    ]);
    expect(built.licenseLockingScriptHex).toMatch(/^[0-9a-f]+$/);
    expect(built.licenseLockingScriptHex.startsWith(expectedLicensePrefix)).toBe(true);
    expect(built.licenseLockingScriptHex.length).toBeGreaterThan(expectedLicensePrefix.length);
  }, 30_000);
});
