/**
 * Official 2025-02 Cap Baseball field constants & geometry helpers.
 * Reference: 瓶蓋棒球規則 2025 年 2 月版 (pp. 2-4, 42).
 *
 * Field3D coordinates (X: right +, Y: up +, Z: toward pitcher/outfield -):
 *   Home plate tip = (0, 0, 0)
 *   1B foul line: x = -z (z <= 0, x >= 0)
 *   3B foul line: x =  z (z <= 0, x <= 0)
 *   Pitcher mound: z = -9.22
 *   Outfield fence arc: radius 13.0m from (0, 0), height 0.75m
 *   Pass line (捕逸線): z = +2.334m
 */

export const MOUND_DIST = 9.22;
export const MOUND_WIDTH = 0.61;
export const FENCE_DIST = 13.0;
export const FENCE_HEIGHT = 0.75; // 70-80cm per 2025-02 rules
export const INFIELD_FOUL_DIST = 8.0;
export const PASS_LINE_Z = 2.334; // 0.534 + 1.80
export const PLATE_WIDTH = 0.432;
export const STRIKE_ZONE_LO = 0.42;
export const STRIKE_ZONE_HI = 1.02;

const S45 = Math.SQRT1_2;
const INFIELD_CORNER = INFIELD_FOUL_DIST * S45; // ~5.656854

/**
 * Returns true if (x, z) is in fair territory (between or on the 45-degree foul lines, z <= 0).
 */
export function isFair(x: number, z: number): boolean {
  return z < 0 && Math.abs(x) <= -z + 1e-9;
}

/**
 * Returns true if (x, z) is inside the official infield polygon:
 *   (0, 0) -> (-8*s45, -8*s45) -> (0, -9.22) -> (8*s45, -8*s45) -> (0, 0)
 */
export function isInfield(x: number, z: number): boolean {
  if (z >= 0) return false;
  const ax = Math.abs(x);
  if (ax > INFIELD_CORNER + 1e-9) return false;
  // Must be above/inside the foul lines: z <= -ax
  if (z > -ax + 1e-9) return false;
  // Upper boundary from (0, -MOUND_DIST) to (INFIELD_CORNER, -INFIELD_CORNER)
  const slope = (-INFIELD_CORNER - -MOUND_DIST) / INFIELD_CORNER;
  const zMin = -MOUND_DIST + slope * ax;
  return z >= zMin - 1e-9;
}

/**
 * Returns true if (x, z) is in fair outfield territory (fair, outside infield, within or at fence).
 */
export function isOutfield(x: number, z: number): boolean {
  return isFair(x, z) && !isInfield(x, z) && Math.hypot(x, z) <= FENCE_DIST + 1e-9;
}

/**
 * Returns true if (x, z) has crossed the fence extension line
 * (perpendicular to the foul lines at 13.0m extending outward).
 */
export function isPastFenceExtension(x: number, z: number): boolean {
  if (z >= 0) return false;
  if (isFair(x, z)) {
    return Math.hypot(x, z) >= FENCE_DIST;
  }
  // In foul territory: perpendicular to the 45-deg foul line at 13.0m
  return (Math.abs(x) - z) * S45 >= FENCE_DIST;
}

/**
 * Returns true if (x, y) at the plate plane is inside the official strike zone.
 */
export function isInStrikeZone(x: number, y: number): boolean {
  return (
    Math.abs(x) <= PLATE_WIDTH * 0.5 &&
    y >= STRIKE_ZONE_LO &&
    y <= STRIKE_ZONE_HI
  );
}
