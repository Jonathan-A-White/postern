import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    maxWorkers: 4,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'features/steps/**/*.steps.ts',
      'features/steps/**/*.steps.tsx',
    ],
    // A handful of files run a real vite build (tests/unit/vite-*.test.ts,
    // pwa-precache.test.ts); running every worker at once on a shared host lets
    // those pile up and blow their own timeouts (mw-tfne4.33's landing failure).
    // Capping workers trades a little wall time for not timing out under load.
    maxWorkers: 4,
  },
});
