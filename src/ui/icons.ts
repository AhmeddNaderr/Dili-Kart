import type { SkinDriver } from "../kart/chibi";

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
export function skinPortrait(id: SkinDriver) {
  if (id === "rehan") return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="rhbg" cx=".64" cy=".36" r=".85"><stop offset="0" stop-color="#21336e"/><stop offset=".5" stop-color="#0c1022"/><stop offset="1" stop-color="#04050a"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#rhbg)"/>
    <circle cx="50" cy="50" r="41" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.2"/>
    <path d="M13 100q3-25 37-26 34 1 37 26z" fill="#1b1c23"/>
    <path d="M29 79q21 13 42 0l-4-6q-17 9-34 0z" fill="#262833"/>
    <path d="M44.5 80v11M55.5 80v11" stroke="#e7eaf2" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M47.2 99.5v-8h3.4a2.3 2.3 0 0 1 0 4.6h-3.4m3 0 2.6 3.4" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M86 100q-3-23-28-26" fill="none" stroke="#4d8dff" stroke-opacity=".7" stroke-width="1.6"/>
    <path d="M44 64h12v11q-6 4-12 0z" fill="#dcb497"/>
    <ellipse cx="50" cy="50" rx="21" ry="22" fill="#f3d2b8"/>
    <path d="M70 41q3 10-1 20" fill="none" stroke="#7fa6ff" stroke-opacity=".55" stroke-width="1.6"/>
    <ellipse cx="41" cy="53.5" rx="5" ry="4.2" fill="#fff"/><ellipse cx="59" cy="53.5" rx="5" ry="4.2" fill="#fff"/>
    <circle cx="39.3" cy="54.4" r="3.1" fill="#3c5291"/><circle cx="57.3" cy="54.4" r="3.1" fill="#3c5291"/>
    <circle cx="39.3" cy="54.7" r="1.4" fill="#0d1020"/><circle cx="57.3" cy="54.7" r="1.4" fill="#0d1020"/>
    <circle cx="38.3" cy="53.6" r=".8" fill="#fff"/><circle cx="56.3" cy="53.6" r=".8" fill="#fff"/>
    <path d="M35.5 52.2q5.5-2 11 .4V48h-11zM53.5 52.6q5.5-2.4 11-.4V48h-11z" fill="#f3d2b8"/>
    <path d="M35.5 52.2q5.5-2 11 .4M53.5 52.6q5.5-2.4 11-.4" stroke="#15161f" stroke-width="1.9" fill="none" stroke-linecap="round"/>
    <path d="M36 46.2l9.5 1.6M64 46.2l-9.5 1.6" stroke="#16171f" stroke-width="2" stroke-linecap="round"/>
    <path d="M47.5 64.6h5.5" stroke="#15161f" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M26 60C21 35 33 21 52 21c19 0 28 13 24 33l-3-7-1 7-5-10-2 8-5-11-3 9-5-10-3 10-4-9-3 9-4-7-1 9-3-7z" fill="#16171f"/>
    <path d="M58 22c12 2 20 11 19 26" fill="none" stroke="#4d8dff" stroke-width="1.5" stroke-opacity=".9"/>
    <path d="M44 15q4-3 6 2" fill="none" stroke="#16171f" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
  if (id === "abubakker") return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><linearGradient id="abbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b3b6bd"/><stop offset="1" stop-color="#5d6068"/></linearGradient>
    <linearGradient id="abfd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d1d23"/><stop offset=".9" stop-color="#eec8a6"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#abbg)"/>
    <path d="M12 100q3-26 38-27 35 1 38 27z" fill="#f1f0ec"/>
    <path d="M40 73.5l10 26.5 10-26.5q-10 4-20 0z" fill="#141418"/>
    <path d="M38 73l12 27-3.5-.2-13.5-23zM62 73l-12 27 3.5-.2 13.5-23z" fill="#dcdbd5"/>
    <circle cx="50" cy="96" r="1.6" fill="#26272e"/>
    <path d="M44 63h12v11q-6 4-12 0z" fill="#dcb08d"/>
    <ellipse cx="29.5" cy="53" rx="3.2" ry="5.2" fill="#e2b694"/><ellipse cx="70.5" cy="53" rx="3.2" ry="5.2" fill="#e2b694"/>
    <ellipse cx="50" cy="50" rx="21" ry="22" fill="#eec8a6"/>
    <path d="M29.2 52q-1.6-13 3.8-21l3.6 15q-3 5-7.4 6zM70.8 52q1.6-13-3.8-21l-3.6 15q3 5 7.4 6z" fill="url(#abfd)"/>
    <path d="M38 55a3.2 3 0 0 0 6.4 0zM56 55a3.2 3 0 0 0 6.4 0z" fill="#4a3426"/>
    <path d="M36 55.4q5-3.4 10.2 0M54 55.4q5-3.4 10.2 0" stroke="#15161f" stroke-width="2.1" fill="none" stroke-linecap="round"/>
    <path d="M46.2 55.4l1.4.9M64.2 55.4l1.4.9" stroke="#15161f" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M36.5 48q4.6-1.6 9.4.2M54.1 48.2q4.8-1.8 9.4-.2" stroke="#131317" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    <path d="M47 64.2q3 1.8 6.2 0" stroke="#15161f" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M30 40c-1-14 8-22 21-22 13 0 21 8 20 21l-3-3v6l-5-7-1 6-6-8-2 7-5-7-2 7-4-6-2 7-4-5-1 6-3-6z" fill="#131317"/>
    <path d="M36 25q6-6 14-4M52 20q9-1 13 6M44 30q5-4 11-2" fill="none" stroke="#3a3b46" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;
  if (id === "vic") return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="vcbg" cx=".5" cy=".4" r=".75"><stop offset="0" stop-color="#9157ff"/><stop offset="1" stop-color="#3a1580"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#vcbg)"/>
    <path d="M12 100q3-26 38-27 35 1 38 27z" fill="#f1f1ec"/>
    <path d="M47 75h6l1.6 3.6-2.6 21.4h-4l-2.6-21.4z" fill="#141318"/>
    <path d="M12 100q3-26 25-27l7 27zM88 100q-3-26-25-27l-7 27z" fill="#3c5f92"/>
    <path d="M36.5 75l6 24M63.5 75l-6 24" stroke="#d39a45" stroke-width=".9" stroke-dasharray="2 1.5"/>
    <path d="M14 92l-2 3M18 85l-3 2M84 85l3 2M86 92l2 3" stroke="#a8bedc" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M44 62h12v12q-6 4-12 0z" fill="#79ad43"/>
    <ellipse cx="28.5" cy="56" rx="3.2" ry="5" fill="#86bd4c"/><ellipse cx="71.5" cy="56" rx="3.2" ry="5" fill="#86bd4c"/>
    <ellipse cx="50" cy="53" rx="22" ry="21" fill="#8cc551"/>
    <circle cx="27.4" cy="63" r="2.6" fill="none" stroke="#e8edf5" stroke-width="1.1"/>
    <path d="M72.4 61v8M70.2 63.4h4.4" stroke="#e8edf5" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="40" cy="55" r="6" fill="#5f8f30"/><circle cx="60" cy="55" r="6.4" fill="#5f8f30"/>
    <path d="M36.4 51.4l7.2 7.2M43.6 51.4l-7.2 7.2M56 51l8 8M64 51l-8 8" stroke="#1a1222" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M30 62l8-3.2M32 59.4l1 3.4M35 58.4l1 3.4" stroke="#3d5c1d" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M40 66h20q-1.4 10-10 10t-10-10z" fill="#3a0d22"/>
    <path d="M40.6 66h18.8v2.2H40.6z" fill="#f6f3e6"/>
    <path d="M43 68l1.4 3.8 1.4-3.8zM54.2 68l1.4 3.8 1.4-3.8z" fill="#fbf8ec"/>
    <path d="M45.5 72.5q4.5-1.8 9 0 1.6 11-4.5 14.5-6-3.6-4.5-14.5z" fill="#a64ae6"/>
    <path d="M50 74.5v8" stroke="#6b1f9c" stroke-width="1" stroke-linecap="round"/>
    <path d="M41.6 70.5q-1 5 .2 9" stroke="#94ff5a" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="41.9" cy="81" r="1.9" fill="#94ff5a"/>
    <path d="M27 45c-2-18 9-28 23-28s25 10 23 28z" fill="#ff7a1c"/>
    <path d="M35 22v22M42 18.6V44M50 17.5V44M58 18.6V44M65 22v22" stroke="#c94d06" stroke-opacity=".55" stroke-width="1.4"/>
    <rect x="25" y="38" width="50" height="10" rx="4" fill="#ff8a2a"/>
    <path d="M29 38v10M33 38v10M37 38v10M41 38v10M45 38v10M49 38v10M53 38v10M57 38v10M61 38v10M65 38v10M69 38v10" stroke="#c94d06" stroke-opacity=".45" stroke-width="1"/>
    <rect x="58" y="39.5" width="8" height="5.6" rx="1" fill="#18161f"/><path d="M60 40.8l4 3M64 40.8l-4 3" stroke="#8dff4a" stroke-width="1"/>
  </svg>`;
  if (id === "abhishek") return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><linearGradient id="akbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cbc199"/><stop offset="1" stop-color="#7f764d"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#akbg)"/>
    <path d="M12 100q3-26 38-27 35 1 38 27z" fill="#18181c"/>
    <path d="M40 73l10 27 10-27q-10 5-20 0z" fill="#f6f6f3"/>
    <path d="M45 73l5 9 5-9z" fill="#c98f66"/>
    <path d="M35.5 74l14.5 26h-3.4L32.4 78zM64.5 74L50 100h3.4l14.2-22z" fill="#0f0f12"/>
    <path d="M38.5 72.5h6l2 7.5-7 2.6zM61.5 72.5h-6l-2 7.5 7 2.6z" fill="#fff"/>
    <path d="M65.5 87.5l2.4-3.6 1.6 2.6 1.8-2.8 1.2 3.8z" fill="#fff"/>
    <path d="M44 62h12v11q-6 4-12 0z" fill="#c48a62"/>
    <ellipse cx="29" cy="52" rx="3.2" ry="5.2" fill="#cf946b"/><ellipse cx="71" cy="52" rx="3.2" ry="5.2" fill="#cf946b"/>
    <path d="M29 47c0-14 9-22 21-22s21 8 21 22c0 11-3 17-7 21-4 4-9 6-14 6s-10-2-14-6c-4-4-7-10-7-21z" fill="#d9a179"/>
    <path d="M36 52.6q5-4.2 10.4 0-5.2 2.6-10.4 0zM53.6 52.6q5.2-4.2 10.4 0-5.2 2.6-10.4 0z" fill="#fff"/>
    <circle cx="41.3" cy="52.3" r="2.5" fill="#4a2d1a"/><circle cx="58.9" cy="52.3" r="2.5" fill="#4a2d1a"/>
    <circle cx="40.6" cy="51.6" r=".7" fill="#fff"/><circle cx="58.2" cy="51.6" r=".7" fill="#fff"/>
    <path d="M35.4 52.4q5.4-4.6 11.2-.2M53.4 52.2q5.8-4.4 11.2.2" stroke="#15161f" stroke-width="1.9" fill="none" stroke-linecap="round"/>
    <path d="M34.6 45.8l11.4 2.2M65.4 45.8l-11.4 2.2" stroke="#0f0f13" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M50.4 53.5l.6 6-2 .8" stroke="#b07650" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <path d="M45 65.2q4.6 1.8 9.4-1.4" stroke="#15161f" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M28.6 46c-2-19 9-25 22-25 14 0 21 7 21 17 0 3-.4 6-1 9-2-9-9-14-18-14-6 0-11 2-15 5 1-3 3-5 6-6-8 0-13 6-15 14z" fill="#0f0f13"/>
    <path d="M36 25q12-6 26 1" fill="none" stroke="#7d8fc8" stroke-opacity=".6" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
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
