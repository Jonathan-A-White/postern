// features/steps/code-copy.steps.tsx — runs features/code-copy.feature.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { CodeBlock } from '../../src/ui/CodeBlock';
import { Markdown } from '../../src/markdown';

const SOURCE = 'git pull\nnpm ci && npm run build';
const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$dir = 'C:\\ProgramData\\millwright'",
  'New-Item -ItemType Directory -Force $dir | Out-Null',
].join('\n');
const writeText = vi.fn().mockResolvedValue(undefined);

const feature = await loadFeature('features/code-copy.feature');

describeFeature(feature, ({ Scenario, AfterAllScenarios }) => {
  AfterAllScenarios(() => cleanup());
  Scenario("AC-1: Copy puts the block's exact text on the clipboard and says Copied", ({ Given, When, Then, And }) => {
    Given('a code block with a multi-line command', () => {
      cleanup();
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(<CodeBlock text={SOURCE} />);
    });
    When('Copy is tapped', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    Then('the clipboard holds the exact text', () => {
      expect(writeText).toHaveBeenCalledWith(SOURCE);
    });
    And('the button says Copied', async () => {
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });
  });
  Scenario("AC-2: Copy on a multi-line fenced block in a message copies its lines and nothing more (mw-6ww.92)", ({ Given, When, Then, And }) => {
    Given('a message holding a fenced block of several script lines', () => {
      cleanup();
      writeText.mockClear();
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(<Markdown wrap text={'Paste this:\n\n```powershell\n' + SCRIPT + '\n```\n'} />);
    });
    When('Copy is tapped on the block', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    Then("the clipboard holds exactly the block's lines joined by newlines", async () => {
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(SCRIPT);
    });
    And('no line of it ends in a backslash', () => {
      const copied = writeText.mock.calls[0][0] as string;
      expect(copied.split('\n').some((line) => line.endsWith('\\'))).toBe(false);
    });
  });
});
afterAll(() => cleanup());
