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
    render(<PromptNote name="top5" />);
    expect(screen.queryByText('Nothing said here yet')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
  });

  it('says it is reading while the phone holds no list and the first ask is out', () => {
    state = { prompts: undefined, at: undefined, fresh: undefined, held: true, retry };
    render(<PromptNote name="top5" />);
    expect(screen.queryByText('Nothing said here yet')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
  });
});

describe('PromptNote once the prompt list has answered', () => {
  it('shows the empty line when the list is known and holds no such prompt', () => {
    state = { prompts: [], at: 1, fresh: true, held: true, retry };
    render(<PromptNote name="top5" />);
    expect(screen.getByText('Nothing said here yet')).toBeInTheDocument();
  });

  it('shows the empty line when the ask failed and the phone holds no list', () => {
    state = { prompts: undefined, at: undefined, fresh: false, held: true, retry };
    render(<PromptNote name="top5" />);
    expect(screen.getByText('Nothing said here yet')).toBeInTheDocument();
  });

  it('shows the current body when the prompt is held', () => {
    state = { prompts: [top5], at: 1, fresh: undefined, held: true, retry };
    render(<PromptNote name="top5" />);
    expect(screen.getByTestId('prompt-current')).toHaveTextContent('List five things.');
  });
});
