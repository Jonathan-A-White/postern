// src/services/micInput.ts — which microphone the Talk line listens on. The browser's
// speech recogniser takes the phone's default input, and over a car's Bluetooth the
// default is the phone's own mic while he speaks to the car's. When a Bluetooth input
// (a hands-free profile, a headset) is among the phone's inputs it is chosen and opened
// here, so the recogniser can be handed its track; with none, nothing is chosen and the
// default microphone is used. Everything fails to a value: a refusal means the default.
// A hold also learns whether the phone has a Bluetooth input at all, a silent one included: on
// Android, Chrome's default microphone is then the Bluetooth one, so the voice recorder must not
// open it beside a recogniser that listens on the phone's own microphone (mw-f7gmps.1).
import type { MicInput } from './listen';

export interface InputDevice {
  deviceId: string;
  label: string;
  kind: string;
}

/** What names a Bluetooth audio input on Android and desktop Chrome: 'Bluetooth headset', 'Galaxy Buds (Bluetooth)'. */
const BLUETOOTH_LABEL = /bluetooth/i;

/** The other names a car's or a headset's Bluetooth link goes by: 'Car kit (hands-free)', 'HFP', 'SCO'. A bare 'headset' is not enough. */
const HANDS_FREE_LABEL = /hands[- ]?free|\bhfp\b|\bsco\b|\bcar\b/i;

/** Android's own inputs ('Headset earpiece', 'Speakerphone'): the phone's, never a Bluetooth device, and they hear nothing when opened by id. */
const BUILT_IN_LABEL = /earpiece|speaker/i;

/** The pseudo-inputs the browser adds for 'whatever the system default is'; they name no real device. */
const PSEUDO_IDS = new Set(['default', 'communications']);

/** Inputs that were chosen and heard nothing (earbuds whose hands-free microphone is not routed): not chosen again for the life of the page. */
const silentInputs = new Set<string>();

/** Lets every silent input be chosen again (for tests; a page reload does the same). */
export function forgetSilentInputs(): void {
  silentInputs.clear();
}

/** The real inputs that could be a Bluetooth device: not an output, a pseudo-input or one of the phone's own. */
function possibleInputs(devices: readonly InputDevice[]): InputDevice[] {
  return devices.filter((device) => device.kind === 'audioinput' && !PSEUDO_IDS.has(device.deviceId) && !BUILT_IN_LABEL.test(device.label));
}

const isBluetooth = (device: InputDevice) => BLUETOOTH_LABEL.test(device.label) || HANDS_FREE_LABEL.test(device.label);

/** The Bluetooth input to listen on, or nothing when the phone has none (the default microphone is then used). */
export function chooseInput(devices: readonly InputDevice[]): InputDevice | undefined {
  const candidates = possibleInputs(devices).filter((device) => !silentInputs.has(device.deviceId));
  return candidates.find((device) => BLUETOOTH_LABEL.test(device.label)) ?? candidates.find((device) => HANDS_FREE_LABEL.test(device.label));
}

/** True once the browser names its inputs, which it does only after the microphone was allowed. */
function hasLabels(devices: readonly InputDevice[]): boolean {
  return devices.some((device) => device.kind === 'audioinput' && device.label !== '');
}

function inputFor(stream: MediaStream, label: string, deviceId: string): MicInput | undefined {
  const track = stream.getAudioTracks()[0];
  if (!track) return undefined;
  return {
    label: track.label || label,
    track,
    deviceId,
    silent: () => silentInputs.add(deviceId),
    close: () => stream.getTracks().forEach((each) => each.stop()),
  };
}

/** True when the browser can list and open inputs; without it the hold starts at once on the default microphone. */
export function canChooseInput(): boolean {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  return !!media?.enumerateDevices && !!media.getUserMedia;
}

/** What a hold opened: the Bluetooth input to listen on, if any, and whether the phone lists a Bluetooth input at all (a silent one too). */
export interface HoldInput {
  input?: MicInput;
  bluetooth: boolean;
}

/** Opens the Bluetooth input if the phone has one, and says whether it has any. Never throws. */
export async function openHoldInput(): Promise<HoldInput> {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!media?.enumerateDevices || !media.getUserMedia) return { input: undefined, bluetooth: false };
  let bluetooth = false;
  try {
    let devices = await media.enumerateDevices();
    if (!hasLabels(devices)) {
      // Names come only once the microphone is allowed: take the permission with a brief look at the default input.
      (await media.getUserMedia({ audio: true })).getTracks().forEach((each) => each.stop());
      devices = await media.enumerateDevices();
    }
    bluetooth = possibleInputs(devices).some(isBluetooth);
    const chosen = chooseInput(devices);
    if (!chosen) return { input: undefined, bluetooth };
    return { input: inputFor(await media.getUserMedia({ audio: { deviceId: { exact: chosen.deviceId } } }), chosen.label, chosen.deviceId), bluetooth };
  } catch {
    return { input: undefined, bluetooth };
  }
}

/** Opens the Bluetooth input if the phone has one; nothing means the default microphone. Never throws. */
export async function openBluetoothInput(): Promise<MicInput | undefined> {
  return (await openHoldInput()).input;
}
