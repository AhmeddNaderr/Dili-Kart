/** The Dlicom mark: an S-shaped swoosh around a diamond. */
export const LOGO = `<svg viewBox="0 0 100 80" aria-hidden="true">
  <path d="M22 44C18 24 36 13 58 13L97 6 63 27C50 26 42 30 39 38Z" fill="currentColor"/>
  <path d="M78 36C82 56 64 67 42 67L3 74 37 53C50 54 58 50 61 42Z" fill="currentColor"/>
  <path d="M50 28 62 40 50 52 38 40Z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>
</svg>`;

export const ICON = {
  sound: `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  muted: `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  full: `<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lock: `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24"><path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 14h4v3h-4zM8 18h8v2H8z" fill="currentColor"/></svg>`,
};

/**
 * A little portrait of a squad member in the official style: speech-bubble
 * head, pixel eyes, glass dome. Pure SVG so it's crisp everywhere.
 */
export function portrait(color: string, dome: string, mouth: "smile" | "o") {
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="44" fill="${dome}" fill-opacity=".22" stroke="${dome}" stroke-opacity=".7" stroke-width="2"/>
    <ellipse cx="36" cy="30" rx="12" ry="7" fill="#fff" fill-opacity=".35" transform="rotate(-30 36 30)"/>
    <path d="M30 34h40a16 16 0 0 1 0 32H57l-6 10-2-10H30a16 16 0 0 1 0-32z" fill="${color}"/>
    <path d="M30 34h40a16 16 0 0 1 0 32H57" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3"/>
    <g transform="translate(38 47) rotate(45)"><rect x="-6" y="-6" width="12" height="12" fill="#fff"/><rect x="-1" y="-5" width="7" height="7" fill="#15161f"/></g>
    <g transform="translate(62 47) rotate(45)"><rect x="-6" y="-6" width="12" height="12" fill="#fff"/><rect x="-6" y="-1" width="7" height="7" fill="#15161f"/></g>
    ${mouth === "smile"
      ? `<path d="M45 56q5 5 10 0" fill="none" stroke="#15161f" stroke-width="3" stroke-linecap="round"/>`
      : `<circle cx="50" cy="57" r="3" fill="#15161f"/>`}
  </svg>`;
}
