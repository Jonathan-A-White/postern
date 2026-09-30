// src/key/qr.ts — a QR code as plain data: the `qrcode` package encodes, and the dark modules
// come back as one SVG path, one unit square per module (drawn by KeyQr.tsx).
import { create } from 'qrcode';

export function qrPath(text: string): { size: number; path: string } {
  const { size, data } = create(text, { errorCorrectionLevel: 'M' }).modules;
  let path = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col]) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}

export function qrPathData(text: string): string {
  return qrPath(text).path;
}
