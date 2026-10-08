// src/services/recorder.ts — records a voice note in the app (plans/0021 decision
// 11): the phone's microphone through MediaRecorder, Opus where the browser has
// it. What comes out is sent as an attachment (docs/protocol.md §14) and
// transcribed on the desktop, never by a third party. Handed a track (the microphone a hold's
// recogniser listens on), it records a copy of that track and opens no microphone of its own (mw-f7gmps.1).

export interface Recording {
  blob: Blob;
  mime: string;
  durationMs: number;
}

const PREFERRED = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

export function canRecord(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function pickMime(isSupported: (mime: string) => boolean = (mime) => MediaRecorder.isTypeSupported(mime)): string {
  return PREFERRED.find((mime) => isSupported(mime)) ?? '';
}

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Records `track` (a copy of it, so the owner's closing it is the owner's) or, given none, opens the default microphone. */
  async start(track?: MediaStreamTrack): Promise<void> {
    this.stream = track ? new MediaStream([track.clone()]) : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = pickMime();
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.startedAt = Date.now();
    this.recorder.start(1000);
  }

  stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('Not recording.'));
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mime = (recorder.mimeType || this.chunks[0]?.type || 'audio/webm').split(';')[0];
        const recording = { blob: new Blob(this.chunks, { type: mime }), mime, durationMs: Date.now() - this.startedAt };
        this.release();
        resolve(recording);
      };
      recorder.stop();
    });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
