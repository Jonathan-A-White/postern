// features/steps/screen-stays-put.steps.ts — runs features/screen-stays-put.feature (mw-jkrnxu.2): the
// scroll guard puts html, body and the Shell root back at 0 after the events that leave a phone's page
// scrolled, and the shipped css, viewport meta and focus calls cannot scroll it. jsdom has no layout, so
// scrollTop is a plain number the steps set. The browser run is tests/e2e/screen-stays-put.spec.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { installScrollGuard } from '../../src/ui/scrollGuard';

let stop: (() => void) | undefined;
let shell: HTMLElement;

function pushed(): void {
  stopGuard();
  document.body.innerHTML = '<div id="root"><div data-shell></div></div>';
  shell = document.querySelector<HTMLElement>('[data-shell]')!;
  document.documentElement.scrollTop = 300;
  document.body.scrollTop = 300;
  shell.scrollTop = 300;
  stop = installScrollGuard();
}

function atTop(): void {
  expect(document.documentElement.scrollTop).toBe(0);
  expect(document.body.scrollTop).toBe(0);
  expect(shell.scrollTop).toBe(0);
}

// each Given/When/Then is its own vitest test, so the guard is stopped when a scenario starts over and at the end
function stopGuard(): void {
  stop?.();
  stop = undefined;
}
afterAll(stopGuard);

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
function sources(dir: string): Array<{ path: string; text: string }> {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.tsx') ? [{ path, text: read(path) }] : [];
  });
}

const feature = await loadFeature('features/screen-stays-put.feature');

describeFeature(feature, ({ Scenario }) => {
  const guarded = (title: string, when: string, act: () => void) =>
    Scenario(title, ({ Given, When, Then }) => {
      Given('a page the keyboard has scrolled down, with the scroll guard on', pushed);
      When(when, act);
      Then('the document, the body and the Shell root are back at scrollTop 0', atTop);
    });

  guarded('mw-jkrnxu.2: a page scrolled by the keyboard is put back at the top when the window resizes', 'the window resizes', () => {
    window.dispatchEvent(new Event('resize'));
  });
  guarded('mw-jkrnxu.2: a page scrolled while he was away is put back when the app returns to the foreground', 'the app becomes visible again', () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  guarded('mw-jkrnxu.2: a page scrolled by a focus is put back when the box loses focus', 'a box loses focus', () => {
    window.dispatchEvent(new Event('focusout'));
  });
  guarded('mw-jkrnxu.2: a page restored from the back-forward cache is put back at the top', 'the page is shown again', () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  guarded('mw-jkrnxu.2: a page that scrolls itself is put back at once', 'the Shell root is scrolled', () => {
    shell.dispatchEvent(new Event('scroll'));
  });

  Scenario('mw-jkrnxu.2: once the guard is stopped the page is left alone', ({ Given, When, Then }) => {
    Given('a page the keyboard has scrolled down, with the scroll guard on', pushed);
    When('the guard is stopped and the window resizes', () => {
      stopGuard();
      window.dispatchEvent(new Event('resize'));
    });
    Then('the Shell root is still scrolled', () => {
      expect(shell.scrollTop).toBe(300);
    });
  });

  Scenario('mw-jkrnxu.2: the shipped page cannot be scrolled and its focus never scrolls', ({ Given, Then, And }) => {
    let css = '';
    let html = '';
    let shellSource = '';
    Given("the app's stylesheet, page and screens as shipped", () => {
      css = read('src/index.css');
      html = read('index.html');
      shellSource = read('src/cockpit/Shell.tsx');
    });
    Then('html, body and the root are overflow clip, not hidden', () => {
      expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*clip/);
      expect(css).toMatch(/#root\s*\{[^}]*overflow:\s*clip/);
      expect(css).not.toMatch(/overflow:\s*hidden/);
    });
    And('the Shell root is overflow clip and named for the guard', () => {
      expect(shellSource).toMatch(/<div data-shell className="[^"]*\boverflow-clip\b/);
    });
    And('the viewport meta says interactive-widget resizes-content', () => {
      expect(html).toMatch(/<meta name="viewport"[^>]*interactive-widget=resizes-content/);
    });
    And('no screen focuses a box with autoFocus or a focus call that may scroll', () => {
      for (const { path, text } of sources('src')) {
        if (path === 'src/sw.ts' || path === 'src/ui/focus.ts') continue;
        expect(text, `${path} puts autoFocus on a native box`).not.toMatch(/<(input|textarea)\b(?:(?!\/>)[\s\S])*?\bautoFocus\b/);
        expect(text, `${path} has a focus() that may scroll`).not.toMatch(/\.focus\(\s*\)/);
      }
    });
  });
});
