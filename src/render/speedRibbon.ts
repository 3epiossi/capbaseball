/**
 * 3D Speed-Sweep Trajectory Ribbon (速度漸層軌跡曲面)
 *
 * Shared by both the main game pitcher preview (FieldV3) and 3D Pitch Lab (Sim V3).
 * Aligns color stops directly with the Spring Launcher spectrum:
 *   NORMAL (Blue -> Cyan) -> BEST (Emerald -> Gold) -> OVER (Orange -> Crimson)
 */

export type Point3 = readonly [number, number, number];

export interface SpeedRibbonCurve<P extends Point3 = [number, number, number]> {
  /** Normalized position u in [0, 1] matching the spring meter spectrum */
  u: number;
  /** Pitch speed in km/h for this curve */
  speedKmh: number;
  /** Uniformly parameterized 3D points from release (index 0) to hit plane (last index) */
  points: P[];
  /** Exact hit-plane landing 3D point */
  landing: P;
}

export interface SpeedRibbonData<P extends Point3 = [number, number, number]> {
  /** Curves sorted ascending by u (0 = slowest NORMAL, 0.74 = BEST center, 1 = max OVER) */
  curves: SpeedRibbonCurve<P>[];
}

export interface ProjectedPoint {
  sx: number;
  sy: number;
  depth: number;
  ok: boolean;
}

/**
 * Shared spring spectrum zone thresholds & continuous C1-smooth scatter curve:
 *   0.00..0.62 = SOFT, 0.62..0.82 = BEST (center 0.72), 0.82..1.00 = OVER
 */
export const SPRING_BEST_START = 0.62;
export const SPRING_BEST_CENTER = 0.72;
export const SPRING_OVER_START = 0.82;
/** Uniform-disk max scatter radii (100% of pitches land strictly inside the drawn circle) */
export const SPRING_SOFT_MAX_SCATTER_M = 0.113;
export const SPRING_OVER_MAX_SCATTER_M = 0.169;

/**
 * Continuous C1-smooth uniform-disk control scatter curve across SOFT -> BEST -> OVER.
 * Minimum (0.000m) at BEST center (0.72), smoothly increasing toward BOTH ends:
 *   - SOFT (u -> 0): up to 0.113m (11.3 cm)
 *   - OVER (u -> 1): up to 0.169m (16.9 cm)
 */
export function springMaxScatterM(rawU: number): number {
  const u = Math.max(0, Math.min(1, rawU));
  if (u <= SPRING_BEST_CENTER) {
    const d = (SPRING_BEST_CENTER - u) / SPRING_BEST_CENTER;
    return SPRING_SOFT_MAX_SCATTER_M * Math.pow(d, 1.8);
  }
  const d = (u - SPRING_BEST_CENTER) / (1 - SPRING_BEST_CENTER);
  return SPRING_OVER_MAX_SCATTER_M * Math.pow(d, 2.3);
}

/**
 * 6 sample stops aligned with the spring meter zone boundaries:
 *   0.00..0.62 = SOFT, 0.62..0.82 = BEST (center 0.72), 0.82..1.00 = OVER
 */
export const RIBBON_SPRING_STOPS: readonly number[] = [
  0.0, 0.25, 0.5, SPRING_BEST_START, SPRING_BEST_CENTER, 1.0,
];

interface ColorStop {
  u: number;
  rgb: readonly [number, number, number];
}

const SPRING_COLOR_STOPS: readonly ColorStop[] = [
  { u: 0.0, rgb: [41, 171, 202] },                 // #29ABCA Manim BLUE_D (max SOFT)
  { u: 0.35, rgb: [88, 196, 221] },                // #58C4DD Manim BLUE_C (mid SOFT)
  { u: SPRING_BEST_START, rgb: [92, 208, 179] },   // #5CD0B3 Manim TEAL_C (BEST start)
  { u: SPRING_BEST_CENTER, rgb: [247, 208, 96] },  // #F7D060 Manim GOLD_A (BEST sweet spot)
  { u: SPRING_OVER_START, rgb: [240, 172, 95] },   // #F0AC5F Manim GOLD_D (OVER start)
  { u: 1.0, rgb: [252, 98, 85] },                  // #FC6255 Manim RED_C (max OVER)
];

