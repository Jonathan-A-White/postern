// features/steps/diagrams.steps.tsx — runs features/diagrams.feature under
// vitest via @amiceli/vitest-cucumber. mermaid can't draw SVG under jsdom, so
// the module is mocked here the same way tests/unit/mermaid.test.tsx does.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Markdown } from '../../src/markdown';

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: renderMock },
}));

const SOURCE = 'graph TD\n  A --> B';

const feature = await loadFeature('features/diagrams.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-4a: a message with a diagram shows the diagram', ({ Given, When, Then }) => {
    Given('a message with a fenced mermaid block whose diagram draws cleanly', () => {
      cleanup();
      renderMock.mockResolvedValue({ svg: '<svg data-testid="rendered-diagram"></svg>' });
    });

    When('the message is rendered', () => {
      render(<Markdown text={'```mermaid\n' + SOURCE + '\n```'} />);
    });

    Then('the diagram is shown', async () => {
      expect(await screen.findByTestId('rendered-diagram')).toBeInTheDocument();
    });
  });

  Scenario('AC-4b: a message with a broken diagram shows its text and the error', ({ Given, When, Then, And }) => {
    Given('a message with a fenced mermaid block whose diagram fails to draw', () => {
      cleanup();
      renderMock.mockRejectedValue(new Error('Parse error on line 2'));
    });

    When('the message is rendered', () => {
      render(<Markdown text={'```mermaid\n' + SOURCE + '\n```'} />);
    });

    Then("the block's source text is shown", async () => {
      const errorBlock = await screen.findByTestId('mermaid-error');
      expect(errorBlock).toHaveTextContent(SOURCE.replace(/\s+/g, ' ').trim());
    });

    And('the error is shown', () => {
      expect(screen.getByTestId('mermaid-error')).toHaveTextContent('Parse error on line 2');
    });
  });
});

afterAll(() => {
  cleanup();
});
