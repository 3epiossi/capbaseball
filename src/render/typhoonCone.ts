/**
 * 2D Typhoon Cone of Uncertainty (颱風路徑潛勢包絡帶) for Hit-Plane Pitch Control.
 *
 * Computes the EXACT, 100%-continuous outer contour of the union of tapered capsules
 * along the entire SOFT -> BEST -> OVER landing track using an analytical uneven-capsule SDF
 * + sub-pixel Marching Squares contour tracer (cached by quantized circle geometry):
 *   - True C1-continuous hourglass shape: wide blue SOFT end -> razor-tight gold BEST waist -> wide red OVER end
 *   - ZERO discrete circle-pruning pops or sudden shape jumps while dragging aim
 *   - Single-pass speed-gradient translucent fill + crisp dashed outer boundary
 */

import {
  SPRING_BEST_CENTER,
  springColorAt,
  springColorRgba,
} from './speedRibbon';

export const CAP_PHYSICAL_RADIUS_M = 0.0155;
const ELLIPSE_ASPECT_Y = 0.85;

export interface TyphoonSample {
  /** Normalized spring spectrum position u in [0, 1] */
  u: number;
  /** Screen-space X (device px) */
  sx: number;
  /** Screen-space Y (device px) */
  sy: number;
  /** Projected scale (device px per meter) at hit plane */
  scale: number;
  /** Max 2D scatter radius in meters (from springMaxScatterM) */
  maxScatterM: number;
}

interface NormCircle {
  u: number;
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
}

/**
 * Exact 100% uniform-disk envelope radius in screen pixels (scatter radius + physical cap radius).
 */
export function typhoonRadiusPx(maxScatterM: number, scalePxPerM: number, dpr: number): number {
  const physM = Math.max(0, maxScatterM) + CAP_PHYSICAL_RADIUS_M;
  return Math.max(8.5 * dpr, physM * scalePxPerM);
}

/**
 * Exact analytical signed distance to the tapered capsule (2-circle convex hull) joining A and B.
 * Negative inside, 0 on exact outer boundary, positive outside.
 */
function sdUnevenCapsule(
  px: number,
  py: number,
  ax: number,
  ay: number,
  ra: number,
  bx: number,
  by: number,
  rb: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len <= Math.abs(ra - rb) + 1e-4) {
    return ra >= rb
      ? Math.hypot(px - ax, py - ay) - ra
      : Math.hypot(px - bx, py - by) - rb;
  }

  const ex = dx / len;
  const ey = dy / len;
  const qx = px - ax;
  const qy = py - ay;
  const u = qx * ex + qy * ey;
  const v = Math.abs(-qx * ey + qy * ex);

  const sinBeta = (ra - rb) / len;
  const cosBeta = Math.sqrt(Math.max(0, 1 - sinBeta * sinBeta));

  if (u < ra * sinBeta) {
    return Math.hypot(u, v) - ra;
  }
  if (u > len + rb * sinBeta) {
    return Math.hypot(u - len, v) - rb;
  }
  return v * cosBeta + u * sinBeta - ra;
}

function evalUnionSdf(px: number, py: number, circles: NormCircle[]): number {
  let minD = Infinity;
  for (let i = 0; i < circles.length - 1; i++) {
    const a = circles[i];
    const b = circles[i + 1];
    const d = sdUnevenCapsule(px, py, a.x, a.y, a.r, b.x, b.y, b.r);
    if (d < minD) minD = d;
  }
  return minD;
}

// Single-entry cache so idle frames cost 0.000ms while aim isn't moving
let cachedContourKey = '';
let cachedContourLoops: [number, number][][] = [];

function buildCacheKey(circles: NormCircle[]): string {
  // Quantize to 0.5px at 5 anchor indices so subtle drags trigger immediate smooth recompute
  const n = circles.length;
  const idxs = [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1];
  let key = `${n}`;
  for (const idx of idxs) {
    const c = circles[idx];
    key += `|${Math.round(c.x * 2)},${Math.round(c.y * 2)},${Math.round(c.r * 2)}`;
  }
  return key;
}

