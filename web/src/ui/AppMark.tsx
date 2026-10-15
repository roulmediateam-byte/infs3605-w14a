/** The app's mark: an envelope with a tick, drawn inline so it needs no image request. Decorative. */
export const AppMark = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <rect width="512" height="512" rx="112" fill="#1F4FD1" />
    <g fill="none" stroke="#FFFFFF" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round">
      <rect x="100" y="144" width="296" height="216" rx="28" />
      <path d="M114 166 248 262 382 166" />
    </g>
    <circle cx="378" cy="350" r="82" fill="#FFFFFF" />
    <path d="M340 352 366 378 416 326" fill="none" stroke="#1F4FD1" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
