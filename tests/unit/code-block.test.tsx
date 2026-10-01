// mw-gq6.176: every code block has a one-tap Copy button that copies its exact text.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CodeBlock } from '../../src/ui/CodeBlock';
import { Markdown } from '../../src/markdown';
import { HandsSteps } from '../../src/cockpit/HandsSteps';

const LONG = 'curl -fsSL https://example.org/' + 'a'.repeat(200);
const SOURCE = `${LONG}\nsudo systemctl restart postern\n  indented line`;

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setClipboard(undefined);
  Reflect.deleteProperty(document, 'execCommand');
});

describe('CodeBlock Copy', () => {
  it('copies the exact source text and says Copied for 2 s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<CodeBlock text={SOURCE} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith(SOURCE);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('falls back to a hidden textarea and execCommand when the clipboard API is missing', async () => {
    setClipboard(undefined);
    let copied = '';
    document.execCommand = vi.fn(() => {
      copied = document.querySelector('textarea')?.value ?? '';
      return true;
    });
    render(<CodeBlock text={SOURCE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(copied).toBe(SOURCE);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('says Copy failed when both ways fail', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    document.execCommand = vi.fn(() => false);
    render(<CodeBlock text={SOURCE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });
});

describe('Copy on every code block', () => {
  it('a fenced block in a thread message copies its text without the closing newline', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<Markdown wrap text={'Run:\n\n```\n' + SOURCE + '\n```\n'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(SOURCE);
  });

  it('a hands step command copies its run text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(
      <HandsSteps
        bead="mw-abc.1"
        steps={[{ id: 'linger', host: 'desktop', as: 'root', run: SOURCE, way_back: '', sha256: 'h' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(SOURCE);
  });
});
