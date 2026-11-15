import type { PhysicsParams } from './constants';
import { dcos, dsin, dtan } from './dmath';

const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);

/** Segmen cushion (garis nose atau muka jaw). m = normal satuan keluar dari karet (ke arah bola). */
export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** arah satuan a→b */
  dx: number;
  dy: number;
  len: number;
  mx: number;
  my: number;
  cushion: number;
  jaw: boolean;
}

/** Ujung bulat jaw (fillet antara nose dan muka jaw). */
export interface Arc {
  cx: number;
  cy: number;
  r: number;
  cushion: number;
}

export interface Pocket {
  cx: number;
  cy: number;
  r: number;
  corner: boolean;
}

export interface CushionOutline {
  /** jawBackA, tipA, tipB, jawBackB (tanpa fillet) — dipakai Blender/debug viewer. */
  pts: [number, number][];
  nx: number;
  ny: number;
}

export interface TableGeometry {
  segments: Segment[];
  arcs: Arc[];
  pockets: Pocket[];
  outlines: CushionOutline[];
}

function seg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  mx: number,
  my: number,
  cushion: number,
  jaw: boolean,
): Segment {
  const len = hyp(bx - ax, by - ay);
  return { ax, ay, bx, by, dx: (bx - ax) / len, dy: (by - ay) / len, len, mx, my, cushion, jaw };
}

/**
 * Bangun geometri 2D meja. Urutan cushion (dilihat dari atas, +y di atas, +x kanan):
 * 0: rail +y kiri (x<0), 1: rail +y kanan, 2: rail +x (kaki), 3: rail −y kanan, 4: rail −y kiri, 5: rail −x (kepala).
 * Pocket: 0: sudut (−x,+y), 1: side +y, 2: sudut (+x,+y), 3: sudut (+x,−y), 4: side −y, 5: sudut (−x,−y).
 */
export function buildTable(P: PhysicsParams): TableGeometry {
  const hl = P.L / 2;
  const hw = P.W / 2;
  const c = P.cornerMouth / Math.SQRT2;
  const s = P.sideMouth / 2;
  const segments: Segment[] = [];
  const arcs: Arc[] = [];
  const outlines: CushionOutline[] = [];

  // tiap cushion: tip A → tip B, normal luar n, sudut jaw di A dan B
  const defs: [number, number, number, number, number, number, number, number][] = [
    // ax, ay, bx, by, nx, ny, angleA, angleB
    [-hl + c, hw, -s, hw, 0, 1, P.cornerJawAngle, P.sideJawAngle],
    [s, hw, hl - c, hw, 0, 1, P.sideJawAngle, P.cornerJawAngle],
    [hl, hw - c, hl, -hw + c, 1, 0, P.cornerJawAngle, P.cornerJawAngle],
    [hl - c, -hw, s, -hw, 0, -1, P.cornerJawAngle, P.sideJawAngle],
    [-s, -hw, -hl + c, -hw, 0, -1, P.sideJawAngle, P.cornerJawAngle],
    [-hl, -hw + c, -hl, hw - c, -1, 0, P.cornerJawAngle, P.cornerJawAngle],
  ];
  const rt = P.jawTipRadius;
  defs.forEach(([ax, ay, bx, by, nx, ny, angA, angB], ci) => {
    const len = hyp(bx - ax, by - ay);
    const dx = (bx - ax) / len;
    const dy = (by - ay) / len;
    const betaA = Math.PI - angA;
    const betaB = Math.PI - angB;
    // arah jaw menjauhi tip (ke belakang, menuju rail)
    const jAx = -dx * dcos(betaA) + nx * dsin(betaA);
    const jAy = -dy * dcos(betaA) + ny * dsin(betaA);
    const jBx = dx * dcos(betaB) + nx * dsin(betaB);
    const jBy = dy * dcos(betaB) + ny * dsin(betaB);
    const lenA = P.cushionWidth / dsin(betaA);
    const lenB = P.cushionWidth / dsin(betaB);
    const backA: [number, number] = [ax + jAx * lenA, ay + jAy * lenA];
    const backB: [number, number] = [bx + jBx * lenB, by + jBy * lenB];
    outlines.push({ pts: [backA, [ax, ay], [bx, by], backB], nx, ny });
    // fillet
    const trimA = rt / dtan(angA / 2);
    const trimB = rt / dtan(angB / 2);
    // nose (dipangkas)
    segments.push(
      seg(ax + dx * trimA, ay + dy * trimA, bx - dx * trimB, by - dy * trimB, -nx, -ny, ci, false),
    );
    // muka jaw A: normal keluar karet = −d sinβ − n cosβ
    segments.push(
      seg(
        backA[0],
        backA[1],
        ax + jAx * trimA,
        ay + jAy * trimA,
        -dx * dsin(betaA) - nx * dcos(betaA),
        -dy * dsin(betaA) - ny * dcos(betaA),
        ci,
        true,
      ),
    );
    segments.push(
      seg(
        bx + jBx * trimB,
        by + jBy * trimB,
        backB[0],
        backB[1],
        dx * dsin(betaB) - nx * dcos(betaB),
        dy * dsin(betaB) - ny * dcos(betaB),
        ci,
        true,
      ),
    );
    // pusat fillet: tip + bisektor(ke dalam karet) * rt / sin(α/2)
    {
      let bxx = dx + jAx;
      let byy = dy + jAy;
      const bl = hyp(bxx, byy);
      bxx /= bl;
      byy /= bl;
      const k = rt / dsin(angA / 2);
      arcs.push({ cx: ax + bxx * k, cy: ay + byy * k, r: rt, cushion: ci });
    }
    {
      let bxx = -dx + jBx;
      let byy = -dy + jBy;
      const bl = hyp(bxx, byy);
      bxx /= bl;
      byy /= bl;
      const k = rt / dsin(angB / 2);
      arcs.push({ cx: bx + bxx * k, cy: by + byy * k, r: rt, cushion: ci });
    }
  });

  const co = (c / 2 - (P.cornerShelf + P.cornerPocketRadius) / Math.SQRT2) * -1; // offset pusat pocket sudut dari titik sudut
  const so = P.sideShelf + P.sidePocketRadius;
  const pockets: Pocket[] = [
    { cx: -hl - co, cy: hw + co, r: P.cornerPocketRadius, corner: true },
    { cx: 0, cy: hw + so, r: P.sidePocketRadius, corner: false },
    { cx: hl + co, cy: hw + co, r: P.cornerPocketRadius, corner: true },
    { cx: hl + co, cy: -hw - co, r: P.cornerPocketRadius, corner: true },
    { cx: 0, cy: -hw - so, r: P.sidePocketRadius, corner: false },
    { cx: -hl - co, cy: -hw - co, r: P.cornerPocketRadius, corner: true },
  ];
  return { segments, arcs, pockets, outlines };
}
