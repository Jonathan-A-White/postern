import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Postern keeps no copy of what a kit ships (mw-6ww.175.14): useAlive comes from pwa-kit/alive, and the
// BSV pieces from one package, spell-forge-bsv, not that and bsv-kit both.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }

describe('no copy of kit code', () => {
  it('src/ui/useAlive.ts is gone: src/ui re-exports pwa-kit/alive', () => {
    expect(existsSync('src/ui/useAlive.ts')).toBe(false)
    expect(readFileSync('src/ui/index.ts', 'utf8')).toContain("from 'pwa-kit/alive'")
  })

  it('package.json holds one of spell-forge-bsv and bsv-kit, not both', () => {
    const held = ['spell-forge-bsv', 'bsv-kit'].filter((name) => name in pkg.dependencies)
    expect(held).toEqual(['spell-forge-bsv'])
  })
})