/**
 * Traces exact sub-pixel closed contour loop(s) of { (x, y) : evalUnionSdf(x, y) = 0 }
 * using Marching Squares with integer grid-edge stitching + 1 pass light Chaikin smoothing.
 */
function traceUnionContourLoops(circles: NormCircle[]): [number, number][][] {
  const key = buildCacheKey(circles);
  if (key === cachedContourKey) {
    return cachedContourLoops;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of circles) {
    if (c.x - c.r < minX) minX = c.x - c.r;
    if (c.x + c.r > maxX) maxX = c.x + c.r;
    if (c.y - c.r < minY) minY = c.y - c.r;
    if (c.y + c.r > maxY) maxY = c.y + c.r;
  }

  const spanX = Math.max(8, maxX - minX);
  const spanY = Math.max(8, maxY - minY);
  const maxSpan = Math.max(spanX, spanY);

  // Adaptive resolution: ~46 cells along the longest axis, guaranteed positive margin outside
  const targetCells = 46;
  const cellSize = maxSpan / targetCells;
  const pad = cellSize * 2.2;
  const ox = minX - pad;
  const oy = minY - pad;
  const nx = Math.max(12, Math.min(64, Math.ceil((spanX + pad * 2) / cellSize)));
  const ny = Math.max(12, Math.min(64, Math.ceil((spanY + pad * 2) / cellSize)));
  const dx = (spanX + pad * 2) / nx;
  const dy = (spanY + pad * 2) / ny;

  const stride = nx + 1;
  const grid = new Float32Array((nx + 1) * (ny + 1));
  for (let iy = 0; iy <= ny; iy++) {
    const py = oy + iy * dy;
    const rowOff = iy * stride;
    for (let ix = 0; ix <= nx; ix++) {
      grid[rowOff + ix] = evalUnionSdf(ox + ix * dx, py, circles);
    }
  }

  // Integer keys for shared grid edges:
  //   horiz edge (ix, iy) -> (iy * stride + ix) * 2
  //   vert  edge (ix, iy) -> (iy * stride + ix) * 2 + 1
  const edgePts = new Map<number, [number, number]>();
  const nextEdge = new Map<number, number>();

  const horizEdgePt = (ix: number, iy: number, v0: number, v1: number): number => {
    const k = (iy * stride + ix) * 2;
    if (!edgePts.has(k)) {
      const denom = v0 - v1;
      const t = Math.abs(denom) > 1e-8 ? Math.max(0.001, Math.min(0.999, v0 / denom)) : 0.5;
      edgePts.set(k, [ox + (ix + t) * dx, oy + iy * dy]);
    }
    return k;
  };

  const vertEdgePt = (ix: number, iy: number, v0: number, v1: number): number => {
    const k = (iy * stride + ix) * 2 + 1;
    if (!edgePts.has(k)) {
      const denom = v0 - v1;
      const t = Math.abs(denom) > 1e-8 ? Math.max(0.001, Math.min(0.999, v0 / denom)) : 0.5;
      edgePts.set(k, [ox + ix * dx, oy + (iy + t) * dy]);
    }
    return k;
  };

  for (let iy = 0; iy < ny; iy++) {
    const r0 = iy * stride;
    const r1 = (iy + 1) * stride;
    for (let ix = 0; ix < nx; ix++) {
      const vTL = grid[r0 + ix];
      const vTR = grid[r0 + ix + 1];
      const vBR = grid[r1 + ix + 1];
      const vBL = grid[r1 + ix];

      const mask =
        (vTL < 0 ? 8 : 0) |
        (vTR < 0 ? 4 : 0) |
        (vBR < 0 ? 2 : 0) |
        (vBL < 0 ? 1 : 0);

      if (mask === 0 || mask === 15) continue;

      const eTop = () => horizEdgePt(ix, iy, vTL, vTR);
      const eRight = () => vertEdgePt(ix + 1, iy, vTR, vBR);
      const eBot = () => horizEdgePt(ix, iy + 1, vBL, vBR);
      const eLeft = () => vertEdgePt(ix, iy, vTL, vBL);

      switch (mask) {
        case 1: nextEdge.set(eLeft(), eBot()); break;
        case 2: nextEdge.set(eBot(), eRight()); break;
        case 3: nextEdge.set(eLeft(), eRight()); break;
        case 4: nextEdge.set(eRight(), eTop()); break;
        case 5:
          if (vTL + vTR + vBR + vBL < 0) {
            nextEdge.set(eLeft(), eTop());
            nextEdge.set(eRight(), eBot());
          } else {
            nextEdge.set(eRight(), eTop());
            nextEdge.set(eLeft(), eBot());
          }
          break;
        case 6: nextEdge.set(eBot(), eTop()); break;
        case 7: nextEdge.set(eLeft(), eTop()); break;
        case 8: nextEdge.set(eTop(), eLeft()); break;
        case 9: nextEdge.set(eTop(), eBot()); break;
        case 10:
          if (vTL + vTR + vBR + vBL < 0) {
            nextEdge.set(eTop(), eRight());
            nextEdge.set(eBot(), eLeft());
          } else {
            nextEdge.set(eTop(), eLeft());
            nextEdge.set(eBot(), eRight());
          }
          break;
        case 11: nextEdge.set(eTop(), eRight()); break;
        case 12: nextEdge.set(eRight(), eLeft()); break;
        case 13: nextEdge.set(eRight(), eBot()); break;
        case 14: nextEdge.set(eBot(), eLeft()); break;
      }
    }
  }

  // Stitch directed edge transitions into closed screen-space polygon loops
  const visited = new Set<number>();
  const loops: [number, number][][] = [];

  for (const startKey of nextEdge.keys()) {
    if (visited.has(startKey)) continue;
    const rawLoop: [number, number][] = [];
    let curr: number | undefined = startKey;
    let safety = 0;
    while (curr !== undefined && !visited.has(curr) && safety++ < 4096) {
      visited.add(curr);
      const pt = edgePts.get(curr);
      if (pt) rawLoop.push(pt);
      curr = nextEdge.get(curr);
    }
    if (rawLoop.length < 4) continue;

    // 1 light Laplacian smoothing pass in normalized space removes any tiny grid quantization jitter
    const m = rawLoop.length;
    const smooth: [number, number][] = new Array(m);
    for (let i = 0; i < m; i++) {
      const prev = rawLoop[(i - 1 + m) % m];
      const cur = rawLoop[i];
      const next = rawLoop[(i + 1) % m];
      const sx = prev[0] * 0.22 + cur[0] * 0.56 + next[0] * 0.22;
      const sy = (prev[1] * 0.22 + cur[1] * 0.56 + next[1] * 0.22) * ELLIPSE_ASPECT_Y;
      smooth[i] = [sx, sy];
    }
    loops.push(smooth);
  }

  cachedContourKey = key;
  cachedContourLoops = loops;
  return loops;
}