export function springColorAt(u: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, u));
  for (let i = 1; i < SPRING_COLOR_STOPS.length; i++) {
    const a = SPRING_COLOR_STOPS[i - 1];
    const b = SPRING_COLOR_STOPS[i];
    if (clamped <= b.u) {
      const span = Math.max(1e-6, b.u - a.u);
      const t = (clamped - a.u) / span;
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }
  const last = SPRING_COLOR_STOPS[SPRING_COLOR_STOPS.length - 1].rgb;
  return [last[0], last[1], last[2]];
}

export function springColorRgba(u: number, alpha: number): string {
  const [r, g, b] = springColorAt(u);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

export function interpolateRibbonAt<P extends Point3>(
  ribbon: SpeedRibbonData<P>,
  u: number,
): { points: [number, number, number][]; landing: [number, number, number]; speedKmh: number } | null {
  const curves = ribbon.curves;
  if (curves.length === 0) return null;
  const clamped = Math.max(curves[0].u, Math.min(curves[curves.length - 1].u, u));

  let hi = curves.length - 1;
  for (let i = 1; i < curves.length; i++) {
    if (clamped <= curves[i].u) {
      hi = i;
      break;
    }
  }
  const lo = Math.max(0, hi - 1);
  const c0 = curves[lo];
  const c1 = curves[hi];
  const span = Math.max(1e-6, c1.u - c0.u);
  const t = lo === hi ? 0 : (clamped - c0.u) / span;

  const len = Math.min(c0.points.length, c1.points.length);
  const points: [number, number, number][] = new Array(len);
  for (let j = 0; j < len; j++) {
    const p0 = c0.points[j];
    const p1 = c1.points[j];
    points[j] = [
      p0[0] + (p1[0] - p0[0]) * t,
      p0[1] + (p1[1] - p0[1]) * t,
      p0[2] + (p1[2] - p0[2]) * t,
    ];
  }
  const landing: [number, number, number] = [
    c0.landing[0] + (c1.landing[0] - c0.landing[0]) * t,
    c0.landing[1] + (c1.landing[1] - c0.landing[1]) * t,
    c0.landing[2] + (c1.landing[2] - c0.landing[2]) * t,
  ];
  const speedKmh = c0.speedKmh + (c1.speedKmh - c0.speedKmh) * t;
  return { points, landing, speedKmh };
}

export interface DrawSpeedRibbonOptions {
  /** Active spring u in [0, 1] when rebounding/locked (highlights that exact speed curve & landing spot) */
  activeU?: number | null;
  /** Draw a bold BEST center guide curve when activeU is null (default false; bold bounds emphasize slow/fast limits) */
  showIdleCenterCurve?: boolean;
  /** Draw the highlighted activeU trajectory curve & landing ring (default true) */
  showActiveCurve?: boolean;
  /** When true and activeU !== null, hide the full ribbon surface/bounds and draw ONLY the active trajectory */
  soloActiveCurve?: boolean;
  /** Draw the hit-plane color-gradient landing curve connecting all speeds (default true) */
  showLandingCurve?: boolean;
  /** Draw small slow/fast endpoint dots on the landing curve (default true; disable when caller draws dedicated reticles) */
  showLandingEndpoints?: boolean;
  /** Overall surface opacity multiplier (default 1.0) */
  surfaceAlphaScale?: number;
  /** Active solo curve opacity multiplier for smooth morph-in (default 1.0) */
  activeAlphaScale?: number;
  /** Subdivisions per adjacent curve pair for smooth continuous gradient shading (default 2) */
  subSteps?: number;
  /** Current clock in seconds for Manim ShowPassingFlash pulses along bounds (omit to disable motion) */
  timeSec?: number;
}

/**
 * Traces a C1-smooth Catmull-Rom cubic Bezier spline through screen-space points (zero polygon facets).
 */
function traceSmoothPolyline(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  ys: number[],
  startWithMoveTo: boolean,
): void {
  const n = xs.length;
  if (n === 0) return;
  if (startWithMoveTo) {
    ctx.moveTo(xs[0], ys[0]);
  } else {
    ctx.lineTo(xs[0], ys[0]);
  }
  if (n === 1) return;
  if (n === 2) {
    ctx.lineTo(xs[1], ys[1]);
    return;
  }
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = i;
    const i2 = i + 1;
    const i3 = Math.min(n - 1, i + 2);
    const cp1x = xs[i1] + (xs[i2] - xs[i0]) / 6;
    const cp1y = ys[i1] + (ys[i2] - ys[i0]) / 6;
    const cp2x = xs[i2] - (xs[i3] - xs[i1]) / 6;
    const cp2y = ys[i2] - (ys[i3] - ys[i1]) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, xs[i2], ys[i2]);
  }
}

