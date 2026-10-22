// Stroke icons drawn on a 24 grid, 1.75 stroke — matching the approved mockups.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
});

export const IconConsole = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="6" y="2.5" width="12" height="19" rx="2" /><circle cx="12" cy="7" r="1.6" /><path d="M9 17h6" /></svg>
);
export const IconCloud = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z" /></svg>
);
export const IconSliders = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
);
export const IconPlay = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable={false} {...p}><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
);
export const IconCheck = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.25} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconCross = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.25} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconSearch = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></svg>
);
export const IconClose = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconChevronL = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M14.5 6l-6 6 6 6" /></svg>
);
export const IconChevronR = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M9.5 6l6 6-6 6" /></svg>
);
export const IconSteam = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconGamepad = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M7.5 8h9a4.5 4.5 0 0 1 4.4 5.4l-.7 3.4a2.2 2.2 0 0 1-3.8 1l-2-2.3h-5l-2 2.3a2.2 2.2 0 0 1-3.8-1l-.7-3.4A4.5 4.5 0 0 1 7.5 8z" /><path d="M8 11v3M6.5 12.5h3" /><circle cx="15.5" cy="12" r=".6" fill="currentColor" /><circle cx="17" cy="13.6" r=".6" fill="currentColor" /></svg>
);
export const IconKeyboard = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="6.5" width="18" height="11" rx="2" /><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8" /></svg>
);

/** Xenith mark (build/icon.svg): two-stroke X, the second stroke split where it passes under the first. */
export const XenithMark = ({ size = 22, ...p }: P) => (
  <svg width={size} height={size} viewBox="200 200 624 624" fill="currentColor" aria-hidden focusable={false} {...p}>
    <polygon points="250,232 378,232 774,792 646,792" />
    <polygon points="250,792 378,792 470,662 406,572" />
    <polygon points="618,452 554,362 646,232 774,232" />
  </svg>
);