/**
 * Traces a C1-smooth closed Catmull-Rom cubic Bezier loop through polygon points
 * (subsamples dense marching-squares loops by stride 2 for silky Manim vector elegance).
 */
function traceSmoothClosedLoop(ctx: CanvasRenderingContext2D, poly: [number, number][]): void {
  const step = poly.length > 48 ? 2 : 1;
  const pts: [number, number][] = step === 1 ? poly : [];
  if (step > 1) {
    for (let i = 0; i < poly.length; i += step) {
      pts.push(poly[i]);
    }
  }
  const n = pts.length;
  if (n < 3) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx.closePath();
}

/**
 * Draws the 3Blue1Brown / Manim-styled continuous luminous Typhoon Cone across the hit-plane landing track.
 * - Breaking balls: silky closed Bezier hourglass (Manim Blue SOFT -> Gold BEST eye -> Coral-Red OVER)
 *   with luminous continuous solid stroke (soft bloom + crisp bright core, zero heavy dark outlines)
 * - Straight / overlapping pitches: concentric luminous Manim rings (Gold eye + Blue SOFT + Coral OVER)
 */
export function drawTyphoonCone(
  ctx: CanvasRenderingContext2D,
  samples: TyphoonSample[],
  dpr: number,
  alphaScale = 1.0,
): void {
  if (samples.length < 2 || alphaScale <= 0.015) return;

  const circles: NormCircle[] = samples.map((s) => ({
    u: s.u,
    x: s.sx,
    y: s.sy / ELLIPSE_ASPECT_Y,
    r: typhoonRadiusPx(s.maxScatterM, s.scale, dpr),
    sx: s.sx,
    sy: s.sy,
  }));

  const slowC = circles[0];
  const fastC = circles[circles.length - 1];
  const bestSample = samples.reduce((best, s) =>
    Math.abs(s.u - SPRING_BEST_CENTER) < Math.abs(best.u - SPRING_BEST_CENTER) ? s : best,
  );
  const bestR = typhoonRadiusPx(bestSample.maxScatterM, bestSample.scale, dpr);

  const slowInsideFast =
    Math.hypot(fastC.x - slowC.x, fastC.y - slowC.y) + slowC.r <= fastC.r + 1.5 * dpr;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const drawLuminousEllipse = (
    cx: number,
    cy: number,
    rx: number,
    rgb: readonly [number, number, number],
    fillAlpha: number,
    strokeAlpha: number,
    coreWidthDpr: number,
  ) => {
    const ry = rx * ELLIPSE_ASPECT_Y;
    const [r, g, b] = rgb;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (fillAlpha > 0.005) {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(fillAlpha * alphaScale).toFixed(3)})`;
      ctx.fill();
    }
    // Soft Manim bloom halo (pure vector pass, zero shadowBlur)
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(strokeAlpha * 0.28 * alphaScale).toFixed(3)})`;
    ctx.lineWidth = (coreWidthDpr * 3.1) * dpr;
    ctx.stroke();
    // Crisp Manim solid ring
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(strokeAlpha * alphaScale).toFixed(3)})`;
    ctx.lineWidth = coreWidthDpr * dpr;
    ctx.stroke();
    // Delicate specular white core
    ctx.strokeStyle = `rgba(255, 255, 255, ${(strokeAlpha * 0.34 * alphaScale).toFixed(3)})`;
    ctx.lineWidth = Math.max(0.5, coreWidthDpr * 0.42) * dpr;
    ctx.stroke();
  };

  if (slowInsideFast) {
    // --- Concentric Manim Luminous Rings (Straight Fastball / overlapping endpoints) ---
    // 1. Outer Coral-Red OVER ring (#FC6255)
    drawLuminousEllipse(fastC.sx, fastC.sy, fastC.r, [252, 98, 85], 0.055, 0.82, 1.3);
    // 2. Middle Manim Blue SOFT ring (#58C4DD)
    drawLuminousEllipse(slowC.sx, slowC.sy, slowC.r, [88, 196, 221], 0.055, 0.84, 1.25);
    // 3. Inner Manim Gold BEST focal eye (#F7D060)
    drawLuminousEllipse(bestSample.sx, bestSample.sy, bestR, [247, 208, 96], 0.14, 0.90, 1.25);
  } else {
    // --- Silky Continuous Hourglass Manim Envelope (Changeup / Curveball / Slider) ---
    const loops = traceUnionContourLoops(circles);
    if (loops.length > 0) {
      const spanPx = Math.hypot(fastC.sx - slowC.sx, fastC.sy - slowC.sy);
      const makeGrad = (a0: number, a1: number, a2: number, a3: number) => {
        if (spanPx <= 4) return null;
        const g = ctx.createLinearGradient(slowC.sx, slowC.sy, fastC.sx, fastC.sy);
        g.addColorStop(0.0, `rgba(88, 196, 221, ${(a0 * alphaScale).toFixed(3)})`);
        g.addColorStop(0.48, `rgba(92, 208, 179, ${(a1 * alphaScale).toFixed(3)})`);
        g.addColorStop(SPRING_BEST_CENTER, `rgba(247, 208, 96, ${(a2 * alphaScale).toFixed(3)})`);
        g.addColorStop(1.0, `rgba(252, 98, 85, ${(a3 * alphaScale).toFixed(3)})`);
        return g;
      };

      const fillGrad = makeGrad(0.095, 0.068, 0.088, 0.075);
      const haloGrad = makeGrad(0.24, 0.20, 0.26, 0.24);
      const coreGrad = makeGrad(0.88, 0.78, 0.90, 0.86);

      const traceAllLoops = () => {
        ctx.beginPath();
        for (const poly of loops) {
          traceSmoothClosedLoop(ctx, poly);
        }
      };

      // 1. Single-pass silky translucent speed-gradient fill
      traceAllLoops();
      ctx.fillStyle = fillGrad ?? `rgba(252, 98, 85, ${(0.075 * alphaScale).toFixed(3)})`;
      ctx.fill();

      // 2. Manim luminous continuous solid outline: soft bloom -> bright core -> whisper white highlight
      traceAllLoops();
      ctx.strokeStyle = haloGrad ?? `rgba(252, 98, 85, ${(0.24 * alphaScale).toFixed(3)})`;
      ctx.lineWidth = 4.2 * dpr;
      ctx.stroke();

      traceAllLoops();
      ctx.strokeStyle = coreGrad ?? `rgba(252, 98, 85, ${(0.86 * alphaScale).toFixed(3)})`;
      ctx.lineWidth = 1.35 * dpr;
      ctx.stroke();

      traceAllLoops();
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.30 * alphaScale).toFixed(3)})`;
      ctx.lineWidth = 0.55 * dpr;
      ctx.stroke();
    }

    // 3. Delicate Manim Gold BEST focal eye right at the narrow hourglass waist
    drawLuminousEllipse(bestSample.sx, bestSample.sy, bestR, [247, 208, 96], 0.13, 0.84, 1.15);
  }

  ctx.restore();
}

