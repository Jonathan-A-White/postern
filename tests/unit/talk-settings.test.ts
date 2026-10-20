// tests/unit/talk-settings.test.ts — mw-06ggew.6: Me > Talk keeps two choices on the device (localStorage):
// Talk (Hold or Tap) and Send (On release or By button). Hold and On release until he changes them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POSTERN_COMPOSER_SETTINGS } from '../../src/cockpit/holdBar';
import { composerSettingsOf, keepTalkSettings, onTalkSettings, readTalkSettings } from '../../src/cockpit/talkSettings';

beforeEach(() => localStorage.clear());

describe('the Talk settings kept on the device', () => {
  it('are Hold and On release until he changes them', () => {
    expect(readTalkSettings()).toEqual({ talk: 'hold', send: 'release' });
  });

  it('round trip: what is kept is what is read again', () => {
    keepTalkSettings({ talk: 'tap', send: 'button' });
    expect(readTalkSettings()).toEqual({ talk: 'tap', send: 'button' });
    keepTalkSettings({ talk: 'hold', send: 'button' });
    expect(readTalkSettings()).toEqual({ talk: 'hold', send: 'button' });
  });

  it('read garbage or an unknown value as the default for that choice', () => {
    localStorage.setItem('postern.talk', 'not json');
    expect(readTalkSettings()).toEqual({ talk: 'hold', send: 'release' });
    localStorage.setItem('postern.talk', JSON.stringify({ talk: 'off', send: 'button' }));
    expect(readTalkSettings()).toEqual({ talk: 'hold', send: 'button' });
  });

  it('tell a listener at once when kept', () => {
    const heard = vi.fn();
    const stop = onTalkSettings(heard);
    keepTalkSettings({ talk: 'tap', send: 'release' });
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    keepTalkSettings({ talk: 'hold', send: 'release' });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("go into the bar's settings over the app's own: attach, camera, voice note and typing stay on", () => {
    expect(composerSettingsOf({ talk: 'tap', send: 'button' })).toEqual({ ...POSTERN_COMPOSER_SETTINGS, talk: 'tap', send: 'button' });
    expect(composerSettingsOf({ talk: 'hold', send: 'release' })).toEqual(POSTERN_COMPOSER_SETTINGS);
  });
});
