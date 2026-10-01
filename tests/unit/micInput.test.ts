import { describe, it, expect, afterEach, vi } from 'vitest';
import { canChooseInput, chooseInput, openBluetoothInput, type InputDevice } from '../../src/services/micInput';

const input = (deviceId: string, label: string, kind = 'audioinput'): InputDevice => ({ deviceId, label, kind });

describe('chooseInput', () => {
  it('chooses a Bluetooth headset input when one is present', () => {
    const devices = [input('phone', 'Phone microphone'), input('bt', 'Bluetooth headset'), input('ear', 'Headset earpiece', 'audiooutput')];
    expect(chooseInput(devices)?.deviceId).toBe('bt');
  });

  it("recognises a car's hands-free input by its name", () => {
    expect(chooseInput([input('a', 'Speakerphone'), input('b', 'Car kit (hands-free)')])?.deviceId).toBe('b');
    expect(chooseInput([input('a', 'Speakerphone'), input('b', 'Toyota HFP')])?.deviceId).toBe('b');
  });

  it('chooses nothing when the phone has only its own inputs', () => {
    expect(chooseInput([input('a', 'Speakerphone'), input('b', 'Phone microphone')])).toBeUndefined();
    expect(chooseInput([])).toBeUndefined();
  });

  it("never takes Android's own inputs for a Bluetooth one", () => {
    expect(chooseInput([input('e1f2', 'Headset earpiece'), input('s3a4', 'Speakerphone')])).toBeUndefined();
    expect(chooseInput([input('a', 'Headset')])).toBeUndefined();
  });

  it('still chooses the Bluetooth input when the earpiece is listed first', () => {
    expect(chooseInput([input('e1f2', 'Headset earpiece'), input('b', 'Bluetooth headset')])?.deviceId).toBe('b');
    expect(chooseInput([input('s3a4', 'Speakerphone'), input('c', 'Car kit (hands-free)')])?.deviceId).toBe('c');
    expect(chooseInput([input('e1f2', 'Headset earpiece'), input('s3a4', 'Speakerphone'), input('buds', 'Galaxy Buds2 Pro (Bluetooth)')])?.deviceId).toBe('buds');
  });

  it('prefers an input that names Bluetooth over a hands-free or car one', () => {
    expect(chooseInput([input('c', 'Car kit (hands-free)'), input('b', 'Bluetooth headset')])?.deviceId).toBe('b');
  });

  it("ignores outputs and the browser's pseudo-inputs", () => {
    const devices = [input('default', 'Default - Bluetooth headset'), input('communications', 'Communications - Bluetooth headset'), input('out', 'Bluetooth headset', 'audiooutput')];
    expect(chooseInput(devices)).toBeUndefined();
  });
});

describe('openBluetoothInput', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
  });

  function media(devices: InputDevice[], opts: { unlabelled?: InputDevice[]; refuse?: boolean } = {}) {
    const stop = vi.fn();
    let allowed = !opts.unlabelled;
    const getUserMedia = vi.fn((constraints: { audio: unknown }) => {
      if (opts.refuse && typeof constraints.audio === 'object') return Promise.reject(new Error('NotFoundError'));
      allowed = true;
      const track = { label: 'Bluetooth headset (track)', stop };
      return Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] });
    });
    const enumerateDevices = vi.fn(() => Promise.resolve(allowed ? devices : (opts.unlabelled ?? devices)));
    Object.defineProperty(navigator, 'mediaDevices', { value: { enumerateDevices, getUserMedia }, configurable: true, writable: true });
    return { getUserMedia, stop };
  }

  it('opens the Bluetooth input by its device id and lets it go on close', async () => {
    const { getUserMedia, stop } = media([input('phone', 'Phone microphone'), input('bt', 'Bluetooth headset')]);
    const opened = await openBluetoothInput();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'bt' } } });
    expect(opened?.label).toBe('Bluetooth headset (track)');
    opened?.close();
    expect(stop).toHaveBeenCalled();
  });

  it('takes the microphone permission first when the inputs have no names yet', async () => {
    const { getUserMedia } = media([input('bt', 'Bluetooth headset')], { unlabelled: [input('bt', '')] });
    const opened = await openBluetoothInput();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0]).toEqual({ audio: true });
    expect(opened).toBeDefined();
  });

  it('gives nothing, so the default microphone is used, with no Bluetooth input, a refusal, or no device API', async () => {
    media([input('phone', 'Phone microphone')]);
    expect(await openBluetoothInput()).toBeUndefined();
    media([input('bt', 'Bluetooth headset')], { refuse: true });
    expect(await openBluetoothInput()).toBeUndefined();
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
    expect(await openBluetoothInput()).toBeUndefined();
    expect(canChooseInput()).toBe(false);
  });
});
