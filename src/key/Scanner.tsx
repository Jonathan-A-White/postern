// src/key/Scanner.tsx — reads one QR code with the phone's camera: getUserMedia for the
// video, the browser's BarcodeDetector for the code. It is offered only where
// BarcodeDetector exists (hasBarcodeDetector); paste works everywhere else.
import { useEffect, useRef, useState } from 'react';
import { detectorConstructor } from './barcode';

const SCAN_INTERVAL_MS = 250;

/** Opens the camera, calls `onRead` with the first code seen, and stops the camera again. */
export function Scanner({ onRead, onCancel }: { onRead: (text: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const Detector = detectorConstructor();
    const video = videoRef.current;
    if (!Detector || !video) return;
    const detector = new Detector({ formats: ['qr_code'] });
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((opened) => {
        if (stopped) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        video.srcObject = opened;
        void Promise.resolve(video.play()).catch(() => undefined);
        timer = setInterval(() => {
          detector
            .detect(video)
            .then((codes) => {
              const text = codes[0]?.rawValue;
              if (stopped || !text) return;
              stop();
              onRead(text);
            })
            .catch(() => undefined);
        }, SCAN_INTERVAL_MS);
      })
      .catch(() => setProblem('The camera could not be opened. Paste the key instead.'));

    return stop;
  }, [onRead]);

  return (
    <div className="flex flex-col gap-2">
      <video ref={videoRef} data-testid="scan-video" playsInline muted className="w-full rounded-xl bg-sunken" />
      {problem && <p className="text-danger">{problem}</p>}
      <button
        className="inline-flex h-8 items-center self-start rounded-lg border border-line bg-raised px-3 text-sm"
        onClick={onCancel}
      >
        Cancel scan
      </button>
    </div>
  );
}
