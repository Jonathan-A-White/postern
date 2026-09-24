import type { ManifestOptions } from 'vite-plugin-pwa';

export const pwaManifest: Partial<ManifestOptions> = {
  name: 'Postern',
  short_name: 'Postern',
  description: 'The private gate between the Governor and the Mayor',
  display: 'standalone',
  start_url: '/',
  scope: '/',
  background_color: '#0F172A',
  theme_color: '#0F172A',
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
