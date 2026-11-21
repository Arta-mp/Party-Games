import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** Invite QR code rendered as inline SVG (generated locally, no external service). */
export function Qr({ text, size = 176 }: { text: string; size?: number }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return (
    <div
      className="rounded-2xl bg-white p-2"
      style={{ width: size, height: size }}
      aria-label="QR"
      role="img"
      // svg markup is produced locally by qrcode-generator from our own invite link
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
