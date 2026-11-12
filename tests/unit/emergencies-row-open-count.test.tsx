// mw-mr4xgrw.54: Home's red 'Emergencies · N' row counts the emergencies still open (above the cleared mark),
// not every one the phone has stored; the Emergency screen still lists them all.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { EmergencyScreen } from '../../src/cockpit/EmergencyScreen';
import { forgetLastKnown } from '../../src/cockpit/lastKnown';
import { db } from '../../src/data/db';
import { eventsRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../support/cockpit-fixture';

async function hold(seqs: number[]): Promise<void> {
  await eventsRepo.addNew(
    seqs.map((seq) => ({ seq, ts: new Date().toISOString(), kind: 'alarm', bead: '', actor: 'doctor@desktop', from: 'running', to: 'failed', detail: `alarm ${seq}`, lane: 'emergency' })),
  );
}

const row = () => screen.queryByRole('button', { name: /Emergencies/ });

beforeEach(async () => {
  cleanup();
  forgetLastKnown();
  await Promise.all([db.settings.clear(), db.view.clear(), db.events.clear()]);
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  window.history.replaceState(null, '', '/?v=needs');
});

afterEach(() => cleanup());

describe('the Emergencies row on Home', () => {
  it('counts only the emergencies above the cleared mark', async () => {
    await hold([5, 8, 12]);
    await eventsRepo.clearEmergency(8);
    render(<NeedsScreen />);
    expect(await screen.findByRole('button', { name: /Emergencies · 1/ })).toBeInTheDocument();
  });

  it('is not drawn when the mark is at the newest emergency or above', async () => {
    await hold([5, 8, 12]);
    await eventsRepo.clearEmergency(12);
    render(<NeedsScreen />);
    await screen.findByRole('heading', { name: 'Needs you' });
    await act(async () => { await eventsRepo.emergencyCount(); });
    expect(row()).toBeNull();
  });

  it('counts all three with the mark at 0', async () => {
    await hold([5, 8, 12]);
    render(<NeedsScreen />);
    expect(await screen.findByRole('button', { name: /Emergencies · 3/ })).toBeInTheDocument();
  });

  it('drops to nothing in the same session when he taps clear or a clears event arrives', async () => {
    await hold([5, 8, 12]);
    render(<NeedsScreen />);
    await screen.findByRole('button', { name: /Emergencies · 3/ });
    await act(async () => { await eventsRepo.clearEmergency(12); });
    await waitFor(() => expect(row()).toBeNull());
  });

  it('counts the open ones: emergencyCount is the number above the mark', async () => {
    await hold([5, 8, 12]);
    expect(await eventsRepo.emergencyCount()).toBe(3);
    await eventsRepo.clearEmergency(8);
    expect(await eventsRepo.emergencyCount()).toBe(1);
    await eventsRepo.clearEmergency(12);
    expect(await eventsRepo.emergencyCount()).toBe(0);
  });
});

describe('the Emergency screen', () => {
  it('still lists every stored emergency, cleared ones too', async () => {
    await hold([5, 8, 12]);
    await eventsRepo.clearEmergency(12);
    expect((await eventsRepo.recentEmergencies(20)).map((e) => e.seq)).toEqual([12, 8, 5]);
    window.history.replaceState(null, '', '/?v=emergency');
    render(<EmergencyScreen />);
    for (const seq of [5, 8, 12]) expect(await screen.findByText(new RegExp(`alarm ${seq}`))).toBeInTheDocument();
  });
});
