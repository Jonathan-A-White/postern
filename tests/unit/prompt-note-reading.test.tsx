// mw-gq6.904: the prompt channel's note never says 'Nothing said here yet' before the prompt list
// has answered; it says it is reading, and shows the empty line only once the list is known.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PromptNote } from '../../src/cockpit/PromptNote';
import type { PromptsState } from '../../src/cockpit/usePrompts';

let state: PromptsState;
vi.mock('../../src/cockpit/usePrompts', () => ({ usePrompts: () => state }));

const retry = () => {};
const top5 = { name: 'top5', summary: 's', signature: [], body: 'List five things.', updatedAt: '2026-10-01T12:00:00Z', updatedBy: '02' };

afterEach(cleanup);

describe('PromptNote before the prompt list has answered', () => {
  it('says it is reading while the phone has not yet read its copy', () => {
    state = { prompts: undefined, at: undefined, fresh: undefined, held: false, retry };
    render(<PromptNote name="top5" read="empty" />);
    expect(screen.queryByText('Nothing said here yet')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
  });

  it('says it is reading while the phone holds no list and the first ask is out', () => {
    state = { prompts: undefined, at: undefined, fresh: undefined, held: true, retry };
    render(<PromptNote name="top5" read="empty" />);
    expect(screen.queryByText('Nothing said here yet')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
  });
});

describe('PromptNote once the prompt list has answered', () => {
  it('shows the empty line when the list is known and holds no such prompt', () => {
    state = { prompts: [], at: 1, fresh: true, held: true, retry };
    render(<PromptNote name="top5" read="empty" />);
    expect(screen.getByText('Nothing said here yet')).toBeInTheDocument();
  });

  it('shows the empty line when the ask failed and the phone holds no list', () => {
    state = { prompts: undefined, at: undefined, fresh: false, held: true, retry };
    render(<PromptNote name="top5" read="empty" />);
    expect(screen.getByText('Nothing said here yet')).toBeInTheDocument();
  });

  it('shows the current body when the prompt is held', () => {
    state = { prompts: [top5], at: 1, fresh: undefined, held: true, retry };
    render(<PromptNote name="top5" read="empty" />);
    expect(screen.getByTestId('prompt-current')).toHaveTextContent('List five things.');
  });
});

// mw-gq6.910: nor before the channel's own thread read has answered; a prompt that is held is shown whatever the read says.
describe('PromptNote while the channel thread read has not answered', () => {
  it.each([
    ['reading', 'Reading this channel'],
    ['unreached', "Can't reach the Mayor yet"],
    ['failed', "Couldn't read this channel on the phone"],
  ] as const)('says %s, never Nothing said here yet, when the list holds no such prompt', (read, words) => {
    state = { prompts: [], at: 1, fresh: true, held: true, retry };
    render(<PromptNote name="top5" read={read} />);
    expect(screen.queryByText('Nothing said here yet')).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(words))).toBeInTheDocument();
  });

  it('shows the prompt body whatever the thread read says', () => {
    state = { prompts: [top5], at: 1, fresh: undefined, held: true, retry };
    render(<PromptNote name="top5" read="reading" />);
    expect(screen.getByTestId('prompt-current')).toHaveTextContent('List five things.');
  });

  it('keeps the prompt-specific empty line once the read has answered', () => {
    state = { prompts: [], at: 1, fresh: true, held: true, retry };
    render(<PromptNote name="top5" read="empty" />);
    expect(screen.getByText('Nothing said here yet')).toBeInTheDocument();
    expect(screen.getByText(/change about \/top5/)).toBeInTheDocument();
  });
});
