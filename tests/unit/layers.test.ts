// mw-6ww.175.11 (B8, B12): the layers of src are written down in eslint-rules/layers.js's config and held by
// the lint: data under model under services under the screens. The inversions that already exist are listed
// in eslint-rules/layer-inversions.js; the list may shrink and never grow.
import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain JS module with no types
import rule from '../../eslint-rules/layers.js';
// @ts-expect-error a plain JS module with no types
import { LAYERS, INVERSIONS } from '../../eslint-rules/layer-inversions.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// The number of allowed inversions this story recorded. Lower it when an inversion is fixed; never raise it.
const RECORDED_INVERSIONS = 21;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const layers = [['data'], ['model'], ['services'], ['cockpit', 'todo', 'key']];

tester.run('layers', rule, {
  valid: [
    { code: "import { a } from '../model/a';", filename: `${process.cwd()}/src/cockpit/Screen.tsx`, options: [{ layers, inversions: [] }] },
    { code: "import { a } from '../data/db';", filename: `${process.cwd()}/src/model/a.ts`, options: [{ layers, inversions: [] }] },
    { code: "import { a } from './b';", filename: `${process.cwd()}/src/model/a.ts`, options: [{ layers, inversions: [] }] },
    { code: "import { a } from '../ui/Button';", filename: `${process.cwd()}/src/model/a.ts`, options: [{ layers, inversions: [] }] },
    { code: "import { a } from 'react';", filename: `${process.cwd()}/src/model/a.ts`, options: [{ layers, inversions: [] }] },
    {
      code: "import { a } from '../cockpit/Screen';",
      filename: `${process.cwd()}/src/model/a.ts`,
      options: [{ layers, inversions: ['src/model/a.ts -> src/cockpit/Screen'] }],
    },
  ],
  invalid: [
    {
      code: "import { a } from '../cockpit/Screen';",
      filename: `${process.cwd()}/src/model/a.ts`,
      options: [{ layers, inversions: [] }],
      errors: [{ messageId: 'inversion' }],
    },
    {
      code: "export { a } from '../services/s';",
      filename: `${process.cwd()}/src/data/db.ts`,
      options: [{ layers, inversions: [] }],
      errors: [{ messageId: 'inversion' }],
    },
    {
      code: "async function f() { return import('../cockpit/Screen'); }",
      filename: `${process.cwd()}/src/services/s.ts`,
      options: [{ layers, inversions: [] }],
      errors: [{ messageId: 'inversion' }],
    },
    {
      code: "import { a } from '../cockpit/Other';",
      filename: `${process.cwd()}/src/model/a.ts`,
      options: [{ layers, inversions: ['src/model/a.ts -> src/cockpit/Screen'] }],
      errors: [{ messageId: 'inversion' }],
    },
  ],
});

describe('the list of allowed inversions', () => {
  it('names an upward import from src/model into src/cockpit as refused unless listed', () => {
    expect(LAYERS.flat()).toEqual(expect.arrayContaining(['data', 'model', 'services', 'cockpit']));
    expect(INVERSIONS.some((i: string) => i.startsWith('src/model/') && i.includes('-> src/cockpit/'))).toBe(false);
  });

  it('is no longer than the count this story recorded', () => {
    expect(INVERSIONS.length).toBeLessThanOrEqual(RECORDED_INVERSIONS);
  });

  it('lists no inversion twice', () => {
    expect(new Set(INVERSIONS).size).toBe(INVERSIONS.length);
  });
});
