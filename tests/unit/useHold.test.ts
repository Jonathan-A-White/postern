// tests/unit/useHold.test.ts — the voice recorder in a hold (mw-f7gmps.1): it records from the
// microphone the recogniser listens on and never opens another, so it cannot take the phone's
// Bluetooth route away from the recogniser. The recogniser, the phone's inputs and MediaRecorder
// are doubles; the hold, listen.ts, micInput.ts and recorder.ts are the real ones.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useHold } from '../../src/cockpit/useHold';
import { INPUT_SILENT_MS } from '../../src/services/listen';
import { forgetSilentInputs } from '../../src/services/micInput';

interface FakeTrack {
  label: string;
  /** The device the track was opened on, or 'default'. */
  device: string;
  copy: boolean;
  stop: ReturnType<typeof vi.fn>;
  clone(): FakeTrack;
}

function track(device: string, label: string, copy = false): FakeTrack {
  const made: FakeTrack = {
    label,
    device,
    copy,
    stop: vi.fn(),
    clone: () => {
      const twin = track(device, label, true);
      tracks.push(twin);
      return twin;
    },
  };
  return made;
}

let tracks: FakeTrack[] = [];
let recognizers: Recognizer[] = [];
let recorders: { stream: { getTracks(): FakeTrack[] } }[] = [];
type Constraints = { audio: { deviceId?: { exact: string } } | boolean };
const getUserMedia = vi.fn<(constraints: Constraints) => Promise<FakeMediaStream>>();

class Recognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally = false;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onresult: ((event: { results: unknown[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  startedWith: FakeTrack | undefined | null = null;
  start(on?: FakeTrack) {
    this.startedWith = on;
    recognizers.push(this);
    queueMicrotask(() => this.onaudiostart?.());
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {}
  hear(text: string) {
    this.onresult?.({ results: [[{ transcript: text }]] });
  }
}

class FakeMediaStream {
  private readonly held: FakeTrack[];
  constructor(held: FakeTrack[]) {
    this.held = held;
  }
  getTracks() {
    return this.held;
  }
  getAudioTracks() {
    return this.held;
  }
}

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly stream: FakeMediaStream;
  constructor(stream: FakeMediaStream) {
    this.stream = stream;
    recorders.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function phoneHas(inputs: { deviceId: string; label: string }[]): void {
  getUserMedia.mockImplementation((constraints) => {
    const wanted = typeof constraints.audio === 'object' ? constraints.audio.deviceId?.exact : undefined;
    const opened = track(wanted ?? 'default', inputs.find((input) => input.deviceId === wanted)?.label ?? 'default');
    tracks.push(opened);
    return Promise.resolve(new FakeMediaStream([opened]));
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { enumerateDevices: () => Promise.resolve(inputs.map((input) => ({ ...input, kind: 'audioinput' }))), getUserMedia },
    configurable: true,
    writable: true,
  });
}

const EARBUDS = [
  { deviceId: 'phone', label: 'Phone microphone' },
  { deviceId: 'buds', label: 'Bluetooth headset' },
];

/** Lets the hold's promises and the recogniser's microtasks run, and the fake clock move on by `ms`. */
const pass = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

/** The devices a getUserMedia call asked for, in order: an id, or 'default'. */
const devicesOpened = () =>
  getUserMedia.mock.calls.map(([constraints]) =>
    typeof constraints.audio === 'object' && constraints.audio.deviceId ? constraints.audio.deviceId.exact : 'default',
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  tracks = [];
  recognizers = [];
  recorders = [];
  getUserMedia.mockReset();
  forgetSilentInputs();
  vi.stubGlobal('SpeechRecognition', Recognizer);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
});

describe('the voice recorder in a hold with a chosen input (mw-f7gmps.1)', () => {
  it("records a copy of the recogniser's own track and opens no other microphone", async () => {
    phoneHas(EARBUDS);
    const { result } = renderHook(() => useHold({ record: true }));
    act(() => {
      result.current.begin();
    });
    await pass();
    expect(recognizers.at(-1)?.startedWith?.device).toBe('buds');
    expect(devicesOpened()).toEqual(['buds']);
    expect(recorders).toHaveLength(1);
    const recorded = recorders[0].stream.getTracks();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ device: 'buds', copy: true });
  });

  it('lets the recording go with the silent input, opens nothing else, and the words still come back', async () => {
    phoneHas(EARBUDS);
    const { result } = renderHook(() => useHold({ record: true }));
    act(() => {
      result.current.begin();
    });
    await pass();
    expect(result.current.input).toBe('Bluetooth headset');
    await pass(INPUT_SILENT_MS);
    expect(recognizers.at(-1)?.startedWith).toBeUndefined();
    expect(result.current.input).toBeUndefined();
    // every capture of the earbuds is closed, the recogniser's and the recorder's copy alike
    expect(tracks.every((each) => each.stop.mock.calls.length > 0)).toBe(true);
    expect(devicesOpened()).toEqual(['buds']);
    expect(recorders).toHaveLength(1);
    act(() => recognizers.at(-1)?.hear('check the build'));
    let released: Awaited<ReturnType<typeof result.current.finish>> | undefined;
    await act(async () => {
      const finishing = result.current.finish();
      await vi.advanceTimersByTimeAsync(0);
      released = await finishing;
    });
    expect(released).toEqual({ status: 'heard', text: 'check the build', recording: undefined });
    expect(devicesOpened()).toEqual(['buds']);
  });

  it('opens no microphone at all on the next hold, which starts on the default microphone at once', async () => {
    phoneHas(EARBUDS);
    const { result } = renderHook(() => useHold({ record: true }));
    act(() => {
      result.current.begin();
    });
    await pass();
    await pass(INPUT_SILENT_MS);
    act(() => result.current.drop());
    getUserMedia.mockClear();
    recognizers = [];
    act(() => {
      result.current.begin();
    });
    await pass();
    expect(recognizers).toHaveLength(1);
    expect(recognizers[0].startedWith).toBeUndefined();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(recorders).toHaveLength(1);
  });

  it("opens no microphone beside the recogniser when the phone has no Bluetooth input, as the Talk line's hold does (mw-f7gmps.2)", async () => {
    phoneHas([
      { deviceId: 'e', label: 'Headset earpiece' },
      { deviceId: 'phone', label: 'Phone microphone' },
    ]);
    const { result } = renderHook(() => useHold({ record: true }));
    act(() => {
      result.current.begin();
    });
    await pass();
    expect(recognizers.at(-1)?.startedWith).toBeUndefined();
    expect(devicesOpened()).toEqual([]);
    expect(recorders).toHaveLength(0);
    act(() => recognizers.at(-1)?.hear('check the build'));
    let released: Awaited<ReturnType<typeof result.current.finish>> | undefined;
    await act(async () => {
      const finishing = result.current.finish();
      await vi.advanceTimersByTimeAsync(0);
      released = await finishing;
    });
    expect(released).toEqual({ status: 'heard', text: 'check the build', recording: undefined });
  });

  it('records a copy of the car input it keeps, and hands back that recording', async () => {
    phoneHas([
      { deviceId: 'phone', label: 'Speakerphone' },
      { deviceId: 'car', label: 'Car kit (hands-free)' },
    ]);
    const { result } = renderHook(() => useHold({ record: true }));
    act(() => {
      result.current.begin();
    });
    await pass();
    act(() => recognizers.at(-1)?.hear('what landed'));
    await pass(INPUT_SILENT_MS * 2);
    expect(recognizers.at(-1)?.startedWith?.device).toBe('car');
    let released: Awaited<ReturnType<typeof result.current.finish>> | undefined;
    await act(async () => {
      const finishing = result.current.finish();
      await vi.advanceTimersByTimeAsync(0);
      released = await finishing;
    });
    expect(released).toMatchObject({ status: 'heard', text: 'what landed', recording: { mime: 'audio/webm' } });
    expect(devicesOpened()).toEqual(['car']);
    expect(recorders[0].stream.getTracks()[0]).toMatchObject({ device: 'car', copy: true });
  });
});
