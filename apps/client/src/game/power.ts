import { CUE_MAX_SPEED, CUE_MIN_SPEED } from '@billiards/physics';

/** Skala power terkunci: 1,0 – 5,0 dengan langkah 0,1. */
export const POWER_MIN = 1;
export const POWER_MAX = 5;
export const POWER_STEP = 0.1;
/** Kecepatan stik (m/s) untuk level power: kurva pangkat 1,8 agar pukulan pelan tetap presisi. */
export function powerSpeed(level: number): number {
  return Math.max(CUE_MIN_SPEED, CUE_MAX_SPEED * Math.pow(level / POWER_MAX, 1.8));
}
