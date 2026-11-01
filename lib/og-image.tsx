import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = 'image/png';

export function ogImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#221e1a',
          color: '#f7f3ea',
          padding: '72px',
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, letterSpacing: 4 }}>A11YGATE</div>
        <div style={{ display: 'flex', fontSize: 64, lineHeight: 1.05, maxWidth: 980 }}>
          Accessibility regression gate and EAA evidence report
        </div>
        <div style={{ display: 'flex', fontSize: 28 }}>Runs in your browser. Nothing is uploaded.</div>
      </div>
    ),
    { ...ogSize },
  );
}