/**
 * Lightweight Manim ShowPassingFlash pulse gliding from release -> hit plane along a smooth boundary curve.
 * Pure 2-pass vector strokes (zero shadowBlur -> zero frame-rate impact).
 */
function drawPassingFlash(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  ys: number[],
  u: number,
  phase: number, // 0..1 repeating cycle
  dpr: number,
  alphaScale: number,
): void {
  const n = xs.length;
  if (n < 3 || alphaScale <= 0.04) return;

  // Compute cumulative arc length along curve
  const cumLen = new Float64Array(n);
  let totalLen = 0;
  for (let i = 1; i < n; i++) {
    totalLen += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    cumLen[i] = totalLen;
  }
  if (totalLen < 24 * dpr) return;

  // Smooth travel window [s0..s1] with soft fade-in at mound & fade-out at plate
  const winLen = 0.2;
  const head = -0.05 + phase * (1.1 + winLen);
  const s0 = Math.max(0, head - winLen);
  const s1 = Math.min(1, head);
  if (s1 - s0 <= 0.02) return;

  const edgeFade = Math.sin(Math.min(1, Math.max(0, (s0 + s1) * 0.5)) * Math.PI);
  const effAlpha = alphaScale * (0.3 + 0.7 * edgeFade);

  const sampleAtFrac = (frac: number): [number, number] => {
    const target = frac * totalLen;
    for (let i = 1; i < n; i++) {
      if (cumLen[i] >= target) {
        const seg = Math.max(1e-6, cumLen[i] - cumLen[i - 1]);
        const t = (target - cumLen[i - 1]) / seg;
        return [
          xs[i - 1] + (xs[i] - xs[i - 1]) * t,
          ys[i - 1] + (ys[i] - ys[i - 1]) * t,
        ];
      }
    }
    return [xs[n - 1], ys[n - 1]];
  };

  const fXs: number[] = [];
  const fYs: number[] = [];
  const steps = 6;
  for (let k = 0; k <= steps; k++) {
    const f = s0 + ((s1 - s0) * k) / steps;
    const [px, py] = sampleAtFrac(f);
    fXs.push(px);
    fYs.push(py);
  }

  const grad = ctx.createLinearGradient(fXs[0], fYs[0], fXs[steps], fYs[steps]);
  grad.addColorStop(0.0, springColorRgba(u, 0));
  grad.addColorStop(0.6, springColorRgba(u, 0.55 * effAlpha));
  grad.addColorStop(0.9, `rgba(255, 255, 255, ${(0.92 * effAlpha).toFixed(3)})`);
  grad.addColorStop(1.0, `rgba(255, 255, 255, ${(0.25 * effAlpha).toFixed(3)})`);

  // Soft bloom pass
  ctx.beginPath();
  traceSmoothPolyline(ctx, fXs, fYs, true);
  ctx.strokeStyle = springColorRgba(u, 0.28 * effAlpha);
  ctx.lineWidth = 6.2 * dpr;
  ctx.stroke();

  // Crisp luminous core spark pass
  ctx.beginPath();
  traceSmoothPolyline(ctx, fXs, fYs, true);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.1 * dpr;
  ctx.stroke();
}

