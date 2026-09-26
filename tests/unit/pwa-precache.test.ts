// @vitest-environment node
//
// tests/unit/pwa-precache.test.ts — mw-hy6f4.2 AC3. mermaid splits into many
// lazily-loaded chunks (one per diagram type, plus the elk/cytoscape/katex
// layout engines some diagram types need); workbox's injectManifest step
// silently drops any precached file over its maximumFileSizeToCacheInBytes
// cap (default 2 MiB) rather than failing the build, so a chunk that grows
// past the cap would fail offline with no build-time signal. This runs a
// real build with the project's real vite.config.ts and proves every built
// chunk — including mermaid's own — both fits under pwa-precache.ts's raised
// cap and actually appears in the generated service worker's precache list.
import { describe, it, expect, afterAll } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { injectManifestOptions } from '../../pwa-precache';

describe('the built mermaid chunks precache past workbox\'s default size cap', () => {
  const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.postern-precache-build-'));

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('raises maximumFileSizeToCacheInBytes past every built chunk, and the service worker precaches all of them', async () => {
    await build({
      configFile: path.resolve(process.cwd(), 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir },
    });

    const assetsDir = path.join(outDir, 'assets');
    const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));

    // mermaid.render's dynamic import (src/markdown/Mermaid.tsx) really did split
    // mermaid out of the main bundle into its own chunk.
    expect(jsFiles.some((f) => f.startsWith('mermaid.core-'))).toBe(true);

    const sizeOf = (file: string) => statSync(path.join(assetsDir, file)).size;
    const largest = Math.max(...jsFiles.map(sizeOf));

    const workboxDefaultCap = 2 * 1024 * 1024;
    expect(injectManifestOptions.maximumFileSizeToCacheInBytes).toBeGreaterThan(workboxDefaultCap);
    expect(injectManifestOptions.maximumFileSizeToCacheInBytes).toBeGreaterThan(largest);
    expect(injectManifestOptions.globPatterns.some((pattern) => pattern.includes('js'))).toBe(true);

    const sw = readFileSync(path.join(outDir, 'sw.js'), 'utf-8');
    for (const file of jsFiles) {
      expect(sw).toContain(`assets/${file}`);
    }
  }, 60_000);
});
