import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The shared kits' heads this rig is pinned to (mw-6ww.175.23). Moving a pin
// means moving it here, in dependencies, and in allowScripts: a pin moved only
// in dependencies has its install scripts skipped.
const PINS: Record<string, string> = {
  'voice-kit': 'c5f76b2b7044d00eaecc827a7cbdce5b802768b0',
  'pwa-kit': 'ac66874a0bdfc4bc4052390b38499594e250f567',
  'audible-kit': '273fadf8733ab4c99fbbfcde618a8eeb6d5fb0d4',
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>
  allowScripts: Record<string, boolean>
}

describe('kit pins', () => {
  for (const [kit, sha] of Object.entries(PINS)) {
    const spec = `github:Jonathan-A-White/${kit}#${sha}`
    it(`${kit} is pinned in dependencies to ${sha.slice(0, 7)}`, () => {
      expect(pkg.dependencies[kit]).toBe(spec)
    })
    it(`${kit} has the same pin as a key of allowScripts`, () => {
      expect(pkg.allowScripts[spec]).toBe(true)
    })
  }

  it('allowScripts names no kit pin that dependencies no longer holds', () => {
    const held = new Set(Object.values(pkg.dependencies))
    for (const key of Object.keys(pkg.allowScripts)) {
      if (key.startsWith('github:Jonathan-A-White/')) expect(held.has(key)).toBe(true)
    }
  })
})
