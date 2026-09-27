import * as THREE from "three";
import type { TrackId } from "../../shared/rules";

/**
 * The circuit's spine. Everything in the race lives in *track space*: a
 * distance along the centre line (`u`, metres) and a sideways offset
 * (`lat`, metres, + is to the driver's right). Driving in track space is
 * what makes the game easy — you can't face backwards or get lost — while
 * banking, hills and a centrifugal push keep the corners feeling physical.
 */

export const LANE_W = 4.2;
export const LANES = 4;
/** Half the painted road: four lanes. */
export const ROAD_HALF = (LANE_W * LANES) / 2;      // 8.4
export const CURB_W = 1.5;
/** Outer edge of the curbs — beyond this is grass. */
export const EDGE = ROAD_HALF + CURB_W;             // 9.9
export const RUNOFF = 6.5;
/** Inner face of the barrier wall. */
export const WALL = EDGE + RUNOFF;                  // 16.4
/** How far a kart's centre can get from the centre line. */
export const DRIVE_LIMIT = WALL - 1.3;

/** Centre of lane n, 0 = far left. */
export const laneX = (n: number) => -ROAD_HALF + LANE_W * (n + 0.5);

export interface TrackDef {
  id: TrackId;
  /** Hand-placed control points as [x, z, height], in driving order. */
  ctrl: [number, number, number][];
  /** Index of the control point at the jump's launch lip. */
  jumpAt: number;
  /** Seconds for a clean race; faster earns a time bonus. */
  par: number;
}

export const TRACKS: Record<TrackId, TrackDef> = {
  /**
   * The stadium: main straight north, a climbing hairpin, the back straight
   * with the jump crest at index 8, a sweeping right, an S through the
   * bottom, and home.
   */
  circuit: {
    id: "circuit",
    ctrl: [
      [0, 0, 0], [0, -70, 0], [0, -140, 1], [10, -190, 3], [45, -215, 5],
      [88, -208, 6.5], [112, -172, 7], [118, -128, 7.2], [118, -98, 8.2],
      [118, -58, 2], [122, -18, 0], [150, 18, 0], [165, 62, 0], [148, 100, 1],
      [112, 108, 2.5], [80, 92, 3], [48, 112, 2], [20, 128, 1], [-2, 108, 0],
      [-6, 60, 0],
    ],
    jumpAt: 8,
    par: 150,
  },
  /**
   * Neon Town: up the boulevard, right along the high street, a ramp up to
   * the canal bridge (the jump at index 9), down past the waterfront, and
   * back along the market street to the line.
   */
  town: {
    id: "town",
    ctrl: [
      [0, 0, 0], [0, -55, 0], [2, -105, 0], [14, -135, 0], [40, -152, 0],
      [75, -156, 0], [105, -146, 0.5], [128, -120, 2], [134, -85, 4.5],
      [134, -52, 6.5], [134, -12, 1.5], [132, 22, 0], [120, 50, 0],
      [92, 64, 0], [58, 62, 0], [32, 72, 0], [10, 60, 0], [-2, 34, 0],
    ],
    jumpAt: 9,
    par: 175,
  },
};

export interface Frame {
  pos: THREE.Vector3;
  tan: THREE.Vector3;
  /** Banked sideways unit vector, pointing to the driver's right. */
  side: THREE.Vector3;
  /** Road surface normal. */
  up: THREE.Vector3;
  /** Signed curvature, 1/m. Positive = turning right. */
  curv: number;
  bank: number;
}

export const newFrame = (): Frame => ({
  pos: new THREE.Vector3(), tan: new THREE.Vector3(),
  side: new THREE.Vector3(), up: new THREE.Vector3(), curv: 0, bank: 0,
});

export class Track {
  readonly N = 2400;
  readonly length: number;
  readonly ds: number;
  /** u of each control point, for placing things by landmark. */
  readonly ctrlU: number[];
  /** Start/finish line. */
  readonly startU: number;
  /** The jump: launch lip and the far side of the gap. */
  readonly lipU: number;
  readonly landU: number;
  private P: Float32Array;
  private T: Float32Array;
  private S: Float32Array;
  private U: Float32Array;
  private K: Float32Array;
  private B: Float32Array;

  constructor(readonly def: TrackDef = TRACKS.circuit) {
    // The whole circuit sits a little above the ground plane so the two
    // never fight for the same depth at a distance.
    const pts = def.ctrl.map(([x, z, y]) => new THREE.Vector3(x, y + 0.45, z));
    const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    this.length = curve.getLength();
    const N = this.N;
    this.ds = this.length / N;
    const sp = curve.getSpacedPoints(N);

    this.P = new Float32Array(N * 3);
    this.T = new Float32Array(N * 3);
    this.S = new Float32Array(N * 3);
    this.U = new Float32Array(N * 3);
    this.K = new Float32Array(N);
    this.B = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.P[i * 3] = sp[i].x;
      this.P[i * 3 + 1] = sp[i].y;
      this.P[i * 3 + 2] = sp[i].z;
    }

