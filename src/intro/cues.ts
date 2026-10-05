/**
 * The edit of the intro film, in seconds. Picture (main.ts) and sound
 * (score.ts) both read these, so every hit lands on its cut.
 */
export const CUE = {
  /** S1: morning on the grid; Dili walks up to his kart. */
  open: 0,
  walkFrom: 0.8,
  walkTo: 4.0,
  /** S2: he turns to camera and waves. */
  wave: 4.6,
  /** S3: the hop into the seat. */
  hop: 6.8,
  jump: 7.25,
  land: 7.95,
  /** S4: close on Dili in the cockpit. */
  cockpit: 8.8,
  /** S5: the dashboard. Its own timeline runs from here (see dash.ts). */
  dash: 11.4,
  boot: 11.4 + 0.6,
  hover: 11.4 + 2.5,
  select: 11.4 + 2.72,
  start: 11.4 + 3.97,
  /** S6: revving on the grid as the lights come on (countdown starts). */
  rev: 16.4,
  lights: 16.4,
  /** S7: close on the start lights. */
  lamps: 18.2,
  go: 19.4,
  /** S8: the launch. */
  launch: 19.55,
  /** S9: off the ramp and over the lake, in slow motion. */
  fly: 22.0,
  slowFrom: 22.8,
  slowTo: 25.2,
  /** S10: up into the sky and the logo. */
  logo: 26.5,
  end: 31,
} as const;
