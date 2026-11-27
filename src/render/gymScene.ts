import type { FieldV3 } from '../physics/batted';
import {
  FENCE_DIST,
  FENCE_HEIGHT,
  INFIELD_FOUL_DIST,
  MOUND_DIST,
  MOUND_WIDTH,
  PASS_LINE_Z,
  PLATE_WIDTH,
} from '../rules/field';
import type { GameCamera } from './camera';

const S45 = Math.SQRT1_2;

function projPoly(
  cam: GameCamera,
  pts: readonly FieldV3[],
): { sx: number; sy: number }[] | null {
  const out: { sx: number; sy: number }[] = [];
  for (const p of pts) {
    const pr = cam.project(p);
    if (!pr.visible && pr.depth <= 0.15) return null;
    out.push({ sx: Math.round(pr.sx), sy: Math.round(pr.sy) });
  }
  return out;
}

function fillQuad(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  pts: readonly [FieldV3, FieldV3, FieldV3, FieldV3],
  fill: string,
  stroke?: string,
  lineWidth = 1,
): void {
  const poly = projPoly(cam, pts);
  if (!poly) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].sx, poly[0].sy);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].sx, poly[i].sy);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawLine3D(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  a: FieldV3,
  b: FieldV3,
  color: string,
  width = 1,
): void {
  const pa = cam.project(a);
  const pb = cam.project(b);
  if (pa.depth <= 0.15 || pb.depth <= 0.15) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(Math.round(pa.sx) + 0.5, Math.round(pa.sy) + 0.5);
  ctx.lineTo(Math.round(pb.sx) + 0.5, Math.round(pb.sy) + 0.5);
  ctx.stroke();
}

function drawArc3D(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  cx: number,
  cz: number,
  radius: number,
  a0: number,
  a1: number,
  steps: number,
  color: string,
  width = 1,
  y = 0,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    const p = cam.project([cx + Math.sin(t) * radius, y, cz - Math.cos(t) * radius]);
    if (p.depth <= 0.15) continue;
    const sx = Math.round(p.sx) + 0.5;
    const sy = Math.round(p.sy) + 0.5;
    if (!started) {
      ctx.moveTo(sx, sy);
      started = true;
    } else {
      ctx.lineTo(sx, sy);
    }
  }
  if (started) ctx.stroke();
}

function drawCone(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  x: number,
  z: number,
): void {
  const base = cam.project([x, 0, z]);
  const tip = cam.project([x, 0.36, z]);
  if (base.depth <= 0.2 || tip.depth <= 0.2) return;
  const r = Math.max(2, Math.round(base.scale * 0.11));
  const bx = Math.round(base.sx);
  const by = Math.round(base.sy);
  const ty = Math.round(tip.sy);

  ctx.fillStyle = '#e85d1a';
  ctx.beginPath();
  ctx.moveTo(bx - r, by);
  ctx.lineTo(bx + r, by);
  ctx.lineTo(bx + 1, ty);
  ctx.lineTo(bx - 1, ty);
  ctx.closePath();
  ctx.fill();

  // White reflective band
  ctx.fillStyle = '#f8f8f5';
  const my = Math.round((by + ty) * 0.52);
  ctx.fillRect(bx - Math.max(1, Math.floor(r * 0.55)), my, Math.max(2, r), Math.max(1, Math.round((by - ty) * 0.18)));
}

export interface DepthDrawItem {
  depth: number;
  draw: () => void;
}

export interface PassLineState {
  highlight: number;
  crossed: boolean;
  crossX?: number;
}

