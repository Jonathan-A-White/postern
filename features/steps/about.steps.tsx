// features/steps/about.steps.tsx — runs features/about.feature (mw-vtjxh4.3): the real Me
// screen's link to About, the real About screen, and the credits checked against
// package.json, server/go.mod and the README.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { readFileSync } from 'node:fs';
import { AboutScreen } from '../../src/cockpit/AboutScreen';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { allCredits, goModules, uncredited } from '../../src/credits';

const feature = await loadFeature('features/about.feature');

let declared: string[] = [];

describeFeature(feature, ({ Scenario }) => {
  afterAll(() => cleanup());

  const openAbout = () => {
    cleanup();
    render(<AboutScreen />);
  };

  Scenario('AC-1: the Me screen links to About, and the link opens it', ({ When, Then }) => {
    When('the Me screen is opened', () => {
      cleanup();
      render(<MeScreen />);
    });
    Then('it has a link {string} to the About screen', (_c, label: string) => {
      const link = screen.getByRole('link', { name: new RegExp(label) });
      expect(link.getAttribute('href')).toBe('?v=about');
    });
  });

  Scenario("AC-1: About opens with Newton's line, attributed, and one sentence on why we credit", ({ When, Then, And }) => {
    When('the About screen is opened', openAbout);
    Then("its first words are Newton's {string}", (_c, quote: string) => {
      const block = screen.getByRole('figure');
      expect(within(block).getByText(quote)).toBeInTheDocument();
      // ...and it comes before the first list of credits.
      const firstSection = document.querySelector('section[aria-label]');
      expect(block.compareDocumentPosition(firstSection as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    And('the line is attributed to Isaac Newton, in his letter to Robert Hooke, 1675', () => {
      const caption = within(screen.getByRole('figure')).getByText(/Isaac Newton/);
      expect(caption.textContent).toMatch(/letter to Robert Hooke, 1675/);
    });
    And('one sentence follows on why we credit', () => {
      const why = screen.getByTestId('why-we-credit');
      expect(why.textContent?.match(/[.!?](\s|$)/g)).toHaveLength(1);
      expect(why.textContent).toMatch(/credit/i);
    });
  });

  Scenario("AC-1: every credit names itself as a link, says what it is used for, links its licence and says what was changed", ({ When, Then, And }) => {
    When('the About screen is opened', openAbout);
    Then("every credit's name is a link, never a raw address", () => {
      for (const credit of allCredits()) {
        const row = screen.getByTestId(`credit-${credit.name}`);
        const link = within(row).getByRole('link', { name: credit.name });
        expect(link.getAttribute('href')).toBe(credit.url);
        expect(link.textContent).not.toMatch(/https?:\/\//);
      }
    });
    And('every credit says what it is used for and what was changed', () => {
      for (const credit of allCredits()) {
        const row = screen.getByTestId(`credit-${credit.name}`);
        expect(row.textContent).toContain(credit.use);
        expect(row.textContent).toContain(credit.changes);
      }
    });
    And("every credit's licence is a link", () => {
      for (const credit of allCredits()) {
        const row = screen.getByTestId(`credit-${credit.name}`);
        const link = within(row).getByRole('link', { name: credit.licence });
        expect(link.getAttribute('href')).toBe(credit.licenceUrl);
      }
    });
  });

  Scenario('AC-1: the sources we name include the services, the ideas and the speech engines', ({ When, Then, And }) => {
    When('the About screen is opened', openAbout);
    Then('it credits {string}, {string}, {string}, {string} and {string}', (_c, ...names: string[]) => {
      for (const name of names) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    });
    And('it says plainly that Postern ships no font or icon library', () => {
      expect(screen.getByTestId('fonts-and-icons').textContent).toMatch(/no font/i);
      expect(screen.getByTestId('fonts-and-icons').textContent).toMatch(/icon/i);
    });
  });

  Scenario('AC-2: a runtime dependency missing from the credits is found', ({ Given, Then }) => {
    Given('a package.json dependency {string} that no credit covers', (_c, name: string) => {
      declared = ['react', name];
    });
    Then('the check for uncredited dependencies names {string}', (_c, name: string) => {
      expect(uncredited(declared)).toEqual([name]);
    });
  });

  Scenario('AC-2: every runtime dependency in package.json and go.mod is credited today', ({ Given, Then }) => {
    Given('the dependencies in package.json and the modules in server/go.mod', () => {
      const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { dependencies: Record<string, string> };
      declared = [...Object.keys(pkg.dependencies), ...goModules(readFileSync('server/go.mod', 'utf-8'))];
      expect(declared.length).toBeGreaterThan(10);
    });
    Then('none of them goes uncredited', () => {
      expect(uncredited(declared)).toEqual([]);
    });
  });

  Scenario("AC-3: the README's Credits section lists the same credits", ({ Given, Then }) => {
    let credits = '';
    Given('the README', () => {
      const readme = readFileSync('README.md', 'utf-8');
      const start = readme.indexOf('\n## Credits');
      expect(start).toBeGreaterThan(-1);
      const rest = readme.slice(start + 1);
      const next = rest.indexOf('\n## ', 4);
      credits = next === -1 ? rest : rest.slice(0, next);
    });
    Then('its Credits section names every credit shown on About', () => {
      for (const credit of allCredits()) expect(credits, credit.name).toContain(`[${credit.name}](${credit.url})`);
    });
  });
});
