// The app's mark (docs/brand/README.md): a steel square turned 45 degrees so it reads as a tick. The owner's OK,
// drawn with the tradie's own tool, and "all square": nobody owes anything. Drawn inline, so it needs no image
// request. Decorative. Two cuts: the small one (no graduations) for the side bar, and the one with the blade's four
// graduations from 40 px, where high-density screens draw them crisply (the sign-in panel).
import { useId } from 'react';

/** The app-icon tile: a superellipse, so its corners curve continuously like a phone's icons. */
const TILE =
  'M512 256L511.6 352.5L510.4 383.1L508.5 405.1L505.7 422.7L502.1 437.4L497.7 450L492.4 461L486.1 470.5L478.9 478.9L470.5 486.1L461 492.4L450 497.7L437.4 502.1L422.7 505.7L405.1 508.5L383.1 510.4L352.5 511.6L256 512L159.5 511.6L128.9 510.4L106.9 508.5L89.3 505.7L74.6 502.1L62 497.7L51 492.4L41.5 486.1L33.1 478.9L25.9 470.5L19.6 461L14.3 450L9.9 437.4L6.3 422.7L3.5 405.1L1.6 383.1L0.4 352.5L0 256L0.4 159.5L1.6 128.9L3.5 106.9L6.3 89.3L9.9 74.6L14.3 62L19.6 51L25.9 41.5L33.1 33.1L41.5 25.9L51 19.6L62 14.3L74.6 9.9L89.3 6.3L106.9 3.5L128.9 1.6L159.5 0.4L256 0L352.5 0.4L383.1 1.6L405.1 3.5L422.7 6.3L437.4 9.9L450 14.3L461 19.6L470.5 25.9L478.9 33.1L486.1 41.5L492.4 51L497.7 62L502.1 74.6L505.7 89.3L508.5 106.9L510.4 128.9L511.6 159.5Z';

/** The mark inside the tile, two thirds of its width, centred by eye. */
const MARK = 'M196.7 387.5L422 162.3L377 117.2L185.5 308.7L117.9 241.1L84.1 274.9Z';

/** The same, with the graduations cut into the blade's inner edge. */
const MARK_DETAIL =
  'M198 386.1L423.3 160.9L378.2 115.8L355.7 138.3L370.1 152.7L361.1 161.8L346.7 147.3L321.2 172.9L343.7 195.4L334.7 204.4L312.2 181.9L286.6 207.4L301.1 221.8L292 230.8L277.6 216.4L252.1 242L274.6 264.5L265.6 273.5L243.1 251L186.8 307.3L119.2 239.7L85.4 273.5Z';

/** The brand gradient (styles.css --brand-gradient), with its OKLCH midpoint as a stop so SVG matches CSS. */
const STOPS = [
  ['0', '#1F4FD1'],
  ['0.5', '#4D3ED9'],
  ['1', '#6D28D9'],
] as const;

/**
 * tile: the app icon, a white mark on the brand gradient (the side bar).
 * inverse: a white tile with the mark in the brand indigo, for the gradient brand panel at sign-in.
 */
export const AppMark = ({ size = 40, variant = 'tile', detail = false }: { size?: number; variant?: 'tile' | 'inverse'; detail?: boolean }) => {
  // One gradient per drawing: two marks on a page must not share an id.
  const gradient = `pp-mark-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const mark = detail ? MARK_DETAIL : MARK;
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      {variant === 'tile' ? (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              {STOPS.map(([offset, color]) => (
                <stop key={offset} offset={offset} stopColor={color} />
              ))}
            </linearGradient>
          </defs>
          <path d={TILE} fill={`url(#${gradient})`} />
          <path d={mark} fill="#FFFFFF" />
        </>
      ) : (
        <>
          <path d={TILE} fill="#FFFFFF" />
          <path d={mark} fill="#4D3ED9" />
        </>
      )}
    </svg>
  );
};
