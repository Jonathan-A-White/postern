import { describe, it, expect } from 'vitest';
import { pwaManifest } from '../../pwa-manifest';

describe('pwaManifest', () => {
  it('has name Postern and display standalone', () => {
    expect(pwaManifest.name).toBe('Postern');
    expect(pwaManifest.display).toBe('standalone');
  });
});
