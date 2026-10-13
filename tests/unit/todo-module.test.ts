// tests/unit/todo-module.test.ts — mw-ev7oyy.4: src/todo/ is a module behind its barrel. Nothing
// outside it imports one of its files, only src/todo/index.ts (its door).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const inside = resolve('src/todo') + sep;

describe('src/todo/', () => {
  it('is imported from outside only through its index', () => {
    const offenders: string[] = [];
    for (const file of [...sources('src'), ...sources('tests'), ...sources('features')]) {
      if (resolve(file).startsWith(inside)) continue;
      const text = readFileSync(file, 'utf-8');
      for (const [, spec] of text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(join(file, '..', spec));
        if ((target + sep).startsWith(inside) && target !== resolve('src/todo') && target !== resolve('src/todo/index')) offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has a store interface and one adapter over the Postern view', () => {
    const names = readdirSync('src/todo');
    expect(names).toContain('store.ts');
    expect(names).toContain('posternStore.ts');
    expect(names).toContain('index.ts');
  });
});
