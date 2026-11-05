import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import type userEvent from '@testing-library/user-event';

/**
 * Click a button once it is enabled. findBy returns a button as soon as it is drawn, and a button drawn
 * disabled (busy, or waiting on a read) has user-event drop the click without a word, so the next wait
 * runs out (mw-gq6.985; the same flake as Trade Tracker's mw-mr4xgrw.43).
 */
export async function clickWhenEnabled(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}
