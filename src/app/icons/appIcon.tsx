import { ImageResponse } from 'next/og';

/**
 * The installed-app icon, drawn rather than stored.
 *
 * A PWA is only installable with a raster icon of at least 192px — Chrome will
 * not offer an SVG one — and this repository has no image toolchain to produce
 * a PNG with. `ImageResponse` is already in the framework, so the icon is
 * generated from the same values `globals.css` uses instead of a binary blob
 * nobody can diff.
 *
 * No text: rendering a glyph would mean shipping and loading a font file, and
 * a play mark says the same thing at 48px, where a letterform would not
 * survive anyway.
 */

/** `--salt-primary` and `--sea-abyss`, kept in step with `globals.css` by hand. */
const BACKGROUND = '#0d6fa8';
const FOREGROUND = '#fbfcfe';

/**
 * The mark is an inline `<svg>` rather than the usual zero-width-box-with-
 * borders triangle. Satori — the renderer behind `ImageResponse` — implements
 * a subset of CSS that does not include collapsing a box to its borders, and
 * the trick silently rasterises as a filled rectangle instead of failing.
 */
function PlayMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path d="M30 18 L82 50 L30 82 Z" fill={FOREGROUND} strokeLinejoin="round" strokeWidth="14" stroke={FOREGROUND} />
    </svg>
  );
}

export function appIcon(size: number, maskable: boolean): ImageResponse {
  // A maskable icon may be cropped to a circle by the launcher, so its artwork
  // has to stay inside the 40%-radius safe zone the spec defines. The same
  // mark at the same scale would lose its point.
  const mark = Math.round(size * (maskable ? 0.42 : 0.56));

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: BACKGROUND,
        // A plain icon is its own rounded tile; a maskable one must paint to
        // the very edge and let the launcher decide the shape.
        borderRadius: maskable ? 0 : size * 0.22,
      }}
    >
      <PlayMark size={mark} />
    </div>,
    { width: size, height: size },
  );
}
