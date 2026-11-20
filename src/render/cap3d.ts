import type { FieldV3 } from '../physics/batted';
import type { GameCamera } from './camera';

function norm3(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Convert cap-flight-sim FLU normal [nx_s, ny_s, nz_s] to Field3D normal [ny_s, nz_s, nx_s].
 */
export function simNormalToField(simNormal: readonly [number, number, number]): FieldV3 {
  return [simNormal[1], simNormal[2], simNormal[0]];
}

/**
 * Render a true 3D cylindrical/cup bottle cap oriented by its Field3D surface normal.
 * Used for both high-DPI pitched caps (overlayCanvas) and depth-sorted batted caps (sprites.ts).
 */
export function drawTrue3DCap(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  fieldPos: FieldV3,
  normalField: FieldV3,
  visualRadiusPx: number,
  accentColor: string,
  dpr = 1,
): void {
  const prCenter = cam.project(fieldPos);
  if (!prCenter.visible || prCenter.depth <= 0.15) return;

  const n = norm3(normalField);
  const ref: [number, number, number] = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm3(cross3(ref, n));
  const v = norm3(cross3(n, u));

  const rWorld = Math.max(0.008, visualRadiusPx / Math.max(1, prCenter.scale));
  const halfH = rWorld * 0.44; // authentic ~14mm height / 31mm diameter ratio

  const topPos: FieldV3 = [
    fieldPos[0] + n[0] * halfH,
    fieldPos[1] + n[1] * halfH,
    fieldPos[2] + n[2] * halfH,
  ];
  const botPos: FieldV3 = [
    fieldPos[0] - n[0] * halfH,
    fieldPos[1] - n[1] * halfH,
    fieldPos[2] - n[2] * halfH,
  ];

  const topPr = cam.project(topPos);
  const botPr = cam.project(botPos);
  const pu = cam.project([
    fieldPos[0] + u[0] * rWorld,
    fieldPos[1] + u[1] * rWorld,
    fieldPos[2] + u[2] * rWorld,
  ]);
  const pv = cam.project([
    fieldPos[0] + v[0] * rWorld,
    fieldPos[1] + v[1] * rWorld,
    fieldPos[2] + v[2] * rWorld,
  ]);

  if (topPr.depth <= 0.15 || botPr.depth <= 0.15) return;

  const dux = pu.sx - prCenter.sx;
  const duy = pu.sy - prCenter.sy;
  const dvx = pv.sx - prCenter.sx;
  const dvy = pv.sy - prCenter.sy;

  // Guard against degenerate projection
  const det = dux * dvy - duy * dvx;
  const eye = cam.getEyePos();
  const toEyeX = eye[0] - fieldPos[0];
  const toEyeY = eye[1] - fieldPos[1];
  const toEyeZ = eye[2] - fieldPos[2];
  const topFacing = n[0] * toEyeX + n[1] * toEyeY + n[2] * toEyeZ >= 0;

  const frontPr = topFacing ? topPr : botPr;
  const backPr = topFacing ? botPr : topPr;

  ctx.save();

  // 1. Bold dark outline (#0f172a) around back disc, side wall, and front disc
  const outlinePad = Math.max(1.4 * dpr, visualRadiusPx * 0.12);
  const wallSteps = 16;
  const drawDisc = (
    cx: number,
    cy: number,
    scaleFactor: number,
    fill: string,
    stroke?: string,
    strokeW?: number,
  ) => {
    ctx.save();
    if (Math.abs(det) > 0.25) {
      ctx.translate(cx, cy);
      ctx.transform(dux * scaleFactor, duy * scaleFactor, dvx * scaleFactor, dvy * scaleFactor, 0, 0);
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke && strokeW) {
        ctx.restore();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.transform(dux * scaleFactor, duy * scaleFactor, dvx * scaleFactor, dvy * scaleFactor, 0, 0);
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        // Undo scale before stroking so outline thickness is uniform in screen pixels
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeW;
        ctx.beginPath();
        for (let i = 0; i <= wallSteps; i++) {
          const a = (i / wallSteps) * Math.PI * 2;
          const px = cx + (Math.cos(a) * dux + Math.sin(a) * dvx) * scaleFactor;
          const py = cy + (Math.cos(a) * duy + Math.sin(a) * dvy) * scaleFactor;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      // Edge-on fallback: draw thin pill along the dominant axis
      const ax = Math.hypot(dux, duy) >= Math.hypot(dvx, dvy) ? dux : dvx;
      const ay = Math.hypot(dux, duy) >= Math.hypot(dvx, dvy) ? duy : dvy;
      ctx.strokeStyle = fill;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2 * dpr, visualRadiusPx * 0.28);
      ctx.beginPath();
      ctx.moveTo(cx - ax * scaleFactor, cy - ay * scaleFactor);
      ctx.lineTo(cx + ax * scaleFactor, cy + ay * scaleFactor);
      ctx.stroke();
    }
    ctx.restore();
  };

  // Silhouette dark outline behind back & front discs + side skirt
  const outlineScale = 1 + outlinePad / Math.max(4, visualRadiusPx);
  drawDisc(backPr.sx, backPr.sy, outlineScale, '#0f172a');

  // Side wall connecting back & front rings
  const dxCenter = frontPr.sx - backPr.sx;
  const dyCenter = frontPr.sy - backPr.sy;
  if (Math.hypot(dxCenter, dyCenter) > 0.4) {
    // Draw dark outline skirt first, then shaded side wall
    for (let pass = 0; pass < 2; pass++) {
      const sc = pass === 0 ? outlineScale : 1;
      ctx.fillStyle = pass === 0 ? '#0f172a' : topFacing ? '#94a3b8' : '#cbd5e1';
      for (let i = 0; i < wallSteps; i++) {
        const a0 = (i / wallSteps) * Math.PI * 2;
        const a1 = ((i + 1) / wallSteps) * Math.PI * 2;
        const ox0 = (Math.cos(a0) * dux + Math.sin(a0) * dvx) * sc;
        const oy0 = (Math.cos(a0) * duy + Math.sin(a0) * dvy) * sc;
        const ox1 = (Math.cos(a1) * dux + Math.sin(a1) * dvx) * sc;
        const oy1 = (Math.cos(a1) * duy + Math.sin(a1) * dvy) * sc;
        ctx.beginPath();
        ctx.moveTo(backPr.sx + ox0, backPr.sy + oy0);
        ctx.lineTo(backPr.sx + ox1, backPr.sy + oy1);
        ctx.lineTo(frontPr.sx + ox1, frontPr.sy + oy1);
        ctx.lineTo(frontPr.sx + ox0, frontPr.sy + oy0);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  drawDisc(frontPr.sx, frontPr.sy, outlineScale, '#0f172a');

  // Back disc fill
  drawDisc(backPr.sx, backPr.sy, 1, topFacing ? '#94a3b8' : '#e2e8f0');

  // Front disc fill
  if (topFacing) {
    // Bright white cap top face
    drawDisc(frontPr.sx, frontPr.sy, 1, '#ffffff');
    // Accent inner rim & center dot
    if (Math.abs(det) > 1.2 && visualRadiusPx >= 4 * dpr) {
      drawDisc(frontPr.sx, frontPr.sy, 0.78, '#ffffff', accentColor, Math.max(1 * dpr, visualRadiusPx * 0.1));
      drawDisc(frontPr.sx, frontPr.sy, 0.24, accentColor);
    }
    // Crisp specular highlight on upper-left rim
    if (Math.abs(det) > 2.0 && visualRadiusPx >= 5 * dpr) {
      const hx = frontPr.sx - (dux + dvx) * 0.28;
      const hy = frontPr.sy - (duy + dvy) * 0.28;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath();
      ctx.arc(hx, hy, Math.max(1 * dpr, visualRadiusPx * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Shaded light-slate cavity (#cbd5e1) when cavity faces viewer
    drawDisc(frontPr.sx, frontPr.sy, 1, '#f1f5f9');
    drawDisc(frontPr.sx, frontPr.sy, 0.82, '#cbd5e1', '#94a3b8', Math.max(1 * dpr, visualRadiusPx * 0.08));
  }

  ctx.restore();
}