/**
 * Renders a 3Blue1Brown / Manim-inspired smooth 3D speed-gradient ribbon surface,
 * delicate parametric iso-time mesh, smooth Catmull-Rom boundary splines with ShowPassingFlash,
 * and optional solo active spring-linked trajectory.
 */
export function drawSpeedRibbon3D<P extends Point3>(
  ctx: CanvasRenderingContext2D,
  ribbon: SpeedRibbonData<P>,
  project: (p: Point3) => ProjectedPoint,
  dpr: number,
  opts?: DrawSpeedRibbonOptions,
): void {
  const curves = ribbon.curves;
  if (curves.length < 2) return;
  const ptCount = curves[0].points.length;
  if (ptCount < 2) return;

  const alphaScale = opts?.surfaceAlphaScale ?? 1.0;
  const activeAlphaScale = opts?.activeAlphaScale ?? 1.0;
  const showLanding = opts?.showLandingCurve !== false;
  const showLandingEndpoints = opts?.showLandingEndpoints !== false;
  const showIdleCenter = opts?.showIdleCenterCurve === true;
  const showActive = opts?.showActiveCurve !== false;
  const soloActive = opts?.soloActiveCurve === true;
  const activeU = opts?.activeU ?? null;
  const timeSec = opts?.timeSec;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const extractValidCoords = (pts: ProjectedPoint[]): { xs: number[]; ys: number[] } => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const pr of pts) {
      if (!pr.ok) continue;
      xs.push(pr.sx);
      ys.push(pr.sy);
    }
    return { xs, ys };
  };

  const drawSmoothStroke = (xs: number[], ys: number[], stroke: string | CanvasGradient, widthPx: number) => {
    if (xs.length < 2) return;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = widthPx;
    ctx.beginPath();
    traceSmoothPolyline(ctx, xs, ys, true);
    ctx.stroke();
  };

  if (!(soloActive && activeU !== null) && alphaScale > 0.015) {
    // Only project and draw the two extreme 3D trajectories: most SOFT (0) and most HARD (last).
    // Intermediate 3D curves and ribbon surface fill are omitted for maximum visual clarity,
    // while the 2D hit-plane probability cloud union boundary is drawn separately by drawTyphoonCone.
    for (const edgeIdx of [0, curves.length - 1]) {
      const u = curves[edgeIdx].u;
      const projectedEdge = curves[edgeIdx].points.map((p) => project(p));
      const { xs, ys } = extractValidCoords(projectedEdge);
      // Pass 1: Soft luminous Manim bloom halo (pure GPU vector stroke, zero shadowBlur)
      drawSmoothStroke(xs, ys, springColorRgba(u, Math.min(1, 0.28 * alphaScale)), 5.4 * dpr);
      // Pass 2: Rich Manim primary stroke
      drawSmoothStroke(xs, ys, springColorRgba(u, Math.min(1, 0.94 * alphaScale)), 2.3 * dpr);
      // Pass 3: Delicate white-tinted luminous inner specular core
      drawSmoothStroke(xs, ys, `rgba(255, 255, 255, ${(0.42 * alphaScale).toFixed(3)})`, 0.75 * dpr);

      // Optional ShowPassingFlash traveling light pulse from release -> hit plane
      if (typeof timeSec === 'number') {
        const phaseOffset = edgeIdx === 0 ? 0.0 : 0.48;
        const flashPhase = (timeSec * 0.68 + phaseOffset) % 1;
        drawPassingFlash(ctx, xs, ys, u, flashPhase, dpr, alphaScale);
      }
    }

    // Optional Hit-plane landing spine connecting SOFT -> BEST -> HARD endpoints
    if (showLanding) {
      const landingPts = curves.map((c) => project(c.landing));
      const { xs: lxs, ys: lys } = extractValidCoords(landingPts);
      const totalSpanPx = lxs.length >= 2
        ? Math.hypot(lxs[lxs.length - 1] - lxs[0], lys[lys.length - 1] - lys[0])
        : 0;

      if (lxs.length >= 2 && totalSpanPx >= 2 * dpr) {
        const spineGrad = ctx.createLinearGradient(lxs[0], lys[0], lxs[lxs.length - 1], lys[lys.length - 1]);
        spineGrad.addColorStop(0.0, springColorRgba(0.0, 0.94 * alphaScale));
        spineGrad.addColorStop(0.45, springColorRgba(0.42, 0.90 * alphaScale));
        spineGrad.addColorStop(SPRING_BEST_CENTER, springColorRgba(SPRING_BEST_CENTER, 0.95 * alphaScale));
        spineGrad.addColorStop(1.0, springColorRgba(1.0, 0.94 * alphaScale));

        const bloomGrad = ctx.createLinearGradient(lxs[0], lys[0], lxs[lxs.length - 1], lys[lys.length - 1]);
        bloomGrad.addColorStop(0.0, springColorRgba(0.0, 0.30 * alphaScale));
        bloomGrad.addColorStop(SPRING_BEST_CENTER, springColorRgba(SPRING_BEST_CENTER, 0.34 * alphaScale));
        bloomGrad.addColorStop(1.0, springColorRgba(1.0, 0.30 * alphaScale));

        // Soft Manim bloom + crisp gradient spine + subtle bright core
        drawSmoothStroke(lxs, lys, bloomGrad, 4.8 * dpr);
        drawSmoothStroke(lxs, lys, spineGrad, 2.0 * dpr);
        drawSmoothStroke(lxs, lys, `rgba(255, 255, 255, ${(0.34 * alphaScale).toFixed(3)})`, 0.65 * dpr);
      }

      if (showLandingEndpoints && totalSpanPx >= 3 * dpr) {
        for (const idx of [0, landingPts.length - 1]) {
          const lp = landingPts[idx];
          if (!lp.ok) continue;
          ctx.fillStyle = springColorRgba(curves[idx].u, 0.95 * alphaScale);
          ctx.beginPath();
          ctx.arc(lp.sx, lp.sy, 3.0 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.85 * alphaScale).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(lp.sx, lp.sy, 1.3 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // 4. Active spring-linked highlighted trajectory OR idle BEST center reference curve
  if (activeU !== null && showActive && activeAlphaScale > 0.015) {
    const interp = interpolateRibbonAt(ribbon, activeU);
    if (interp) {
      const proj = interp.points.map((p) => project(p));
      const { xs, ys } = extractValidCoords(proj);

      // Manim 3-layer luminous solo trajectory (wide halo -> vibrant core -> white specular thread)
      drawSmoothStroke(xs, ys, springColorRgba(activeU, 0.24 * activeAlphaScale), 7.4 * dpr);
      drawSmoothStroke(xs, ys, springColorRgba(activeU, 0.86 * activeAlphaScale), 3.0 * dpr);
      drawSmoothStroke(xs, ys, `rgba(255, 255, 255, ${(0.92 * activeAlphaScale).toFixed(3)})`, 1.25 * dpr);

      // Clean Manim focal landing node on the hit plane
      const lp = project(interp.landing);
      if (lp.ok) {
        ctx.fillStyle = springColorRgba(activeU, 0.24 * activeAlphaScale);
        ctx.beginPath();
        ctx.arc(lp.sx, lp.sy, 8.5 * dpr, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = springColorRgba(activeU, 0.96 * activeAlphaScale);
        ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath();
        ctx.arc(lp.sx, lp.sy, 5.2 * dpr, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = `rgba(255, 255, 255, ${(0.96 * activeAlphaScale).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(lp.sx, lp.sy, 2.1 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (activeU === null && showIdleCenter && alphaScale > 0.015) {
    const bestCurve = interpolateRibbonAt(ribbon, SPRING_BEST_CENTER);
    if (bestCurve) {
      const proj = bestCurve.points.map((p) => project(p));
      const { xs, ys } = extractValidCoords(proj);
      drawSmoothStroke(xs, ys, `rgba(247, 208, 96, ${(0.34 * alphaScale).toFixed(3)})`, 3.6 * dpr);
      drawSmoothStroke(xs, ys, `rgba(255, 255, 255, ${(0.82 * alphaScale).toFixed(3)})`, 1.45 * dpr);
    }
  }

  ctx.restore();
}