function drawPassLineOverlay(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  width: number,
  timeSec: number,
  passLineState: PassLineState,
): void {
  const hl = Math.max(0, Math.min(1, passLineState.highlight));
  if (hl <= 0 && !passLineState.crossed) return;

  if (hl > 0) {
    const pulse = 0.78 + 0.22 * Math.sin(timeSec * 10);
    const glowAlpha = Math.min(0.45, hl * 0.34 * pulse);
    drawLine3D(
      ctx,
      cam,
      [-3.6, 0.003, PASS_LINE_Z],
      [3.6, 0.003, PASS_LINE_Z],
      `rgba(255, 255, 255, ${glowAlpha.toFixed(3)})`,
      4.5,
    );
    drawLine3D(
      ctx,
      cam,
      [-3.6, 0.004, PASS_LINE_Z],
      [3.6, 0.004, PASS_LINE_Z],
      '#ffffff',
      2.4,
    );

    // Clean floor label projected on the gym floor beside the pass line
    const lblProj = cam.project([0, 0.01, PASS_LINE_Z + 0.22]);
    if (lblProj.depth > 0.25) {
      const label = '捕逸線 PASS LINE';
      ctx.save();
      const fontSize = Math.max(8, Math.min(11, Math.round(lblProj.scale * 0.075)));
      ctx.font = `700 ${fontSize}px monospace`;
      const tw = ctx.measureText(label).width;
      const padX = 5;
      const boxW = tw + padX * 2;
      const boxH = fontSize + 5;
      const lx = Math.max(boxW * 0.5 + 4, Math.min(width - boxW * 0.5 - 4, Math.round(lblProj.sx)));
      const ly = Math.round(lblProj.sy);
      ctx.globalAlpha = Math.min(1, hl * 1.1);
      ctx.fillStyle = 'rgba(18, 20, 24, 0.74)';
      ctx.fillRect(Math.round(lx - boxW * 0.5), Math.round(ly - boxH * 0.5), Math.round(boxW), Math.round(boxH));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(lx - boxW * 0.5) + 0.5, Math.round(ly - boxH * 0.5) + 0.5, Math.round(boxW) - 1, Math.round(boxH) - 1);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly + 0.5);
      ctx.restore();
    }
  }

  if (passLineState.crossed) {
    const cx = passLineState.crossX ?? 0;
    const center = cam.project([cx, 0.02, PASS_LINE_Z]);
    if (center.depth > 0.2 && center.visible) {
      const ringPulse = (timeSec * 3.2) % 1;
      const rOuter = 0.24 + ringPulse * 0.34;
      const rInner = 0.14 + (1 - ringPulse) * 0.08;
      const ringAlpha = Math.max(0.28, 1 - ringPulse * 0.65);

      for (const [rad, col, lw] of [
        [rOuter, `rgba(248, 113, 113, ${ringAlpha.toFixed(3)})`, 2.2],
        [rInner, 'rgba(253, 224, 71, 0.95)', 1.8],
      ] as const) {
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath();
        const segs = 16;
        let started = false;
        for (let i = 0; i <= segs; i++) {
          const ang = (i / segs) * Math.PI * 2;
          const p = cam.project([cx + Math.cos(ang) * rad, 0.02, PASS_LINE_Z + Math.sin(ang) * rad]);
          if (p.depth <= 0.15) continue;
          if (!started) {
            ctx.moveTo(p.sx, p.sy);
            started = true;
          } else {
            ctx.lineTo(p.sx, p.sy);
          }
        }
        if (started) {
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
      }

      // Crisp animated radial spark rays at the crossing point
      ctx.save();
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.92)';
      ctx.lineWidth = 1.6;
      const rPx = Math.max(5, center.scale * (0.14 + ringPulse * 0.16));
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2 + timeSec * 4.5;
        ctx.beginPath();
        ctx.moveTo(center.sx + Math.cos(ang) * rPx * 0.45, center.sy + Math.sin(ang) * rPx * 0.45);
        ctx.lineTo(center.sx + Math.cos(ang) * rPx * 1.1, center.sy + Math.sin(ang) * rPx * 1.1);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

let bgCacheCanvas: HTMLCanvasElement | null = null;
let bgCacheCtx: CanvasRenderingContext2D | null = null;
let bgCacheKey = '';

export function drawGymBackground(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  width: number,
  height: number,
  timeSec: number,
  passLineState?: PassLineState,
): void {
  // Offscreen cache for static pixel stage (re-renders only on camera move, resize, or 4Hz light pulse)
  if (typeof document !== 'undefined') {
    const key = `${cam.getPoseKey()}:${Math.floor(timeSec * 4)}`;
    if (!bgCacheCanvas) {
      bgCacheCanvas = document.createElement('canvas');
      bgCacheCtx = bgCacheCanvas.getContext('2d');
    }
    if (bgCacheCanvas && bgCacheCtx) {
      if (bgCacheCanvas.width !== width || bgCacheCanvas.height !== height) {
        bgCacheCanvas.width = width;
        bgCacheCanvas.height = height;
        bgCacheKey = '';
      }
      if (bgCacheKey !== key) {
        bgCacheCtx.imageSmoothingEnabled = false;
        renderGymBackgroundDirect(bgCacheCtx, cam, width, height, timeSec);
        bgCacheKey = key;
      }
      ctx.drawImage(bgCacheCanvas, 0, 0);
      if (passLineState) {
        drawPassLineOverlay(ctx, cam, width, timeSec, passLineState);
      }
      return;
    }
  }
  renderGymBackgroundDirect(ctx, cam, width, height, timeSec);
  if (passLineState) {
    drawPassLineOverlay(ctx, cam, width, timeSec, passLineState);
  }
}

function renderGymBackgroundDirect(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  width: number,
  height: number,
  timeSec: number,
): void {
  // 1. Dark industrial ceiling background
  ctx.fillStyle = '#22262b';
  ctx.fillRect(0, 0, width, height);

  // Horizon / wall-floor boundary reference
  const horizonP = cam.project([0, 0, -17.5]);
  const floorTopY = horizonP.depth > 0.2 ? Math.max(0, Math.round(horizonP.sy)) : Math.round(height * 0.36);

  // 2. Honey-maple wooden floor base
  const floorGrad = ctx.createLinearGradient(0, floorTopY, 0, height);
  floorGrad.addColorStop(0, '#b98245');
  floorGrad.addColorStop(0.45, '#cf9858');
  floorGrad.addColorStop(1, '#dcab6c');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, floorTopY, width, height - floorTopY);

  // Perspective maple planks (vertical strips in Z, horizontal bands)
  const plankColors = ['#c99252', '#d39d5c', '#be8748', '#d9a566'];
  for (let ix = -14; ix < 14; ix++) {
    const x0 = ix * 1.15;
    const x1 = (ix + 1) * 1.15;
    const col = plankColors[Math.abs(ix) % plankColors.length];
    fillQuad(
      ctx,
      cam,
      [
        [x0, 0, -17.2],
        [x1, 0, -17.2],
        [x1, 0, 4.8],
        [x0, 0, 4.8],
      ],
      col,
    );
    drawLine3D(ctx, cam, [x0, 0, -17.2], [x0, 0, 4.6], 'rgba(115, 68, 28, 0.22)', 1);
  }
  for (let iz = -16; iz <= 4; iz += 2) {
    drawLine3D(ctx, cam, [-16, 0, iz], [16, 0, iz], 'rgba(120, 72, 30, 0.14)', 1);
  }

  // 3. Taiwanese School Gymnasium Back Wall, Auditorium Stage & Curtains (z = -17.4)
  const wallZ = -17.4;

  // Light warm-grey concrete upper wall
  fillQuad(
    ctx,
    cam,
    [
      [-18, 6.4, wallZ],
      [18, 6.4, wallZ],
      [18, 5.15, wallZ],
      [-18, 5.15, wallZ],
    ],
    '#d8dad2',
  );
  // Subtle concrete horizontal beam seam
  drawLine3D(ctx, cam, [-18, 5.15, wallZ + 0.01], [18, 5.15, wallZ + 0.01], '#b4b8ae', 1);

  // Pale mint / seafoam green proscenium wall surrounding the recessed stage
  fillQuad(
    ctx,
    cam,
    [
      [-18, 5.15, wallZ],
      [18, 5.15, wallZ],
      [18, 0, wallZ],
      [-18, 0, wallZ],
    ],
    '#b8dec8',
  );

  // Subtle vertical mint pilasters & wall shading for depth
  for (const px of [-15.2, -9.8, -7.8, 7.8, 9.8, 15.2]) {
    fillQuad(
      ctx,
      cam,
      [
        [px - 0.38, 5.15, wallZ + 0.03],
        [px + 0.38, 5.15, wallZ + 0.03],
        [px + 0.38, 0, wallZ + 0.03],
        [px - 0.38, 0, wallZ + 0.03],
      ],
      '#a6d1b9',
      '#93bea6',
      1,
    );
  }

  // Wide recessed auditorium stage opening (x: -7.5..7.5, y: 1.02..4.88)
  // Full-width deep burgundy/crimson velvet curtains across the ENTIRE back of the stage (no black center hole!)
  const curtainColors = ['#6e1020', '#861629', '#4c0914', '#7a1224'];
  const stageHalfW = 7.5;
  const foldCount = 24;
  const foldW = (stageHalfW * 2) / foldCount;
  for (let i = 0; i < foldCount; i++) {
    const x0 = -stageHalfW + i * foldW;
    const x1 = x0 + foldW;
    fillQuad(
      ctx,
      cam,
      [
        [x0, 4.88, wallZ + 0.06],
        [x1, 4.88, wallZ + 0.06],
        [x1, 1.02, wallZ + 0.06],
        [x0, 1.02, wallZ + 0.06],
      ],
      curtainColors[i % curtainColors.length],
    );
  }

  // Horizontal top valance curtain across the top of the stage proscenium
  fillQuad(
    ctx,
    cam,
    [
      [-stageHalfW, 4.92, wallZ + 0.14],
      [stageHalfW, 4.92, wallZ + 0.14],
      [stageHalfW, 4.32, wallZ + 0.14],
      [-stageHalfW, 4.32, wallZ + 0.14],
    ],
    '#6e1020',
    '#4c0914',
    1,
  );
  // Valance vertical fold accents & lower scallop trim
  for (let i = 0; i < 16; i++) {
    const vx = -stageHalfW + ((i + 0.5) * (stageHalfW * 2)) / 16;
    drawLine3D(ctx, cam, [vx, 4.88, wallZ + 0.15], [vx, 4.33, wallZ + 0.15], '#4c0914', 1);
  }

  // Proscenium frame trim around the stage opening
  fillQuad(
    ctx,
    cam,
    [
      [-stageHalfW - 0.18, 5.12, wallZ + 0.12],
      [stageHalfW + 0.18, 5.12, wallZ + 0.12],
      [stageHalfW + 0.18, 4.90, wallZ + 0.12],
      [-stageHalfW - 0.18, 4.90, wallZ + 0.12],
    ],
    '#a6d1b9',
    '#85b59b',
    1,
  );

  // Subtle dark rectangular LED clock/banner panel tucked in the upper-center proscenium trim
  fillQuad(
    ctx,
    cam,
    [
      [-1.3, 5.26, wallZ + 0.15],
      [1.3, 5.26, wallZ + 0.15],
      [1.3, 4.92, wallZ + 0.15],
      [-1.3, 4.92, wallZ + 0.15],
    ],
    '#14181e',
    '#2f3640',
    1,
  );
  const ledP = cam.project([0, 5.09, wallZ + 0.16]);
  if (ledP.depth > 0.3 && ledP.visible) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
    const dotW = Math.max(1, Math.round(ledP.scale * 0.06));
    for (const ox of [-0.55, -0.35, -0.1, 0.1, 0.35, 0.55]) {
      const dp = cam.project([ox, 5.09, wallZ + 0.16]);
      if (dp.visible) {
        ctx.fillRect(Math.round(dp.sx), Math.round(dp.sy), dotW, Math.max(1, dotW));
      }
    }
  }

  // Warm dark-oak wooden stage apron & horizontal wooden steps along the stage base
  fillQuad(
    ctx,
    cam,
    [
      [-stageHalfW - 0.25, 1.05, wallZ + 0.16],
      [stageHalfW + 0.25, 1.05, wallZ + 0.16],
      [stageHalfW + 0.25, 0.92, wallZ + 0.42],
      [-stageHalfW - 0.25, 0.92, wallZ + 0.42],
    ],
    '#7c4d2b',
    '#4a2b14',
    1,
  );
  // Stage front dark-oak wainscot face
  fillQuad(
    ctx,
    cam,
    [
      [-stageHalfW - 0.2, 0.92, wallZ + 0.18],
      [stageHalfW + 0.2, 0.92, wallZ + 0.18],
      [stageHalfW + 0.2, 0.0, wallZ + 0.18],
      [-stageHalfW - 0.2, 0.0, wallZ + 0.18],
    ],
    '#5c371d',
    '#3e2311',
    1,
  );
  // Horizontal wooden steps along the stage base
  for (let s = 0; s < 3; s++) {
    const syTop = 0.48 - s * 0.16;
    const syBot = syTop - 0.14;
    const sz = wallZ + 0.28 + s * 0.18;
    fillQuad(
      ctx,
      cam,
      [
        [-5.6, syTop, sz],
        [5.6, syTop, sz],
        [5.6, syBot, sz + 0.12],
        [-5.6, syBot, sz + 0.12],
      ],
      s % 2 === 0 ? '#734728' : '#633c20',
      '#3e2311',
      1,
    );
  }

  // Two crisp black hanging PA speakers mounted symmetrically on upper-left and upper-right wall above stage
  for (const sx of [-6.3, 6.3]) {
    // Mounting bracket
    drawLine3D(ctx, cam, [sx, 6.05, wallZ + 0.25], [sx, 5.72, wallZ + 0.35], '#111418', 2);
    // Speaker cabinet
    fillQuad(
      ctx,
      cam,
      [
        [sx - 0.32, 5.75, wallZ + 0.36],
        [sx + 0.32, 5.75, wallZ + 0.36],
        [sx + 0.28, 5.15, wallZ + 0.36],
        [sx - 0.28, 5.15, wallZ + 0.36],
      ],
      '#181c22',
      '#0b0d10',
      1,
    );
    // Speaker grille inset
    fillQuad(
      ctx,
      cam,
      [
        [sx - 0.22, 5.65, wallZ + 0.38],
        [sx + 0.22, 5.65, wallZ + 0.38],
        [sx + 0.2, 5.23, wallZ + 0.38],
        [sx - 0.2, 5.23, wallZ + 0.38],
      ],
      '#2c323b',
    );
  }

  // Dark industrial ceiling trusses/beams & warm gym lights
  for (const bz of [-15.5, -11.5, -7.5, -3.5]) {
    drawLine3D(ctx, cam, [-16, 5.95, bz], [16, 5.95, bz], '#2b3036', 2);
    drawLine3D(ctx, cam, [-16, 5.72, bz], [16, 5.72, bz], '#363c44', 1);
    for (let tx = -14; tx <= 14; tx += 2.8) {
      drawLine3D(ctx, cam, [tx, 5.95, bz], [tx + 1.4, 5.72, bz], '#2f353d', 1);
    }
    for (const lx of [-5.5, 0, 5.5]) {
      const lp = cam.project([lx, 5.65, bz]);
      if (lp.depth > 0.3 && lp.visible) {
        const flicker = 0.94 + 0.06 * Math.sin(timeSec * 3 + lx + bz);
        ctx.fillStyle = `rgba(255, 240, 195, ${0.85 * flicker})`;
        const w = Math.max(3, Math.round(lp.scale * 0.45));
        const h = Math.max(2, Math.round(lp.scale * 0.14));
        ctx.fillRect(Math.round(lp.sx - w * 0.5), Math.round(lp.sy - h * 0.5), w, h);
      }
    }
  }

  // 4. Multi-sport gym court lines (subtle under Cap Baseball tape)
  // Basketball key & free throw circle (white, translucent)
  drawLine3D(ctx, cam, [-2.4, 0, -15.5], [-2.4, 0, -11.2], 'rgba(255,255,255,0.28)', 1);
  drawLine3D(ctx, cam, [2.4, 0, -15.5], [2.4, 0, -11.2], 'rgba(255,255,255,0.28)', 1);
  drawLine3D(ctx, cam, [-2.4, 0, -11.2], [2.4, 0, -11.2], 'rgba(255,255,255,0.28)', 1);
  drawArc3D(ctx, cam, 0, -11.2, 1.8, -Math.PI, Math.PI, 20, 'rgba(255,255,255,0.24)', 1);

  // Orange volleyball court lines
  drawLine3D(ctx, cam, [-4.5, 0, -14.8], [4.5, 0, -14.8], 'rgba(232,114,42,0.38)', 1);
  drawLine3D(ctx, cam, [-4.5, 0, -14.8], [-4.5, 0, -3.2], 'rgba(232,114,42,0.34)', 1);
  drawLine3D(ctx, cam, [4.5, 0, -14.8], [4.5, 0, -3.2], 'rgba(232,114,42,0.34)', 1);
  drawLine3D(ctx, cam, [-4.5, 0, -8.8], [4.5, 0, -8.8], 'rgba(232,114,42,0.34)', 1);

  // Subtle green badminton lines
  drawLine3D(ctx, cam, [-3.05, 0, -13.0], [-3.05, 0, -1.5], 'rgba(46,138,86,0.25)', 1);
  drawLine3D(ctx, cam, [3.05, 0, -13.0], [3.05, 0, -1.5], 'rgba(46,138,86,0.25)', 1);

  // 5. Official 2025-02 Cap Baseball Field Markings
  const infCorner = INFIELD_FOUL_DIST * S45; // ~5.657m
  const fenceCorner = FENCE_DIST * S45; // ~9.192m

  // Infield Out-Zone diamond (subtle warm-red/amber tint so infield out-zone vs outfield hit-zone is immediately readable)
  fillQuad(
    ctx,
    cam,
    [
      [0, 0, 0],
      [-infCorner, 0, -infCorner],
      [0, 0, -MOUND_DIST],
      [infCorner, 0, -infCorner],
    ],
    'rgba(218, 68, 48, 0.14)',
  );

  // Infield diamond crisp white tape borders
  drawLine3D(ctx, cam, [-infCorner, 0, -infCorner], [0, 0, -MOUND_DIST], '#f4f4ee', 1.5);
  drawLine3D(ctx, cam, [infCorner, 0, -infCorner], [0, 0, -MOUND_DIST], '#f4f4ee', 1.5);

  // 13m Foul Lines (extending slightly past plate for visual clarity)
  drawLine3D(ctx, cam, [0, 0, 0], [-fenceCorner, 0, -fenceCorner], '#ffffff', 2);
  drawLine3D(ctx, cam, [0, 0, 0], [fenceCorner, 0, -fenceCorner], '#ffffff', 2);

  // Pass Line (捕逸線 at z = +2.334m) — solid white tape matching foul lines & batter's box
  drawLine3D(ctx, cam, [-3.6, 0.002, PASS_LINE_Z], [3.6, 0.002, PASS_LINE_Z], '#ffffff', 2);

  // Pitcher's Plate / Line (0.61m wide at z = -9.22)
  const hwMound = MOUND_WIDTH * 0.5;
  fillQuad(
    ctx,
    cam,
    [
      [-hwMound, 0.002, -MOUND_DIST - 0.08],
      [hwMound, 0.002, -MOUND_DIST - 0.08],
      [hwMound, 0.002, -MOUND_DIST + 0.08],
      [-hwMound, 0.002, -MOUND_DIST + 0.08],
    ],
    '#ffffff',
  );

  // Home Plate Pentagon (width = 0.432m)
  const hpW = PLATE_WIDTH * 0.5;
  const hpPts = projPoly(ctx ? cam : cam, [
    [0, 0.002, 0],
    [-hpW, 0.002, -0.216],
    [-hpW, 0.002, -0.432],
    [hpW, 0.002, -0.432],
    [hpW, 0.002, -0.216],
  ]);
  if (hpPts) {
    ctx.beginPath();
    ctx.moveTo(hpPts[0].sx, hpPts[0].sy);
    for (let i = 1; i < hpPts.length; i++) ctx.lineTo(hpPts[i].sx, hpPts[i].sy);
    ctx.closePath();
    ctx.fillStyle = '#f8f8f4';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Left & Right Batter Boxes
  for (const side of [-1, 1]) {
    const bx0 = side * 0.32;
    const bx1 = side * 0.98;
    const xMin = Math.min(bx0, bx1);
    const xMax = Math.max(bx0, bx1);
    drawLine3D(ctx, cam, [xMin, 0, -0.65], [xMax, 0, -0.65], 'rgba(255,255,255,0.72)', 1);
    drawLine3D(ctx, cam, [xMin, 0, 0.45], [xMax, 0, 0.45], 'rgba(255,255,255,0.72)', 1);
    drawLine3D(ctx, cam, [xMin, 0, -0.65], [xMin, 0, 0.45], 'rgba(255,255,255,0.72)', 1);
    drawLine3D(ctx, cam, [xMax, 0, -0.65], [xMax, 0, 0.45], 'rgba(255,255,255,0.72)', 1);
  }

  // Orange foul cones at 13m corners
  drawCone(ctx, cam, -fenceCorner, -fenceCorner);
  drawCone(ctx, cam, fenceCorner, -fenceCorner);
}

export function buildFenceDepthItems(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  flashFenceAngle?: number,
  flashAlpha = 0,
): DepthDrawItem[] {
  const items: DepthDrawItem[] = [];
  const segs = 24;
  const angStart = -Math.PI / 4;
  const angEnd = Math.PI / 4;

  for (let i = 0; i < segs; i++) {
    const a0 = angStart + ((angEnd - angStart) * i) / segs;
    const a1 = angStart + ((angEnd - angStart) * (i + 1)) / segs;
    const aMid = (a0 + a1) * 0.5;
    const x0 = Math.sin(a0) * FENCE_DIST;
    const z0 = -Math.cos(a0) * FENCE_DIST;
    const x1 = Math.sin(a1) * FENCE_DIST;
    const z1 = -Math.cos(a1) * FENCE_DIST;
    const xm = Math.sin(aMid) * FENCE_DIST;
    const zm = -Math.cos(aMid) * FENCE_DIST;

    const midPr = cam.project([xm, FENCE_HEIGHT * 0.5, zm]);
    if (midPr.depth <= 0.15) continue;

    const isHitPanel =
      flashFenceAngle !== undefined &&
      flashAlpha > 0 &&
      Math.abs(aMid - flashFenceAngle) <= 0.16;
    const hitGlow = isHitPanel
      ? flashAlpha * (1 - Math.abs(aMid - flashFenceAngle!) / 0.2)
      : 0;

    items.push({
      depth: midPr.depth,
      draw: () => {
        const bodyCol = i % 2 === 0 ? '#2456b8' : '#1d4494';
        fillQuad(
          ctx,
          cam,
          [
            [x0, FENCE_HEIGHT - 0.1, z0],
            [x1, FENCE_HEIGHT - 0.1, z1],
            [x1, 0, z1],
            [x0, 0, z0],
          ],
          bodyCol,
          '#132c63',
          1,
        );

        fillQuad(
          ctx,
          cam,
          [
            [x0, FENCE_HEIGHT, z0],
            [x1, FENCE_HEIGHT, z1],
            [x1, FENCE_HEIGHT - 0.1, z1],
            [x0, FENCE_HEIGHT - 0.1, z0],
          ],
          '#ffd23f',
          '#d9a416',
          1,
        );

        if (hitGlow > 0.02) {
          fillQuad(
            ctx,
            cam,
            [
              [x0, FENCE_HEIGHT, z0],
              [x1, FENCE_HEIGHT, z1],
              [x1, 0, z1],
              [x0, 0, z0],
            ],
            `rgba(255, 245, 180, ${Math.min(0.85, hitGlow).toFixed(3)})`,
          );
        }
      },
    });
  }

  return items;
}

export function drawGymScene(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  width: number,
  height: number,
  timeSec: number,
  passLineState?: PassLineState,
): void {
  drawGymBackground(ctx, cam, width, height, timeSec, passLineState);
  const fenceItems = buildFenceDepthItems(ctx, cam);
  fenceItems.sort((a, b) => b.depth - a.depth);
  for (const it of fenceItems) it.draw();
}

export const renderGymScene = drawGymScene;