/**
 * Draws the live spring-linked Manim luminous landing circle after releasing the spring,
 * plus an optional expanding Manim `Indicate` golden ripple ring when hitting/locking BEST.
 */
export function drawDynamicStormCircle(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  activeU: number,
  maxScatterM: number,
  scalePxPerM: number,
  dpr: number,
  alphaScale = 1.0,
  bestIndicateProgress: number | null = null,
): void {
  if (alphaScale <= 0.015) return;
  const rx = typhoonRadiusPx(maxScatterM, scalePxPerM, dpr);
  const ry = rx * ELLIPSE_ASPECT_Y;
  const [r, g, b] = springColorAt(activeU);
  const isBest = maxScatterM <= 0.018;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Clean uniform translucent tint matching 100% uniform-in-disk pitch control distribution
  const fillAlpha = (isBest ? 0.16 : 0.095) * alphaScale;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillAlpha.toFixed(3)})`;
  ctx.fill();

  // Manim 3-layer luminous solid boundary (soft outer bloom -> rich main ring -> delicate white core)
  ctx.strokeStyle = springColorRgba(activeU, (isBest ? 0.34 : 0.26) * alphaScale);
  ctx.lineWidth = (isBest ? 5.6 : 4.6) * dpr;
  ctx.stroke();

  ctx.strokeStyle = springColorRgba(activeU, (isBest ? 0.96 : 0.90) * alphaScale);
  ctx.lineWidth = (isBest ? 1.85 : 1.45) * dpr;
  ctx.stroke();

  ctx.strokeStyle = `rgba(255, 255, 255, ${((isBest ? 0.65 : 0.38) * alphaScale).toFixed(3)})`;
  ctx.lineWidth = (isBest ? 0.75 : 0.55) * dpr;
  ctx.stroke();

  // Optional Manim `Indicate` expanding golden ripple wave when entering/locking BEST sweet spot!
  if (bestIndicateProgress !== null && bestIndicateProgress > 0 && bestIndicateProgress < 1) {
    const ease = 1 - Math.pow(1 - bestIndicateProgress, 2.4);
    const waveAlpha = (1 - ease) * 0.88 * alphaScale;
    const waveRx = rx * (1.05 + ease * 1.25);
    const waveRy = waveRx * ELLIPSE_ASPECT_Y;

    ctx.beginPath();
    ctx.ellipse(sx, sy, waveRx, waveRy, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(247, 208, 96, ${(waveAlpha * 0.38).toFixed(3)})`;
    ctx.lineWidth = 4.2 * dpr;
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 244, 196, ${waveAlpha.toFixed(3)})`;
    ctx.lineWidth = 1.4 * dpr;
    ctx.stroke();
  }

  ctx.restore();
}
