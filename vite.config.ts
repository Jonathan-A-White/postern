import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { pwaManifest } from './pwa-manifest';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

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
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg'],
      manifest: pwaManifest,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
