// features/steps/keyboard-composer.steps.ts — runs features/keyboard-composer.feature (mw-ojmy9q3): the tab bar steps aside while a
// composer holds focus in a short window (an open keyboard), and the text field is capped at 28dvh. jsdom has no layout and does not
// run media queries, so these read the shipped css and the Shell; the browser run, at 360x640 and 390x844 with the keyboard's window,
// a banner and a picture, is tests/e2e/keyboard-composer.spec.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const feature = await loadFeature('features/keyboard-composer.feature');

describeFeature(feature, ({ Scenario }) => {
  let css = '';
  let shell = '';
  const shipped = () => {
    css = read('src/index.css');
    shell = read('src/cockpit/Shell.tsx');
  };

  Scenario('mw-ojmy9q3: the tab bar steps aside while a composer has focus in a short window, so it never covers the text field', ({ Given, Then, And }) => {
    Given("the app's stylesheet and shell as shipped", shipped);
    Then("the phone's tab bar is marked, and the wide layout's sidebar is not", () => {
      expect(shell).toMatch(/<nav aria-label="Places" className="mb-safe[^"]*" data-tabbar>/);
      expect(shell).not.toMatch(/<nav aria-label="Places" className="flex w-60[^"]*" data-tabbar/);
    });
    And('a window under 35rem tall with a composer holding focus hides the tab bar', () => {
      expect(css).toMatch(/@media \(max-height: 35rem\)\s*\{\s*\[data-shell\]:has\(\.bk-composer:focus-within\) \[data-tabbar\]\s*\{\s*display: none;/);
    });
    And('the rule keys on focus-within, so a tap on Send does not bring the bar back mid-tap', () => {
      expect(css).toContain(':focus-within');
      expect(css).not.toMatch(/\.bk-composer:focus\)/);
    });
  });

  Scenario('mw-ojmy9q3: the text field never takes more than 28 percent of the window', ({ Given, Then }) => {
    Given("the app's stylesheet and shell as shipped", shipped);
    Then("the composer's field max height is the smaller of 200px and 28dvh", () => {
      expect(css).toMatch(/--bk-composer-field-max-height:\s*min\(200px,\s*28dvh\)/);
    });
  });
});
