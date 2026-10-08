// mw-xhtcup.12: Me's Notifications block. 'Turn on' subscribes this phone through the push service with its own
// key and says 'Notifications are on'; when the subscription fails the reason shows as an error toast and the
// button stays for another try. Its old guard went with the Inbox/Settings screens (the Gate's 'Notify me' tests).
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Utils } from '@bsv/sdk';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { db } from '../../src/data/db';
import { lock, setKey } from '../../src/services/keySession';
import { publicKeyHexFromMasterKey } from '../../src/services/vault';
import * as push from '../../src/services/push';
import { currentToasts, dismissAllToasts } from '../../src/ui/toastStore';

const KEY = new Uint8Array(Utils.toArray('33'.repeat(32), 'hex'));

beforeEach(async () => {
  await Promise.all([db.settings.clear(), db.view.clear()]);
  dismissAllToasts();
  vi.spyOn(push, 'pushSupported').mockReturnValue(true);
  vi.spyOn(push, 'isPushSubscribed').mockResolvedValue(false);
  setKey(KEY);
});
afterEach(() => {
  cleanup();
  lock();
  dismissAllToasts();
  vi.restoreAllMocks();
});
afterAll(() => cleanup());

const turnOn = () => screen.findByRole('button', { name: 'Turn on' });

describe('Me, Notifications: Turn on', () => {
  it('subscribes this phone with its own key, then shows On and a "Notifications are on" toast', async () => {
    const subscribe = vi.spyOn(push, 'subscribeToPush').mockResolvedValue(undefined);
    vi.spyOn(push, 'rememberPushSubscribed').mockResolvedValue(undefined);
    render(<MeScreen />);

    await userEvent.click(await turnOn());

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    expect(subscribe).toHaveBeenCalledWith({ publicKeyHex: publicKeyHexFromMasterKey(KEY), unlockedKey: KEY });
    await waitFor(() => expect(currentToasts().map((t) => t.text)).toContain('Notifications are on'));
    expect(currentToasts().find((t) => t.text === 'Notifications are on')?.tone).toBe('ok');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull());
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('shows the reason as an error toast when subscribing fails, and keeps Turn on for another try', async () => {
    const subscribe = vi.spyOn(push, 'subscribeToPush').mockRejectedValue(new Error('Notification permission was not granted.'));
    const remember = vi.spyOn(push, 'rememberPushSubscribed').mockResolvedValue(undefined);
    render(<MeScreen />);

    await userEvent.click(await turnOn());

    await waitFor(() => expect(currentToasts().map((t) => t.text)).toContain('Notification permission was not granted.'));
    expect(currentToasts().find((t) => t.text === 'Notification permission was not granted.')?.tone).toBe('error');
    expect(currentToasts().map((t) => t.text)).not.toContain('Notifications are on');
    expect(remember).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled());
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('is disabled while the key is locked, so a tap cannot subscribe without it', async () => {
    const subscribe = vi.spyOn(push, 'subscribeToPush').mockResolvedValue(undefined);
    lock();
    render(<MeScreen />);

    expect(await turnOn()).toBeDisabled();
    expect(subscribe).not.toHaveBeenCalled();
  });
});
