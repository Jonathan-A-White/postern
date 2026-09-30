// src/key/KeyQr.tsx — my public key as a QR code, so another phone can scan it and issue
// me a licence. The `qrcode` package encodes it; the modules are drawn here as one SVG
// path (qr.ts), so nothing touches a canvas or injects markup.
import { useState } from 'react';
import { qrPath } from './qr';

const QUIET_ZONE = 4;

export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = qrPath(text);
  const extent = size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="key-qr"
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className="h-48 w-48 self-center rounded-lg"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={extent} height={extent} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** The key as a QR, its hex beside it, and a Copy button. */
export function MyPublicKey({ publicKeyHex }: { publicKeyHex: string }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'unavailable'>('idle');

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API not available');
      await navigator.clipboard.writeText(publicKeyHex);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 3000);
    } catch {
      setCopyStatus('unavailable');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <QrCode text={publicKeyHex} label="QR code of my public key" />
      <p className="text-sm text-muted">
        My public key:{' '}
        <span data-testid="public-key-hex" className="break-all font-mono">
          {publicKeyHex}
        </span>
      </p>
      <button
        className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-raised px-4 text-[15px] hover:border-line-strong"
        onClick={() => void handleCopy()}
      >
        {copyStatus === 'copied' ? 'Copied' : 'Copy public key'}
      </button>
      {copyStatus === 'unavailable' && <p>Copy is not available here: select the key by hand</p>}
    </div>
  );
}
