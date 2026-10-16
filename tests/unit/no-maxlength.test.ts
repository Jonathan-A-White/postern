// mw-gq6.464: a text box with a limit never uses maxLength, which cuts a paste silently. It keeps the text whole, counts it
// with LengthNote and turns its Send off with the reason (src/ui/LengthNote.tsx, isTooLong in src/ui/lengthLimit.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../..');

/** maxLength set as a JSX prop (maxLength={500}), in an object of props ({ maxLength: 500 }) or by name ('maxlength'); a comment that names it does not count. */
const SETS_MAXLENGTH = /\bmaxlength\s*[=:]|['"`]maxlength['"`]/i;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('no text box cuts what he types or pastes (mw-gq6.464)', () => {
  it('the pattern catches the ways a box is given maxLength', () => {
    for (const source of ['<input maxLength={500} />', '<textarea maxlength="40" />', 'const props = { maxLength: 500 };', "input.setAttribute('maxlength', '500');"]) expect(source).toMatch(SETS_MAXLENGTH);
    expect('// a box with a limit never uses maxLength').not.toMatch(SETS_MAXLENGTH);
  });

  it('no input or textarea in src/ sets maxLength', () => {
    const offenders = sources(join(root, 'src'))
      .filter((path) => SETS_MAXLENGTH.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
