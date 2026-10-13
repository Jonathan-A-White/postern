import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { pwaManifest } from './pwa-manifest';
import { injectManifestOptions } from './pwa-precache';
import { buildStampAt, buildStampHtml, buildVersion, shortCommit } from './build-version';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// The build stamp rides in index.html, not in a chunk, and the libraries from node_modules that the first
// screen needs sit in a chunk of their own: a build whose app code is unchanged gives the main chunk the
// same name and bytes, and a build that changes app code leaves the library chunk's name alone, so an update
// downloads only what changed (mw-7dige5.3). A module that only a lazy chunk reaches (mermaid, elk, the
// contract bridge) stays with that chunk, so it is never fetched up front.
const stampedAt = buildStampAt();

function reachedFirst(id: string, ctx: { getModuleInfo: (id: string) => { isEntry: boolean; importers: readonly string[] } | null }, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const info = ctx.getModuleInfo(id);
  if (!info) return false;
  return info.isEntry || info.importers.some((importer) => reachedFirst(importer, ctx, seen));
}

function libraryChunk(id: string, ctx: Parameters<typeof reachedFirst>[1]): string | undefined {
  if (!id.includes('/node_modules/') || id.includes('\0')) return undefined;
  return reachedFirst(id, ctx) ? 'vendor' : undefined;
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      // scrypt-ts's Provider class (bundled inside spell-forge-bsv's lazy contract bridge)
      // does `class Provider extends require('events').default`; Vite's browser build
      // externalizes Node's `events` to an empty stand-in object, so that throws "Class
      // extends value #<Object> is not a constructor or null" the moment the bridge chunk
      // loads (mw-1589l.19). spell-forge-bsv ships a real EventEmitter for this; the bare
      // specifier doesn't resolve through its package.json exports map from inside
      // scrypt-ts's own resolution, so alias to the file directly.
      events: fileURLToPath(new URL('./node_modules/spell-forge-bsv/dist/browser-events.js', import.meta.url)),
    },
  },
  esbuild: {
    // spell-forge-bsv ships its scrypt-ts contract classes (dist/contracts/fuel.ts,
    // license.ts) as .ts source with no tsconfig of its own; esbuild falls back to the
    // nearest tsconfig it can find, which for a node_modules file is postern's root
    // tsconfig.json (no compilerOptions), so it lowers scrypt-ts's legacy
    // @prop()/@method() decorators with TC39 standard-decorator semantics instead of the
    // legacy semantics scrypt-ts 1.4.5 expects — a decorator called as dec(value, context)
    // instead of dec(target, key, descriptor). scrypt-ts's method() decorator then reads
    // `descriptor.value` of the missing legacy third argument and throws "Cannot read
    // properties of undefined (reading 'value')" the moment the class is defined
    // (mw-1589l.20). tsconfigRaw overrides esbuild's per-file tsconfig lookup globally, so
    // this applies to every file esbuild transforms, node_modules included.
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: (id, ctx) => libraryChunk(id, ctx) },
    },
  },
  plugins: [
    {
      name: 'postern-build-stamp',
      transformIndexHtml: () => [
        { tag: 'script', children: buildStampHtml(buildVersion(pkg.version, stampedAt, shortCommit())), injectTo: 'head-prepend' },
      ],
    },
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': a new build waits until he taps the 'Update ready' banner (mw-yxwtth.1).
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg'],
      manifest: pwaManifest,
      injectManifest: injectManifestOptions,
    }),
  ],
});
