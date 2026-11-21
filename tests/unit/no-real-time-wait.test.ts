// @vitest-environment node
// tests/unit/no-real-time-wait.test.ts — lint refuses a new real-time sleep in a test unless its line says why (mw-t5shinh.48, after Lampas mw-t5shinh.6).
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
const SPEC = 'tests/e2e/x.spec.ts';
const STEPS = 'features/steps/x.steps.tsx';

const errors = async (code: string, filePath: string) => {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'local/no-real-time-wait');
};

const SLEEPS: [string, string][] = [
  ['page.waitForTimeout', 'await page.waitForTimeout(500);'],
  ['a setTimeout promise', 'await new Promise((r) => setTimeout(r, 50));'],
  ['sleep(n)', 'await sleep(40);'],
  ['sleep(NAME_MS)', 'await sleep(SETTLE_MS);'],
];
const body = (line: string) => `export async function t(page: unknown) {\n  ${line}\n}\n`;
const REASON = '// a real-time wait: a live recording plays in real time';

describe('a real-time sleep in a test', () => {
  for (const [name, line] of SLEEPS) {
    for (const file of [SPEC, STEPS]) {
      it(`${name} is one error in ${file}`, async () => {
        const found = await errors(body(line), file);
        expect(found).toHaveLength(1);
        expect(found[0].message).toContain('expect.poll');
        expect(found[0].message).toContain('page.clock');
        expect(found[0].message).toContain('// a real-time wait:');
      });
    }
    it(`${name} passes with the mark on its line`, async () => {
      expect(await errors(body(`${line} ${REASON}`), SPEC)).toHaveLength(0);
    });
    it(`${name} passes with the mark on the line above`, async () => {
      expect(await errors(body(`${REASON}\n  ${line}`), STEPS)).toHaveLength(0);
    });
    it(`${name} is still refused when the mark has no reason`, async () => {
      expect(await errors(body(`${line} // a real-time wait:`), SPEC)).toHaveLength(1);
    });
    it(`${name} is not checked in src/`, async () => {
      expect(await errors(body(line), 'src/x.ts')).toHaveLength(0);
    });
  }

  it('accepts the older mark, a real-time hold', async () => {
    expect(await errors(body('await page.waitForTimeout(500); // a real-time hold: the host settles'), SPEC)).toHaveLength(0);
  });

  it('lets a sleep helper run on a variable', async () => {
    expect(await errors(body('await sleep(ms);'), SPEC)).toHaveLength(0);
  });
});

describe('the lint script', () => {
  it('passes on unpruned suppressions, so removing a sleep sends no story back', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.lint).toContain('eslint . --pass-on-unpruned-suppressions');
  });
});
