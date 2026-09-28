import type { ManifestOptions } from 'vite-plugin-pwa';

export const pwaManifest: Partial<ManifestOptions> = {
  name: 'Postern',
  short_name: 'Postern',
  description: 'The private gate between the Governor and the Mayor',
  display: 'standalone',
  start_url: '/',
  scope: '/',
  background_color: '#0a0e17',
  theme_color: '#0a0e17',
  // plans/0021 decision 12: Postern in Android's share sheet. src/sw.ts parks
  // what arrives and opens the Share screen to place it in a thread.
  share_target: {
    action: '/share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      title: 'title',
      text: 'text',
      url: 'url',
      files: [{ name: 'files', accept: ['image/*', 'audio/*', 'application/pdf', 'text/plain'] }],
    },
  },
  icons: [
    {
      src: '/icon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: '/icon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'maskable',
    },
  ],
};
