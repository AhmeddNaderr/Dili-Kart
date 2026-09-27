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
  coin: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffc21a"/><circle cx="12" cy="12" r="7.6" fill="none" stroke="#b36b00" stroke-opacity=".55" stroke-width="1.4"/><path d="M9.2 7.4h3.1a4.6 4.6 0 0 1 0 9.2H9.2z" fill="#fff6c9"/><path d="M11 9.4h1.2a2.6 2.6 0 0 1 0 5.2H11z" fill="#ffc21a"/><ellipse cx="8.6" cy="6.6" rx="3" ry="1.4" fill="#fff" fill-opacity=".55" transform="rotate(-30 8.6 6.6)"/></svg>`,
  bag: `<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" fill="currentColor"/><path d="M9 10V7a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  flag: `<svg viewBox="0 0 24 24"><path d="M5 3v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 4h13l-3 4.5L19 13H6z" fill="currentColor"/></svg>`,
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

/** Portraits for the shop's skin drivers, in the same round-badge style. */
export function skinPortrait(id: "quang" | "cipher") {
  if (id === "quang") return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><linearGradient id="qsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9f8ff"/><stop offset="1" stop-color="#27b4f5"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#qsky)"/>
    <path d="M0 78q12-8 25 0t25 0 25 0 25 0v22H0z" fill="#fff" fill-opacity=".8"/>
    <path d="M26 100q2-22 24-22t24 22z" fill="#f6f7fb"/><path d="M44 78h12l-6 9z" fill="#f2c9a6"/>
    <ellipse cx="50" cy="50" rx="24" ry="23" fill="#f7d3b2"/>
    <path d="M25 50q-2-27 25-28 27 1 25 28l-4-9-5 6-3-9-6 7-4-9-4 9-6-7-3 9-5-6z" fill="#1a2130"/>
    <path d="M55 23q6 6 3 17l-3-8z" fill="#eef3fb"/>
    <g fill="none" stroke="#1c1f2a" stroke-width="1.8"><rect x="31" y="47" width="16" height="11" rx="4"/><rect x="53" y="47" width="16" height="11" rx="4"/><path d="M47 51q3-2 6 0"/></g>
    <ellipse cx="39" cy="52.5" rx="4" ry="4.6" fill="#1fa7b8"/><ellipse cx="61" cy="52.5" rx="4" ry="4.6" fill="#1fa7b8"/>
    <circle cx="37.6" cy="51" r="1.4" fill="#fff"/><circle cx="59.6" cy="51" r="1.4" fill="#fff"/>
    <path d="M44 63q6 6 12 0z" fill="#6a2b2b"/><path d="M45 63h10v1.6H45z" fill="#fff"/>
  </svg>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <rect width="100" height="100" fill="#1631c9"/>
    <g font-family="monospace" font-size="9" fill="#9fb4ff" fill-opacity=".45">${Array.from({ length: 10 }, (_, r) => `<text x="2" y="${9 + r * 10}">${"0123456789".repeat(2).slice(r, r + 14).split("").join(" ")}</text>`).join("")}</g>
    <path d="M28 100q2-20 22-20t22 20z" fill="#2c2d36"/>
    <circle cx="50" cy="48" r="30" fill="#cfe0ff" fill-opacity=".18" stroke="#dfe9ff" stroke-opacity=".8" stroke-width="1.6"/>
    <circle cx="50" cy="50" r="21" fill="#1b1c22"/>
    <path d="M27 46l3-12-5-3 8-2-2-8 8 5 3-9 5 8 6-8 2 9 8-5-2 9 8 1-5 5 4 10-9-6-8 4-8-5-9 6z" fill="#141419"/>
    <circle cx="42" cy="50" r="5.4" fill="#f4f6fb"/><circle cx="58" cy="50" r="5.4" fill="#f4f6fb"/>
    <g fill="#2f5bff">${[34,37,40,43,46,54,57,60,63,66].map((x) => `<rect x="${x}" y="43.5" width="2" height="2"/><rect x="${x}" y="56" width="2" height="2"/>`).join("")}<rect x="33" y="47" width="2" height="2"/><rect x="33" y="51" width="2" height="2"/><rect x="48" y="47" width="2" height="2"/><rect x="50" y="47" width="2" height="2"/><rect x="65" y="47" width="2" height="2"/><rect x="65" y="51" width="2" height="2"/></g>
    <path d="M47 61h6" stroke="#0c0d12" stroke-width="1.4"/>
    <ellipse cx="38" cy="32" rx="8" ry="3.5" fill="#fff" fill-opacity=".35" transform="rotate(-30 38 32)"/>
  </svg>`;
}
