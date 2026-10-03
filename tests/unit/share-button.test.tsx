// mw-gq6.252: Share's edges: backing out of the sheet is quiet; a sheet that fails falls back to Copy.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareButton } from '../../src/cockpit/ShareButton';

const writeText = vi.fn().mockResolvedValue(undefined);

function phone(share: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
}

afterEach(() => {
  cleanup();
  writeText.mockClear();
});

describe('ShareButton', () => {
  it('says Share and, with a share sheet, gives it the title and text without copying', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    phone(share);
    render(<ShareButton title="Postern: Factory" text="hello" />);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({ title: 'Postern: Factory', text: 'hello' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does nothing more when he backs out of the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    phone(share);
    render(<ShareButton title="t" text="hello" />);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('copies and says Copied when the share sheet fails', async () => {
    phone(vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError')));
    render(<ShareButton title="t" text="hello" />);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('copies when canShare refuses the text', async () => {
    const share = vi.fn();
    phone(share);
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    render(<ShareButton title="t" text="hello" />);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
});
