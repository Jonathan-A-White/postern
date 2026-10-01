// features/steps/code-copy.steps.tsx — runs features/code-copy.feature.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { CodeBlock } from '../../src/ui/CodeBlock';

const SOURCE = 'git pull\nnpm ci && npm run build';
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
});
afterAll(() => cleanup());
