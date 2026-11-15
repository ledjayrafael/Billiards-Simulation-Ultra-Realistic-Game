import { describe, expect, it } from 'vitest';
import { BALL_RADIUS as R, TABLE_LENGTH } from '@billiards/physics';
import { MIN_ELEV, clearance, minElevation, obstaclesBehind, resolveStroke } from '../src/game/cueClearance';

const HL = TABLE_LENGTH / 2;
const DEG = Math.PI / 180;
/** cue ball `gap` m dari cushion kanan, bidik ke kiri → stik melewati rail kanan */
const nearRail = (gap: number) => obstaclesBehind(HL - R - gap, 0, Math.PI, 0);

describe('celah stik di atas rail', () => {
  it('bola menempel rail: center ball butuh elevasi besar, follow menurunkannya', () => {
    const obs = nearRail(0);
    const center = minElevation(obs, 0, 0);
    const follow = minElevation(obs, 0, 0.45);
    expect(center).toBeGreaterThan(25 * DEG);
    expect(follow).toBeLessThan(12 * DEG);
    expect(minElevation(obs, 0, -0.4)).toBeGreaterThan(center);
  });

  it('jauh dari rail: stik boleh datar dengan titik pukul apa pun', () => {
    const obs = obstaclesBehind(0, 0, Math.PI, 0);
    expect(minElevation(obs, 0, -0.5)).toBe(MIN_ELEV);
  });

  it('stik didatarkan (prioritas elevasi) → titik pukul naik (follow) & tetap lolos rail', () => {
    for (const gap of [0.15, 0.25, 0.4]) {
      const s = resolveStroke(HL - R - gap, 0, Math.PI, 0, 0, 0, 'elev', 0.45);
      expect(s.elevation).toBeCloseTo(MIN_ELEV, 6);
      expect(s.railFollow).toBe(true);
      expect(s.tipY).toBeGreaterThan(0);
      expect(s.tipY).toBeLessThanOrEqual(0.45 + 1e-9);
      expect(clearance(nearRail(gap), 0, s.tipY, s.elevation)).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('follow maksimum belum cukup → elevasi ikut naik secukupnya', () => {
    const s = resolveStroke(HL - R, 0, Math.PI, 0, 0, 0, 'elev', 0.45);
    expect(s.tipY).toBeCloseTo(0.45, 6);
    expect(s.elevation).toBeGreaterThan(MIN_ELEV);
    expect(clearance(nearRail(0), 0, s.tipY, s.elevation)).toBeGreaterThanOrEqual(-1e-6);
  });

  it('prioritas titik pukul: draw dipertahankan, elevasi yang naik', () => {
    const s = resolveStroke(HL - R - 0.1, 0, Math.PI, 0, -0.3, 0, 'tip', 0.45);
    expect(s.tipY).toBe(-0.3);
    expect(s.railElev).toBe(true);
    expect(clearance(nearRail(0.1), 0, -0.3, s.elevation)).toBeGreaterThanOrEqual(-1e-6);
  });
});
