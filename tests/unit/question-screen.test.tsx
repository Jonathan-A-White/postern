// tests/unit/question-screen.test.tsx — mw-tfne4.39: the Sent line's txid must
// break the same way Compose's does (mw-tfne4.34's fix missed this screen), and
// the send status (Sending…/Sent/error) must land right under the option
// buttons, not below the free-text box where a tap gives no visible feedback.
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QuestionScreen } from '../../src/projects/QuestionScreen';
import { db } from '../../src/data/db';
import { sendTextMessage } from '../../src/services/send';
import type { QuestionBody } from '../../src/services/questions';

vi.mock('../../src/services/send', () => ({
  sendTextMessage: vi.fn(),
}));

const question: QuestionBody = {
  bead: 'mw-epic.1',
  q: 'Ship now?',
  rec: 'ship',
  options: ['ship', 'wait'],
};

function sentBefore(sentLine: HTMLElement): boolean {
  const label = screen.getByText('Your own answer');
  return Boolean(sentLine.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING);
}

afterEach(async () => {
  cleanup();
  await db.answers.clear();
  vi.clearAllMocks();
});

describe('QuestionScreen: send status placement and txid wrapping (mw-tfne4.39)', () => {
  it('shows the Sent line with break-all font-mono classes, above "Your own answer"', async () => {
    const txid = 'c'.repeat(64);
    vi.mocked(sendTextMessage).mockResolvedValue(txid);

    render(
      <QuestionScreen question={question} unlockedKey={new Uint8Array(32)} recipientPublicKeyHex={'02'.repeat(33)} />,
    );

    await userEvent.click(screen.getByTestId('option-ship'));

    const sentLine = await screen.findByText(`Sent. Transaction id: ${txid}`);
    expect(sentLine.className).toContain('break-all');
    expect(sentLine.className).toContain('font-mono');
    expect(sentBefore(sentLine)).toBe(true);
  });

  it('shows the error line above "Your own answer" too', async () => {
    vi.mocked(sendTextMessage).mockRejectedValue(new Error('boom'));

    render(
      <QuestionScreen question={question} unlockedKey={new Uint8Array(32)} recipientPublicKeyHex={'02'.repeat(33)} />,
    );

    await userEvent.click(screen.getByTestId('option-ship'));

    const errorLine = await screen.findByRole('alert');
    expect(sentBefore(errorLine)).toBe(true);
  });
});
