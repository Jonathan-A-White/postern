// mw-yxwtth.1: a worker waiting behind the one in control shows 'Update ready, tap to reload'; the tap
// tells it to take over (SKIP_WAITING) and the page reloads once when it has; the app looks for an
// update on start, on return to the foreground and every 30 minutes.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { startAppUpdates, TAKE_OVER_PATIENCE_MS, UPDATE_CHECK_EVERY_MS } from 'pwa-kit/app-update';
import { UpdateBanner } from '../../src/cockpit/UpdateBanner';
import { fakeSetup, fakeWorker, type FakeSetup } from '../support/fake-registration';

afterAll(() => cleanup());

let stop: (() => void) | undefined;

function start(setup: FakeSetup) {
  const updates = startAppUpdates({ container: setup.container, registration: setup.registration, reload: setup.reload });
  stop = updates.stop;
  return updates;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop?.();
  stop = undefined;
  cleanup();
  vi.useRealTimers();
});

describe('the update banner', () => {
  it('is hidden when no worker is waiting', () => {
    start(fakeSetup());
    render(<UpdateBanner />);
    expect(screen.queryByText('Update ready, tap to reload')).toBeNull();
  });

  it('shows when a worker is already waiting at start', () => {
    start(fakeSetup({ waiting: fakeWorker() }));
    render(<UpdateBanner />);
    expect(screen.getByRole('button', { name: 'Update ready, tap to reload' })).toBeEnabled();
  });

  it('shows once a newly found worker has installed and waits', () => {
    const setup = fakeSetup();
    start(setup);
    render(<UpdateBanner />);
    expect(screen.queryByText('Update ready, tap to reload')).toBeNull();
    act(() => void setup.newWorkerWaits());
    expect(screen.getByRole('button', { name: 'Update ready, tap to reload' })).toBeInTheDocument();
  });

  it('does not show for the very first worker, which has nothing to wait behind', () => {
    const setup = fakeSetup({ controlled: false });
    start(setup);
    render(<UpdateBanner />);
    act(() => void setup.newWorkerWaits());
    expect(screen.queryByText('Update ready, tap to reload')).toBeNull();
  });

  it('a tap posts SKIP_WAITING to the waiting worker, goes dead saying what is happening, and does not reload yet', () => {
    const waiting = fakeWorker();
    const setup = fakeSetup({ waiting });
    start(setup);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Update ready, tap to reload' }));
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(setup.reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Updating…' }));
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  it('reloads exactly once when the new worker takes control, however many times the controller changes', () => {
    const setup = fakeSetup({ waiting: fakeWorker() });
    start(setup);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Update ready, tap to reload' }));
    act(() => {
      setup.controllerChanges();
      setup.controllerChanges();
    });
    expect(setup.reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads on a controller change he did not ask for (a first install claiming the page)', () => {
    const setup = fakeSetup();
    start(setup);
    setup.controllerChanges();
    expect(setup.reload).not.toHaveBeenCalled();
  });

  it('reloads anyway, once, when the new worker has not taken over within the patience, while a worker still waits', () => {
    const waiting = fakeWorker();
    const setup = fakeSetup({ waiting });
    start(setup);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Update ready, tap to reload' }));
    act(() => void vi.advanceTimersByTime(TAKE_OVER_PATIENCE_MS - 1));
    expect(setup.reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    act(() => void vi.advanceTimersByTime(1));
    expect(setup.reload).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(setup.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when the waiting worker is gone but the controller never changed', () => {
    const setup = fakeSetup({ waiting: fakeWorker() });
    start(setup);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Update ready, tap to reload' }));
    setup.registration.waiting = null;
    act(() => void vi.advanceTimersByTime(TAKE_OVER_PATIENCE_MS));
    expect(setup.reload).toHaveBeenCalledTimes(1);
  });

  it('a controller change within the patience reloads once and the patience then adds no second reload', () => {
    const setup = fakeSetup({ waiting: fakeWorker() });
    start(setup);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Update ready, tap to reload' }));
    act(() => void vi.advanceTimersByTime(TAKE_OVER_PATIENCE_MS - 1000));
    act(() => setup.controllerChanges());
    expect(setup.reload).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(setup.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads on return to the foreground when the tab slept past the patience with its timer unfired', () => {
    const setup = fakeSetup({ waiting: fakeWorker() });
    start(setup);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Update ready, tap to reload' }));
    vi.setSystemTime(Date.now() + TAKE_OVER_PATIENCE_MS + 1);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(setup.reload).toHaveBeenCalledTimes(1);
  });
});

describe('looking for an update', () => {
  it('asks the registration on start', () => {
    const setup = fakeSetup();
    start(setup);
    expect(setup.registration.update).toHaveBeenCalledTimes(1);
  });

  it('asks again when the app comes back to the foreground, not when it goes away', () => {
    const setup = fakeSetup();
    start(setup);
    setup.registration.update.mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setup.registration.update).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setup.registration.update).toHaveBeenCalledTimes(1);
  });

  it('asks every 30 minutes', () => {
    const setup = fakeSetup();
    start(setup);
    setup.registration.update.mockClear();
    expect(UPDATE_CHECK_EVERY_MS).toBe(30 * 60_000);
    vi.advanceTimersByTime(UPDATE_CHECK_EVERY_MS * 2);
    expect(setup.registration.update).toHaveBeenCalledTimes(2);
  });

  it('survives a check that fails (offline) and goes on asking', async () => {
    const setup = fakeSetup();
    setup.registration.update.mockRejectedValue(new Error('offline'));
    start(setup);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS);
    expect(setup.registration.update).toHaveBeenCalledTimes(2);
  });

  it('stops asking once stopped', () => {
    const setup = fakeSetup();
    const updates = start(setup);
    updates.stop();
    setup.registration.update.mockClear();
    vi.advanceTimersByTime(UPDATE_CHECK_EVERY_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setup.registration.update).not.toHaveBeenCalled();
  });
});
