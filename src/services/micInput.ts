// src/services/micInput.ts — which microphone the Talk line listens on. The browser's
// speech recogniser takes the phone's default input, and over a car's Bluetooth the
// default is the phone's own mic while he speaks to the car's. When a Bluetooth input
// (a hands-free profile, a headset) is among the phone's inputs it is chosen and opened
// here, so the recogniser can be handed its track; with none, nothing is chosen and the
// default microphone is used. Everything fails to a value: a refusal means the default.
import type { MicInput } from './listen';

export interface InputDevice {
  deviceId: string;
  label: string;
  kind: string;
}

/** What names a Bluetooth audio input on Android and desktop Chrome: 'Bluetooth headset', 'Car kit (hands-free)', 'HFP', 'SCO'. */
const BLUETOOTH_LABEL = /bluetooth|hands[- ]?free|\bhfp\b|\bsco\b|\bheadset\b|\bcar\b/i;

/** The pseudo-inputs the browser adds for 'whatever the system default is'; they name no real device. */
const PSEUDO_IDS = new Set(['default', 'communications']);

/** The Bluetooth input to listen on, or nothing when the phone has none (the default microphone is then used). */
export function chooseInput(devices: readonly InputDevice[]): InputDevice | undefined {
  return devices.find((device) => device.kind === 'audioinput' && !PSEUDO_IDS.has(device.deviceId) && BLUETOOTH_LABEL.test(device.label));
}

/** True once the browser names its inputs, which it does only after the microphone was allowed. */
function hasLabels(devices: readonly InputDevice[]): boolean {
  return devices.some((device) => device.kind === 'audioinput' && device.label !== '');
}

function inputFor(stream: MediaStream, label: string): MicInput | undefined {
  const track = stream.getAudioTracks()[0];
  if (!track) return undefined;
  return {
    label: track.label || label,
    track,
    close: () => stream.getTracks().forEach((each) => each.stop()),
  };
}

/** True when the browser can list and open inputs; without it the hold starts at once on the default microphone. */
export function canChooseInput(): boolean {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  return !!media?.enumerateDevices && !!media.getUserMedia;
}

/** Opens the Bluetooth input if the phone has one; nothing means the default microphone. Never throws. */
export async function openBluetoothInput(): Promise<MicInput | undefined> {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!media?.enumerateDevices || !media.getUserMedia) return undefined;
  try {
    let devices = await media.enumerateDevices();
    if (!hasLabels(devices)) {
      // Names come only once the microphone is allowed: take the permission with a brief look at the default input.
      (await media.getUserMedia({ audio: true })).getTracks().forEach((each) => each.stop());
      devices = await media.enumerateDevices();
    }
    const chosen = chooseInput(devices);
    if (!chosen) return undefined;
    return inputFor(await media.getUserMedia({ audio: { deviceId: { exact: chosen.deviceId } } }), chosen.label);
  } catch {
    return undefined;
  }
}
