// @vitest-environment node
//
// mw-1589l.19: scrypt-ts's Provider class (bundled inside spell-forge-bsv's lazily-loaded
// contract bridge) does `class Provider extends require('events').default`. Vite's browser
// build externalizes Node's `events` to an empty stand-in object unless vite.config.ts
// aliases it to a real EventEmitter, so that class declaration throws "Class extends value
// #<Object> is not a constructor or null" the moment the bridge chunk is evaluated — before
// buildContractMintTransaction (or any other bridge-using call) runs.
//
// This builds a tiny standalone bundle of readLicenseState, a real spell-forge-bsv export
// that calls the same installProcessStub/installBufferStub + lazy import.meta.glob bridge
// load that buildContractMintTransaction uses, with vite.config.ts's actual resolve config,
// then runs the bundle in Node. Importing the built chunk file directly (bypassing that
// stub-installing entry point) hits an unrelated "process is not defined" first and proves
// nothing about this bug.
import { describe, it, expect, afterAll } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import viteConfig from '../../vite.config';

describe('vite.config.ts events alias for spell-forge-bsv', () => {
  // Node resolves bare specifiers by walking up from the importer looking for
  // node_modules, so a bundling entry outside the project (e.g. os.tmpdir()) can't
  // resolve "spell-forge-bsv"; nest it under node_modules so it inherits the real tree.
  const tmpDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.postern-events-alias-'));

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // A real vite build, run alongside the rest of the suite, comfortably exceeds vitest's
  // default 5s test timeout.
  it('lets the license bridge module evaluate without the events-externalization bug', async () => {
    const entry = path.join(tmpDir, 'entry.ts');
    writeFileSync(
      entry,
      [
        "import { readLicenseState } from 'spell-forge-bsv';",
        // '00' is not a valid locking script; that's fine, and expected to reject once past
        // module evaluation. What matters is *how* it rejects.
        "export const probe = readLicenseState('00').then(",
        '  () => null,',
        '  (error: Error) => error.message,',
        ');',
      ].join('\n'),
    );
    const outDir = path.join(tmpDir, 'out');

    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: viteConfig.resolve,
      build: {
        lib: { entry, formats: ['es'], fileName: () => 'probe.js' },
        outDir,
        minify: false,
        write: true,
      },
    });

    const built = (await import(/* @vite-ignore */ pathToFileURL(path.join(outDir, 'probe.js')).href)) as {
      probe: Promise<string | null>;
    };
    const message = (await built.probe) ?? '';

    expect(message).not.toContain('Class extends value');
  }, 20_000);
});
