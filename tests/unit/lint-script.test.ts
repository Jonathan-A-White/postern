import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The gate lints with `npm run lint` and nothing else runs go vet over server/,
// so the lint script carries it (mw-gq6.1261): a vet error in server/ must not
// reach main.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}

describe('npm run lint', () => {
  it('runs eslint', () => {
    expect(pkg.scripts.lint).toMatch(/\beslint \./)
  })

  it('runs go vet over server/', () => {
    expect(pkg.scripts.lint).toContain('cd server && go vet ./...')
  })
})
