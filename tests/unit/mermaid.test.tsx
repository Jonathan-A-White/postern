// tests/unit/mermaid.test.tsx — mw-hy6f4.2: a fenced ```mermaid block routes
// through the Markdown component to a Mermaid component that lazily imports
// the mermaid package on first mount and renders it strict, dark themed.
// mermaid can't draw SVG under jsdom, so the module itself is mocked; these
// tests prove the lazy import happens only when a diagram is on screen, and
// that a render failure shows the source with the error rather than nothing.
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Markdown } from '../../src/markdown';

const { renderMock, initializeMock, factoryMock } = vi.hoisted(() => {
  const renderMock = vi.fn();
  const initializeMock = vi.fn();
  const factoryMock = vi.fn(() => ({
    default: { initialize: initializeMock, render: renderMock },
  }));
  return { renderMock, initializeMock, factoryMock };
});

vi.mock('mermaid', factoryMock);

afterEach(() => {
  cleanup();
});

describe('Mermaid diagrams in Markdown', () => {
  it('never imports mermaid for a message with no mermaid block (AC1)', async () => {
    render(<Markdown text={'plain text and a ```js\nconst x = 1;\n``` block'} />);

    expect(await screen.findByText(/plain text/)).toBeInTheDocument();
    expect(factoryMock).not.toHaveBeenCalled();
  });

  it('mounts Mermaid and calls mermaid.render with the block source for a fenced mermaid block (AC1)', async () => {
    renderMock.mockResolvedValue({ svg: '<svg data-testid="rendered-diagram"></svg>' });
    const source = 'graph TD\n  A --> B';

    render(<Markdown text={'```mermaid\n' + source + '\n```'} />);

    await screen.findByTestId('rendered-diagram');
    expect(initializeMock).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    });
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(renderMock.mock.calls[0][1]).toBe(source);
  });

  it('shows the source and the error message when mermaid.render rejects (AC2)', async () => {
    const source = 'graph TD\n  A -->';
    renderMock.mockRejectedValue(new Error("Parse error on line 2\nExpecting 'SEMI'"));

    render(<Markdown text={'```mermaid\n' + source + '\n```'} />);

    const errorBlock = await screen.findByTestId('mermaid-error');
    expect(errorBlock).toHaveTextContent(source.replace(/\s+/g, ' ').trim());
    expect(errorBlock).toHaveTextContent('Parse error on line 2');
    expect(errorBlock).not.toHaveTextContent("Expecting 'SEMI'");
  });
});
