import { ImageResponse } from 'next/og';

export const alt = "Forgetting Forecast: know what you'll forget";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Social preview: the striped sunset sun over the grid floor, with the headline. */
export default function OpengraphImage() {
  const lines = Array.from({ length: 9 }, (_, i) => i);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(180deg, #07040f 0%, #0f0826 60%, #1d0f45 100%)',
          position: 'relative',
          overflow: 'hidden',
          color: '#f1ecff',
        }}
      >
        {/* grid floor */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 230, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          {lines.map(i => (
            <div key={i} style={{ height: 2, background: '#3a2a6e', opacity: 0.35 + i * 0.07 }} />
          ))}
        </div>
        {/* sun */}
        <div
          style={{
            width: 230,
            height: 230,
            borderRadius: 115,
            background: 'linear-gradient(180deg, #ffe14d 0%, #ff8a3d 40%, #ff2bd6 75%, #8b5cf6 100%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            overflow: 'hidden',
            marginBottom: 30,
          }}
        >
          {[18, 14, 10, 6].map((h, i) => (
            <div key={i} style={{ height: h, background: '#0f0826', marginBottom: 14 - i * 2 }} />
          ))}
        </div>
        <div style={{ fontSize: 76, fontWeight: 900, letterSpacing: 4, textTransform: 'uppercase', display: 'flex' }}>KNOW WHAT YOU&apos;LL FORGET.</div>
        <div style={{ fontSize: 28, color: '#a99fd6', marginTop: 16, display: 'flex' }}>Forgetting Forecast · a transparent memory forecaster</div>
      </div>
    ),
    size
  );
}