    // Tangents by central difference, flat side vectors, raw curvature.
    const tan: THREE.Vector3[] = [];
    const side0: THREE.Vector3[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      const a = sp[(i - 1 + N) % N], b = sp[(i + 1) % N];
      const t = new THREE.Vector3().subVectors(b, a).normalize();
      tan.push(t);
      side0.push(new THREE.Vector3().crossVectors(t, up).normalize());
    }
    const rawK = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = tan[(i - 1 + N) % N], b = tan[(i + 1) % N];
      rawK[i] = new THREE.Vector3().subVectors(b, a).dot(side0[i]) / (2 * this.ds);
    }
    const k = smooth(smooth(rawK, 18), 18);
    this.K.set(k);

    // Bank into corners: the outside edge rises. Positive curvature (a right
    // turn) needs the left edge up, which is a negative roll about the tangent.
    const bank = new Float32Array(N);
    for (let i = 0; i < N; i++) bank[i] = THREE.MathUtils.clamp(-k[i] * 6.5, -0.2, 0.2);
    this.B.set(smooth(bank, 24));

    // A banked corner tilts its inside edge down. Where the road is low, that
    // edge (and the verge beside it) would dip under the ground plane and the
    // lawn would show through the tarmac, so lift those stretches just
    // enough, with a long smooth ramp so the road never gets a bump.
    const need = new Float32Array(N);
    for (let i = 0; i < N; i++) need[i] = Math.max(0, (EDGE + 3) * Math.abs(Math.sin(this.B[i])) + 0.15 - sp[i].y);
    const r = Math.round(22 / this.ds);
    const lift = smooth(smooth(dilate(need, r), r >> 1), r >> 1);
    for (let i = 0; i < N; i++) {
      sp[i].y += lift[i];
      this.P[i * 3 + 1] = sp[i].y;
    }
    for (let i = 0; i < N; i++) {
      const a = sp[(i - 1 + N) % N], b = sp[(i + 1) % N];
      tan[i].subVectors(b, a).normalize();
      side0[i].crossVectors(tan[i], up).normalize();
    }

    const n0 = new THREE.Vector3();
    const s = new THREE.Vector3();
    const u = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const t = tan[i];
      n0.crossVectors(side0[i], t).normalize();          // up, perpendicular to t
      const b = this.B[i];
      s.copy(side0[i]).multiplyScalar(Math.cos(b)).addScaledVector(n0, Math.sin(b));
      u.copy(n0).multiplyScalar(Math.cos(b)).addScaledVector(side0[i], -Math.sin(b));
      this.T.set([t.x, t.y, t.z], i * 3);
      this.S.set([s.x, s.y, s.z], i * 3);
      this.U.set([u.x, u.y, u.z], i * 3);
    }

    this.ctrlU = pts.map((p) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < N; i++) {
        const d = sp[i].distanceToSquared(p);
        if (d < bd) { bd = d; best = i; }
      }
      return best * this.ds;
    });

    this.startU = this.ctrlU[0] + 32;
    this.lipU = this.ctrlU[def.jumpAt] + 1;
    this.landU = this.lipU + 24;
  }

  wrap(u: number) {
    const L = this.length;
    return ((u % L) + L) % L;
  }

  /** Shortest signed distance along the track from a to b. */
  delta(a: number, b: number) {
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  /** True when u lies inside the jump's gap, where there's no road. */
  inGap(u: number) {
    const w = this.wrap(u);
    return w > this.lipU && w < this.landU;
  }

  frame(u: number, out: Frame): Frame {
    const x = this.wrap(u) / this.ds;
    const i = Math.floor(x) % this.N;
    const j = (i + 1) % this.N;
    const f = x - Math.floor(x);
    lerp3(this.P, i, j, f, out.pos);
    lerp3(this.T, i, j, f, out.tan).normalize();
    lerp3(this.S, i, j, f, out.side).normalize();
    lerp3(this.U, i, j, f, out.up).normalize();
    out.curv = this.K[i] + (this.K[j] - this.K[i]) * f;
    out.bank = this.B[i] + (this.B[j] - this.B[i]) * f;
    return out;
  }

  private scratch = newFrame();

  /** World position of a track-space point. */
  point(u: number, lat: number, lift: number, out = new THREE.Vector3()) {
    const f = this.frame(u, this.scratch);
    return out.copy(f.pos).addScaledVector(f.side, lat).addScaledVector(f.up, lift);
  }

  curvature(u: number) {
    return this.frame(u, this.scratch).curv;
  }

  /** Raw sample access for mesh building. */
  sample(i: number) {
    const n = ((i % this.N) + this.N) % this.N;
    return {
      pos: v3(this.P, n), tan: v3(this.T, n), side: v3(this.S, n), up: v3(this.U, n),
      curv: this.K[n], bank: this.B[n],
    };
  }

  /** Top-down outline for the minimap: [x, z] pairs. */
  outline(step = 12): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < this.N; i += step) out.push([this.P[i * 3], this.P[i * 3 + 2]]);
    return out;
  }
}

function v3(a: Float32Array, i: number) {
  return new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
}

function lerp3(a: Float32Array, i: number, j: number, f: number, out: THREE.Vector3) {
  return out.set(
    a[i * 3] + (a[j * 3] - a[i * 3]) * f,
    a[i * 3 + 1] + (a[j * 3 + 1] - a[i * 3 + 1]) * f,
    a[i * 3 + 2] + (a[j * 3 + 2] - a[i * 3 + 2]) * f,
  );
}

/** Circular box filter. */
/** Running maximum over ±r samples (wrapping). */
function dilate(src: Float32Array, r: number) {
  const n = src.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = -r; k <= r; k++) m = Math.max(m, src[(i + k + n) % n]);
    out[i] = m;
  }
  return out;
}

function smooth(src: Float32Array, r: number) {
  const n = src.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[(i + k + n) % n];
    out[i] = s / (2 * r + 1);
  }
  return out;
}
