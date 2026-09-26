// pwa-precache.ts — mw-hy6f4.2: the injectManifest options, shared by
// vite.config.ts and its unit test. mermaid's chunk is ~2.5 MB minified,
// over workbox's default 2 MiB precache limit, so maximumFileSizeToCacheInBytes
// must be raised past it or the service worker silently drops the chunk from
// the precache and a diagram never draws offline.
export const injectManifestOptions = {
  globPatterns: ['**/*.{js,css,html,svg,woff2}'],
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
};
