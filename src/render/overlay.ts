import type { FieldV3 } from '../physics/batted';
import type { PitchId } from '../physics/pitches';
import { PLATE_WIDTH, STRIKE_ZONE_HI, STRIKE_ZONE_LO } from '../rules/field';
import { GameCamera } from './camera';
import { drawTrue3DCap } from './cap3d';

export const HIT_PLANE_Z = -0.22;

export interface OverlayCapState {
  visible: boolean;
  worldPos: FieldV3;
  normalWorld: FieldV3;
  trail: FieldV3[];
  pitchId: PitchId;
  teamColor: 'yellow' | 'black';
  isFlyBall: boolean;
  timeSec: number;
}

export interface AbsReplayState {
  active: boolean;
  plateX: number;
  plateY: number;
  trueCall: 'strike' | 'ball';
  umpireCall: 'strike' | 'ball';
  overturned: boolean;
  marginCm: number;
  elapsedSec: number;
  durationSec: number;
}

export interface OnZoneFeedbackState {
  kind: 'take' | 'swing';
  elapsedSec: number;
  durationSec: number;
  batterHandedness: 'left' | 'right';
  pitchLabel: string;
  plateX: number;
  plateY: number;
  callLabel: string;
  callColor: string;
  resultDetail?: string;
  // Swung-only fields
  dtTiming?: number;
  timingLabel?: string;
  timingColor?: string;
  batX?: number;
  batY?: number;
  powerSwing?: boolean;
  contact?: boolean;
  contactGrade?: string;
  exitSpeedKmh?: number;
  launchAngleDeg?: number;
  // ABS in-place mystery mask (Scheme B: hide pitch dot until ABS decision window ends)
  absMasked?: boolean;
  absMaskLabel?: string;
  absRevealElapsed?: number;
  // Localized labels
  pciTitle: string;
  pitchLocTitle: string;
  timingTitle: string;
  contactPrefix: string;
  evPrefix: string;
  laPrefix: string;
}

export interface OverlayState {
  showStrikeZone: boolean;
  strikeZoneAlpha?: number;
  role: 'pitcher' | 'batter' | 'spectate';
  phase: 'idle' | 'pitch_meter' | 'windup' | 'pitch_flight' | 'batted_flight' | 'result';
  dpr?: number;
  // Pitcher aim & 3D trajectory preview
  pitchTarget: { x: number; y: number };
  breakDeltaField: { dx: number; dy: number } | null;
  previewPoints?: FieldV3[];
  showBreakPreview: boolean;
  // Batter aim & timing
  batCursor: { x: number; y: number };
  showBatCursor?: boolean;
  powerSwing: boolean;
  showGuideRing: boolean;
  guideProgress: number | null; // 0..1, ~0.85..1.0 is hit window
  // High-DPI Cap rendering
  cap?: OverlayCapState;
  /** Exact bottom pixel (in physical canvas px) of top HUD region for zero-overlap layout */
  hudBottomPx?: number;
  // ABS Hawk-Eye Replay
  absReplay?: AbsReplayState | null;
  absLabels?: {
    strike: string;
    ball: string;
    overturned: string;
    upheld: string;
    hawkEye: string;
  };
  // On-Zone Pitch Location + Batter-Side Swing Timing Overlay
  pitchFeedback?: OnZoneFeedbackState | null;
}

const restCam = new GameCamera();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function capRadiusAtDepth(scale: number, depth: number, dpr: number): number {
  const nearT = clamp((11.5 - depth) / (11.5 - 2.6), 0, 1);
  const rM = 0.042 + 0.012 * Math.pow(nearT, 0.85);
  return Math.max(3.5 * dpr, scale * rM);
}

function drawOverlayCap(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  cap: OverlayCapState,
  dpr: number,
): void {
  if (!cap.visible) return;

  // 1. Grounded dark oval shadow directly underneath the cap at (capX, 0, capZ)
  const shadowPr = cam.project([cap.worldPos[0], 0.005, cap.worldPos[2]]);
  if (shadowPr.visible && shadowPr.depth > 0.2) {
    const nearT = clamp((11.5 - shadowPr.depth) / (11.5 - 2.6), 0, 1);
    const heightFade = clamp(1 - cap.worldPos[1] * 0.14, 0.22, 1.0);
    const shadowAlpha = (0.24 + 0.34 * nearT) * heightFade;
    const sRx = Math.max(3 * dpr, capRadiusAtDepth(shadowPr.scale, shadowPr.depth, dpr) * (1.05 + nearT * 0.25));
    const sRy = Math.max(1.5 * dpr, sRx * 0.42);
    ctx.save();
    ctx.fillStyle = `rgba(12, 10, 14, ${shadowAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(shadowPr.sx, shadowPr.sy, sRx, sRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Perspective-tapered motion trail ribbon (thin & faint far away, wider & brighter near cap)
  if (cap.trail.length >= 2) {
    const pts: { sx: number; sy: number; r: number }[] = [];
    for (let i = 0; i < cap.trail.length; i++) {
      const tp = cam.project(cap.trail[i]);
      if (!tp.visible || tp.depth <= 0.2) continue;
      const r = capRadiusAtDepth(tp.scale, tp.depth, dpr);
      pts.push({ sx: tp.sx, sy: tp.sy, r });
    }
    if (pts.length >= 2) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const tRatio = i / (pts.length - 1);
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const w = Math.max(1.5 * dpr, p1.r * (0.25 + 0.95 * tRatio));
        const alpha = 0.08 + 0.38 * Math.pow(tRatio, 1.4);
        ctx.strokeStyle = cap.isFlyBall
          ? `rgba(255, 224, 66, ${alpha.toFixed(3)})`
          : `rgba(226, 242, 255, ${alpha.toFixed(3)})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(p0.sx, p0.sy);
        ctx.lineTo(p1.sx, p1.sy);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 3. True 3D bottle cap disc/cylinder tilted by normalWorld
  const pr = cam.project(cap.worldPos);
  if (!pr.visible || pr.depth <= 0.15) return;

  const rPx = capRadiusAtDepth(pr.scale, pr.depth, dpr);
  const cx = pr.sx;
  const cy = pr.sy;

  ctx.save();

  // Fly ball glowing yellow tracking ring + pointer arrow
  if (cap.isFlyBall) {
    const pulse = 0.65 + 0.35 * Math.sin(cap.timeSec * 14);
    ctx.strokeStyle = `rgba(255, 224, 66, ${pulse.toFixed(3)})`;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(rPx + 6 * dpr, 10 * dpr), 0, Math.PI * 2);
    ctx.stroke();

    const ay = cy - Math.max(rPx + 12 * dpr, 16 * dpr);
    ctx.fillStyle = '#ffe042';
    ctx.beginPath();
    ctx.moveTo(cx, ay + 6 * dpr);
    ctx.lineTo(cx - 5 * dpr, ay);
    ctx.lineTo(cx + 5 * dpr, ay);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  const accentColor = cap.teamColor === 'yellow' ? '#f2c81e' : '#1e232b';
  drawTrue3DCap(ctx, cam, cap.worldPos, cap.normalWorld, rPx, accentColor, dpr);
}

export function drawStrikeZoneAndOverlay(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  width: number,
  height: number,
  state: OverlayState,
): void {
  const hw = PLATE_WIDTH * 0.5;
  const lo = STRIKE_ZONE_LO;
  const hi = STRIKE_ZONE_HI;

  const dpr = state.dpr ?? 1;
  const fb = state.pitchFeedback && state.pitchFeedback.elapsedSec < state.pitchFeedback.durationSec
    ? state.pitchFeedback
    : null;
  const fbFadeAlpha = fb
    ? Math.min(1, Math.max(0, (fb.durationSec - fb.elapsedSec) / 0.45))
    : 0;
  // Strike zone visibility is completely decoupled from the side feedback graphic
  const szAlpha = state.absReplay?.active
    ? 1
    : (state.strikeZoneAlpha ?? (state.showStrikeZone ? 1 : 0));

  // 1. Projected 3x3 Strike Zone at hit plane (z = -0.22) with smooth ABS fade
  if (szAlpha > 0.01) {
    const tl = cam.project([-hw, hi, HIT_PLANE_Z]);
    const tr = cam.project([hw, hi, HIT_PLANE_Z]);
    const br = cam.project([hw, lo, HIT_PLANE_Z]);
    const bl = cam.project([-hw, lo, HIT_PLANE_Z]);

    if (tl.depth > 0.2 && br.depth > 0.2) {
      ctx.save();
      ctx.globalAlpha = szAlpha;
      const isHawkEye = Boolean(state.absReplay?.active);
      ctx.fillStyle = isHawkEye ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(tl.sx, tl.sy);
      ctx.lineTo(tr.sx, tr.sy);
      ctx.lineTo(br.sx, br.sy);
      ctx.lineTo(bl.sx, bl.sy);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = isHawkEye ? '#38bdf8' : 'rgba(255, 255, 255, 0.48)';
      ctx.lineWidth = (isHawkEye ? 2.5 : 1.5) * dpr;
      ctx.stroke();

      // 3x3 internal grid lines
      ctx.strokeStyle = isHawkEye ? 'rgba(186, 230, 253, 0.42)' : 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1 * dpr;
      for (let i = 1; i <= 2; i++) {
        const f = i / 3;
        const vx = -hw + PLATE_WIDTH * f;
        const vt = cam.project([vx, hi, HIT_PLANE_Z]);
        const vb = cam.project([vx, lo, HIT_PLANE_Z]);
        ctx.beginPath();
        ctx.moveTo(vt.sx, vt.sy);
        ctx.lineTo(vb.sx, vb.sy);
        ctx.stroke();

        const hy = lo + (hi - lo) * f;
        const hl = cam.project([-hw, hy, HIT_PLANE_Z]);
        const hr = cam.project([hw, hy, HIT_PLANE_Z]);
        ctx.beginPath();
        ctx.moveTo(hl.sx, hl.sy);
        ctx.lineTo(hr.sx, hr.sy);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 2. Pitcher Turn: Full 3D Pitch Trajectory Preview + Aim Reticle + Accuracy Bar
  if (state.role === 'pitcher' && (state.phase === 'idle' || state.phase === 'pitch_meter')) {
    if (state.showBreakPreview && state.previewPoints && state.previewPoints.length >= 2) {
      const projectedPts: { sx: number; sy: number; depth: number; scale: number }[] = [];
      for (const pt of state.previewPoints) {
        const pr = cam.project(pt);
        if (pr.depth > 0.2) projectedPts.push(pr);
      }
      if (projectedPts.length >= 2) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Outer glow
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
        ctx.lineWidth = 5 * dpr;
        ctx.beginPath();
        ctx.moveTo(projectedPts[0].sx, projectedPts[0].sy);
        for (let i = 1; i < projectedPts.length; i++) {
          ctx.lineTo(projectedPts[i].sx, projectedPts[i].sy);
        }
        ctx.stroke();

        // Crisp inner core
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.92)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(projectedPts[0].sx, projectedPts[0].sy);
        for (let i = 1; i < projectedPts.length; i++) {
          ctx.lineTo(projectedPts[i].sx, projectedPts[i].sy);
        }
        ctx.stroke();

        // Perspective beads along the curve
        for (let i = 1; i < projectedPts.length - 1; i += 2) {
          const p = projectedPts[i];
          const tRatio = i / (projectedPts.length - 1);
          const br = Math.max(1.4 * dpr, (1.5 + tRatio * 2.4) * dpr);
          ctx.fillStyle = tRatio > 0.7 ? '#ffd23f' : '#e0f2fe';
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, br, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    const aimP = cam.project([state.pitchTarget.x, state.pitchTarget.y, HIT_PLANE_Z]);
    if (aimP.depth > 0.2) {
      const ax = Math.round(aimP.sx);
      const ay = Math.round(aimP.sy);

      // Target aim reticle
      ctx.save();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(ax, ay, 10 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax - 14 * dpr, ay);
      ctx.lineTo(ax - 5 * dpr, ay);
      ctx.moveTo(ax + 5 * dpr, ay);
      ctx.lineTo(ax + 14 * dpr, ay);
      ctx.moveTo(ax, ay - 14 * dpr);
      ctx.lineTo(ax, ay - 5 * dpr);
      ctx.moveTo(ax, ay + 5 * dpr);
      ctx.lineTo(ax, ay + 14 * dpr);
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(ax - 1.5 * dpr, ay - 1.5 * dpr, 3 * dpr, 3 * dpr);
      ctx.restore();
    }
  }

  // 3. Batter Turn: MLB The Show Bracket PCI ( • ) + Shrinking Timing Guide Ring
  if (
    state.role === 'batter' &&
    state.showBatCursor !== false &&
    (state.phase === 'idle' || state.phase === 'windup' || state.phase === 'pitch_flight')
  ) {
    const bp = cam.project([state.batCursor.x, state.batCursor.y, HIT_PLANE_Z]);
    if (bp.depth > 0.2) {
      const rx = Math.max(12 * dpr, (state.powerSwing ? 0.068 : 0.098) * bp.scale);
      const ry = Math.max(9 * dpr, (state.powerSwing ? 0.052 : 0.076) * bp.scale);
      const pciColor = state.powerSwing ? '#f97316' : '#ffd23f';

      ctx.save();
      ctx.strokeStyle = pciColor;
      ctx.lineWidth = (state.powerSwing ? 2.8 : 2.2) * dpr;
      ctx.lineCap = 'round';

      // Left bracket "("
      ctx.beginPath();
      ctx.ellipse(bp.sx, bp.sy, rx, ry, 0, Math.PI * 0.68, Math.PI * 1.32);
      ctx.stroke();

      // Right bracket ")"
      ctx.beginPath();
      ctx.ellipse(bp.sx, bp.sy, rx, ry, 0, -Math.PI * 0.32, Math.PI * 0.32);
      ctx.stroke();

      // Subtle inner sweet-spot dot •
      ctx.fillStyle = state.powerSwing ? '#fb923c' : '#fef08a';
      ctx.beginPath();
      ctx.arc(bp.sx, bp.sy, (state.powerSwing ? 3.2 : 2.6) * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      // Shrinking timing guide ring during pitch flight
      if (state.showGuideRing && state.guideProgress !== null) {
        const p = Math.max(0, Math.min(1.2, state.guideProgress));
        const inWindow = p >= 0.85 && p <= 1.08;
        const capHitR = capRadiusAtDepth(bp.scale, bp.depth, dpr);
        const ringR =
          p <= 1.0
            ? capHitR * (1 + 2.4 * (1 - p))
            : Math.max(capHitR * 0.72, capHitR * (1 - (p - 1) * 1.5));
        const flashGold = Math.floor(performance.now() / 65) % 2 === 0;
        ctx.strokeStyle = inWindow ? (flashGold ? '#ffd23f' : '#38bdf8') : 'rgba(255, 255, 255, 0.82)';
        ctx.lineWidth = (inWindow ? 3.2 : 1.8) * dpr;
        ctx.beginPath();
        ctx.arc(bp.sx, bp.sy, ringR, 0, Math.PI * 2);
        ctx.stroke();

        if (inWindow) {
          ctx.strokeStyle = flashGold ? 'rgba(56, 189, 248, 0.65)' : 'rgba(255, 210, 63, 0.65)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(bp.sx, bp.sy, ringR + 4 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // 3b. High-DPI Bottle Cap (pitched cap, visible during pitch_flight)
  if (state.cap && state.cap.visible) {
    drawOverlayCap(ctx, cam, state.cap, dpr);
  }

  // 4. ABS Hawk-Eye Replay Overlay
  if (state.absReplay && state.absReplay.active) {
    const abs = state.absReplay;
    const hitP = cam.project([abs.plateX, abs.plateY, HIT_PLANE_Z]);
    if (hitP.depth > 0.2) {
      const isStrike = abs.trueCall === 'strike';
      // Unified BSO color language: Strike = Yellow (#f4c41c), Ball = Green (#4ade80)
      const dotCol = isStrike ? '#f4c41c' : '#4ade80';
      const rDot = Math.max(7 * dpr, capRadiusAtDepth(hitP.scale, hitP.depth, dpr) * 1.15);

      ctx.save();
      // Pulsing ring around crossing point
      ctx.fillStyle = dotCol;
      ctx.beginPath();
      ctx.arc(hitP.sx, hitP.sy, rDot, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();

      // Margin tag (±X.X cm)
      const absL = state.absLabels ?? {
        strike: 'STRIKE',
        ball: 'BALL',
        overturned: 'CALL OVERTURNED!',
        upheld: 'CALL UPHELD',
        hawkEye: 'ABS HAWK-EYE',
      };
      const signStr = abs.marginCm <= 0 ? '' : '+';
      const tag = `${isStrike ? absL.strike : absL.ball} (${signStr}${abs.marginCm.toFixed(1)} cm)`;
      ctx.font = `700 ${Math.round(12 * dpr)}px "Chakra Petch", "Courier New", monospace`;
      const tw = ctx.measureText(tag).width + 16 * dpr;
      const th = 22 * dpr;
      const tx = Math.min(width - tw - 12 * dpr, hitP.sx + rDot + 8 * dpr);
      const ty = Math.max(12 * dpr, hitP.sy - th * 0.5);
      ctx.fillStyle = 'rgba(11, 16, 29, 0.94)';
      ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle = dotCol;
      ctx.fillRect(tx, ty, 3 * dpr, th);
      ctx.strokeStyle = dotCol;
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(tx, ty, tw, th);
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, tx + 9 * dpr, ty + th * 0.5);

      // Big ABS broadcast verdict banner (MLB The Show x Pixel Art)
      const bannerTitle = abs.overturned ? absL.overturned : absL.upheld;
      const bannerSub = `${absL.hawkEye} · ${abs.trueCall === 'strike' ? absL.strike : absL.ball}`;
      const bannerCol = abs.overturned ? '#f4c41c' : '#38bdf8';
      const boxW = Math.min(width * 0.84, 340 * dpr);
      const boxH = 58 * dpr;
      const bx = width * 0.5 - boxW * 0.5;
      const by = height * 0.22 - boxH * 0.5;
      // Hard pixel shadow
      ctx.fillStyle = 'rgba(5, 8, 16, 0.92)';
      ctx.fillRect(bx + 4 * dpr, by + 4 * dpr, boxW, boxH);
      ctx.fillStyle = 'rgba(11, 16, 29, 0.95)';
      ctx.fillRect(bx, by, boxW, boxH);
      // Top broadcast accent strip
      ctx.fillStyle = bannerCol;
      ctx.fillRect(bx, by, boxW, 4 * dpr);
      ctx.strokeStyle = bannerCol;
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(18 * dpr)}px "Chakra Petch", "Courier New", monospace`;
      ctx.fillStyle = bannerCol;
      ctx.fillText(bannerTitle, width * 0.5, by + 23 * dpr);
      ctx.font = `700 ${Math.round(13 * dpr)}px "Chakra Petch", "Courier New", monospace`;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(bannerSub, width * 0.5, by + 44 * dpr);
      ctx.restore();
    }
  }

  // 5. Consolidated Responsive Feedback Card (Desktop/Tablet: Vertical Side Card; Portrait Phone: Above-Zone MLB Dual Card)
  //    Uses stationary home-plate reference camera so it NEVER shifts when live camera pans or pulls back!
  if (fb && !state.absReplay?.active && fbFadeAlpha > 0.01) {
    drawStackedSideFeedback(ctx, cam, width, height, fb, fbFadeAlpha, state.role, state.hudBottomPx, dpr);
  }

  // Note: Pitch/Swing play calls (STRIKE / BALL / FOUL / MISS / TOO LATE / HIT / HR)
  // are unified inside the top-left Play Call card beside the scoreboard so the
  // center strike-zone view stays completely unobstructed.
}

function drawPitchLocationSubPanel(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  w: number,
  h: number,
  fb: OnZoneFeedbackState,
  u: number,
  dpr: number,
): void {
  const showPci = fb.kind === 'swing';
  const headH = Math.round(22 * u);
  const subH = Math.round(20 * u);
  const plotY = oy + headH + subH;
  const plotH = Math.max(48 * u, h - headH - subH);

  ctx.save();
  // Row 1: Sub-panel header
  ctx.fillStyle = '#152039';
  ctx.fillRect(ox, oy, w, headH);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = `700 ${Math.round(11.5 * u)}px "Chakra Petch", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(showPci ? fb.pciTitle : fb.pitchLocTitle, ox + w / 2, oy + headH * 0.52, w - 10 * u);

  // Row 2: Dedicated Pitch Type, Speed & Break Strip (strictly separated from the 3x3 zone plot!)
  ctx.fillStyle = '#0b1222';
  ctx.fillRect(ox, oy + headH, w, subH);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(ox, plotY - Math.max(1, Math.round(dpr)), w, Math.max(1, Math.round(dpr)));
  ctx.fillStyle = '#f8fafc';
  ctx.font = `800 ${Math.round(11 * u)}px "Chakra Petch", sans-serif`;
  ctx.fillText(fb.pitchLabel, ox + w / 2, oy + headH + subH * 0.52, w - 10 * u);

  // Row 3: Clipped 3x3 Zone Plot Area (high/low pitches NEVER collide with text strips!)
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, plotY, w, plotH);
  ctx.clip();

  ctx.fillStyle = 'rgba(12, 19, 36, 0.96)';
  ctx.fillRect(ox, plotY, w, plotH);

  const zw = Math.round(Math.min(w * 0.44, plotH * 0.64));
  const zh = Math.round(Math.min(plotH * 0.72, zw * 1.12));
  const zx = Math.round(ox + (w - zw) * 0.5);
  const zy = Math.round(plotY + (plotH - zh) * 0.5);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
  ctx.fillRect(zx, zy, zw, zh);
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.lineWidth = Math.max(1.4, 1.8 * u);
  ctx.strokeRect(zx, zy, zw, zh);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.44)';
  ctx.lineWidth = Math.max(1, 1.1 * u);
  for (let i = 1; i <= 2; i++) {
    const gx = zx + (zw * i) / 3;
    const gy = zy + (zh * i) / 3;
    ctx.beginPath();
    ctx.moveTo(gx, zy);
    ctx.lineTo(gx, zy + zh);
    ctx.moveTo(zx, gy);
    ctx.lineTo(zx + zw, gy);
    ctx.stroke();
  }

  if (fb.absMasked) {
    // Scheme B (原地翻牌感): Dim the 3x3 strike zone and cover with a crisp ABS mystery shield
    ctx.fillStyle = 'rgba(7, 11, 22, 0.78)';
    ctx.fillRect(ox, plotY, w, plotH);

    const shieldW = Math.round(w - 14 * u);
    const shieldH = Math.round(Math.min(plotH - 12 * u, 68 * u));
    const sx = Math.round(ox + (w - shieldW) * 0.5);
    const sy = Math.round(plotY + (plotH - shieldH) * 0.5);

    ctx.fillStyle = 'rgba(13, 24, 46, 0.94)';
    ctx.fillRect(sx, sy, shieldW, shieldH);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1.5, 1.8 * u);
    ctx.strokeRect(sx, sy, shieldW, shieldH);

    // Subtle top accent bar
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(sx, sy, shieldW, Math.max(2, Math.round(2.5 * u)));

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4c41c';
    ctx.font = `800 ${Math.round(24 * u)}px "Chakra Petch", sans-serif`;
    ctx.fillText('?', ox + w * 0.5, sy + shieldH * 0.42);

    ctx.fillStyle = '#7dd3fc';
    ctx.font = `700 ${Math.round(10.5 * u)}px "Chakra Petch", sans-serif`;
    ctx.fillText(fb.absMaskLabel || 'ABS', ox + w * 0.5, sy + shieldH * 0.78, shieldW - 8 * u);
  } else {
    const halfW = PLATE_WIDTH * 0.5;
    const mapX = (fx: number) => zx + ((fx + halfW) / PLATE_WIDTH) * zw;
    const mapY = (fy: number) => zy + (1 - (fy - STRIKE_ZONE_LO) / (STRIKE_ZONE_HI - STRIKE_ZONE_LO)) * zh;
    const dotR = 5.8 * u;
    const clampX = (sx: number) => clamp(sx, ox + dotR + 5 * u, ox + w - dotR - 5 * u);
    const clampY = (sy: number) => clamp(sy, plotY + dotR + 4 * u, plotY + plotH - dotR - 4 * u);

    // Batter PCI bracket ( • ) when swung
    if (showPci && typeof fb.batX === 'number' && typeof fb.batY === 'number') {
      const bx = clampX(mapX(fb.batX));
      const by = clampY(mapY(fb.batY));
      const rx = (fb.powerSwing ? 14 : 20) * u;
      const ry = (fb.powerSwing ? 11 : 15) * u;
      const col = fb.powerSwing ? '#f97316' : '#f4c41c';
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.8, 2.2 * u);
      ctx.beginPath();
      ctx.ellipse(bx, by, rx, ry, 0, Math.PI * 0.68, Math.PI * 1.32);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(bx, by, rx, ry, 0, -Math.PI * 0.32, Math.PI * 0.32);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(bx, by, 2.5 * u, 0, Math.PI * 2);
      ctx.fill();
    }

    // Actual bottle cap crossing dot
    const cx = clampX(mapX(fb.plateX));
    const cy = clampY(mapY(fb.plateY));
    const revealT =
      typeof fb.absRevealElapsed === 'number' && fb.absRevealElapsed >= 0 && fb.absRevealElapsed < 0.32
        ? fb.absRevealElapsed / 0.32
        : null;
    const popScale = revealT !== null ? 1.45 - 0.45 * revealT : 1;

    if (revealT !== null) {
      // Crisp in-place flip/scan flash when revealing real pitch location after ABS window ends
      ctx.fillStyle = `rgba(56, 189, 248, ${(1 - revealT) * 0.32})`;
      ctx.fillRect(ox, plotY, w, plotH);
      ctx.strokeStyle = `rgba(125, 211, 252, ${1 - revealT})`;
      ctx.lineWidth = Math.max(1.8, 2.4 * u);
      ctx.beginPath();
      ctx.arc(cx, cy, dotR * (1.2 + revealT * 2.1), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, dotR * popScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fb.callColor || '#38bdf8';
    ctx.lineWidth = Math.max(2, 2.5 * u);
    ctx.stroke();
    ctx.fillStyle = fb.callColor || '#38bdf8';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2 * u * popScale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore(); // end plot clip
  ctx.restore();
}

function drawTimingSubPanel(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  w: number,
  h: number,
  fb: OnZoneFeedbackState,
  u: number,
  dpr: number,
  includeEvFooter: boolean,
): void {
  const hasEv = includeEvFooter && Boolean(fb.contact && typeof fb.exitSpeedKmh === 'number');
  const headH = Math.round(22 * u);
  const badgeH = Math.round(24 * u);
  const evH = hasEv ? Math.round(22 * u) : 0;
  const bodyY = oy + headH;
  const bodyH = Math.max(52 * u, h - headH - badgeH - evH);

  ctx.save();
  // Row 1: Header
  ctx.fillStyle = '#152039';
  ctx.fillRect(ox, oy, w, headH);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = `700 ${Math.round(11.5 * u)}px "Chakra Petch", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fb.timingTitle, ox + w / 2, oy + headH * 0.52, w - 10 * u);

  // Row 2: Strictly Clipped Dirt Box + MLB The Show Over-Home-Plate Bat & Annular Timing Fan
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, bodyY, w, bodyH);
  ctx.clip();

  ctx.fillStyle = 'rgba(54, 36, 27, 0.97)';
  ctx.fillRect(ox, bodyY, w, bodyH);

  // Batter-box chalk lines framing home plate
  const chalkInset = Math.round(w * 0.14);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
  ctx.lineWidth = Math.max(1.4, 1.8 * u);
  ctx.beginPath();
  ctx.moveTo(ox + chalkInset, bodyY);
  ctx.lineTo(ox + chalkInset, bodyY + bodyH);
  ctx.moveTo(ox + w - chalkInset, bodyY);
  ctx.lineTo(ox + w - chalkInset, bodyY + bodyH);
  ctx.stroke();

  // Prominent Home Plate Pentagon centered in the dirt box (MLB The Show style)
  const plateCx = ox + w * 0.5;
  const plateCy = bodyY + bodyH * 0.58;
  const pHalfW = Math.min(w * 0.16, bodyH * 0.24);
  const pTopH = pHalfW * 0.58;
  const pBotH = pHalfW * 0.72;
  ctx.fillStyle = 'rgba(241, 245, 249, 0.92)';
  ctx.beginPath();
  ctx.moveTo(plateCx - pHalfW, plateCy - pTopH);
  ctx.lineTo(plateCx + pHalfW, plateCy - pTopH);
  ctx.lineTo(plateCx + pHalfW, plateCy + pTopH * 0.25);
  ctx.lineTo(plateCx, plateCy + pBotH);
  ctx.lineTo(plateCx - pHalfW, plateCy + pTopH * 0.25);
  ctx.closePath();
  ctx.fill();

  // Handedness-matched bat pivot reaching ALL THE WAY ACROSS home plate!
  // LHB stands on RIGHT -> pivot near right chalk, barrel sweeps across center plate toward left.
  // RHB stands on LEFT  -> pivot near left chalk, barrel sweeps across center plate toward right.
  const isLefty = fb.batterHandedness === 'left';
  const pivotX = isLefty ? ox + w * 0.86 : ox + w * 0.14;
  const pivotY = bodyY + bodyH * 0.52;
  const batLen = w * 0.72;
  const innerR = batLen * 0.2;
  const outerR = batLen * 0.94;
  const dt = Math.max(-0.15, Math.min(0.15, fb.dtTiming ?? 0));
  const norm = dt / 0.15; // -1 early, 0 perfect, +1 late

  const baseAngle = isLefty ? Math.PI : 0;
  const dirSign = isLefty ? -1 : 1;
  // Continuous annular Early -> Good -> Late timing spectrum sweeping DIRECTLY OVER HOME PLATE
  const a0 = baseAngle - 0.24 * Math.PI;
  const a1 = baseAngle + 0.24 * Math.PI;
  const aMin = Math.min(a0, a1);
  const aMax = Math.max(a0, a1);
  const span = aMax - aMin;
  if (typeof ctx.createConicGradient === 'function') {
    const frac = span / (Math.PI * 2);
    const grad = ctx.createConicGradient(aMin, pivotX, pivotY);
    grad.addColorStop(0.0, 'rgba(239, 68, 68, 0.72)');
    grad.addColorStop(0.18 * frac, 'rgba(249, 115, 22, 0.74)');
    grad.addColorStop(0.35 * frac, 'rgba(250, 204, 21, 0.78)');
    grad.addColorStop(0.5 * frac, 'rgba(34, 197, 94, 0.84)');
    grad.addColorStop(0.65 * frac, 'rgba(250, 204, 21, 0.78)');
    grad.addColorStop(0.82 * frac, 'rgba(249, 115, 22, 0.74)');
    grad.addColorStop(1.0 * frac, 'rgba(239, 68, 68, 0.72)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, outerR, aMin, aMax, false);
    ctx.arc(pivotX, pivotY, innerR, aMax, aMin, true);
    ctx.closePath();
    ctx.fill();
  } else {
    // Smooth 48-slice continuous fallback for older canvas runtimes
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      const tMid = (i + 0.5) / steps;
      const d = Math.abs(tMid - 0.5) * 2; // 0 at center (green), 1 at edges (red)
      const hue = Math.round(142 * (1 - d));
      const sa0 = aMin + (span * i) / steps;
      const sa1 = aMin + (span * (i + 1)) / steps + 0.002;
      ctx.fillStyle = `hsla(${hue}, 82%, 52%, ${0.84 - d * 0.12})`;
      ctx.beginPath();
      ctx.arc(pivotX, pivotY, outerR, sa0, Math.min(aMax, sa1), false);
      ctx.arc(pivotX, pivotY, innerR, Math.min(aMax, sa1), sa0, true);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Bat sweeping directly over home plate!
  const batAngle = baseAngle + dirSign * norm * 0.22 * Math.PI;
  const cosA = Math.cos(batAngle);
  const sinA = Math.sin(batAngle);
  const handleEndX = pivotX + cosA * (batLen * 0.34);
  const handleEndY = pivotY + sinA * (batLen * 0.34);
  const tipX = pivotX + cosA * (batLen * 0.96);
  const tipY = pivotY + sinA * (batLen * 0.96);

  // Cream/white handle
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = Math.max(2.6, 3.8 * u);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(handleEndX, handleEndY);
  ctx.stroke();

  // Bold dark barrel with crisp light rim over home plate
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = Math.max(5.2, 7.2 * u);
  ctx.beginPath();
  ctx.moveTo(handleEndX, handleEndY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = Math.max(3.8, 5.4 * u);
  ctx.beginPath();
  ctx.moveTo(handleEndX, handleEndY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Bottle cap contact point positioned DEAD-CENTER ON THE BARREL OVER HOME PLATE!
  const capDist = batLen * 0.5;
  const capX = pivotX + cosA * capDist;
  const capY = pivotY + sinA * capDist;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(capX, capY, Math.max(4, 5 * u), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f43f5e';
  ctx.lineWidth = Math.max(1.3, 1.8 * u);
  ctx.stroke();

  ctx.restore(); // end dirt-box clip

  // Row 3: Dedicated Timing Grade Strip
  const badgeY = bodyY + bodyH;
  const rawColor = fb.timingColor || '#4ade80';
  const brightTextColor =
    rawColor === '#94a3b8' || rawColor === '#64748b' || rawColor === '#475569' ? '#fb7185' : rawColor;
  ctx.fillStyle = '#0a101f';
  ctx.fillRect(ox, badgeY, w, badgeH);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(ox, badgeY, w, Math.max(1, Math.round(dpr)));
  ctx.fillStyle = brightTextColor;
  ctx.font = `800 ${Math.round(12.5 * u)}px "Chakra Petch", sans-serif`;
  ctx.fillText(fb.timingLabel || fb.callLabel, ox + w / 2, badgeY + badgeH * 0.54, w - 10 * u);

  // Row 4: Dedicated EV / LA Bar (only in vertical mode; horizontal mode renders full-width EV footer)
  if (hasEv && typeof fb.exitSpeedKmh === 'number') {
    const evY = badgeY + badgeH;
    ctx.fillStyle = '#070b14';
    ctx.fillRect(ox, evY, w, evH);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(ox, evY, w, Math.max(1, Math.round(dpr)));
    ctx.fillStyle = '#f8fafc';
    ctx.font = `700 ${Math.round(11 * u)}px "Chakra Petch", sans-serif`;
    const laTxt = typeof fb.launchAngleDeg === 'number' ? ` · ${fb.laPrefix}${Math.round(fb.launchAngleDeg)}°` : '';
    ctx.fillText(`${fb.evPrefix}${Math.round(fb.exitSpeedKmh)}${laTxt}`, ox + w / 2, evY + evH * 0.54, w - 10 * u);
  }

  ctx.restore();
}

function drawStackedSideFeedback(
  ctx: CanvasRenderingContext2D,
  liveCam: GameCamera,
  width: number,
  height: number,
  fb: OnZoneFeedbackState,
  alpha: number,
  role: OverlayState['role'],
  hudBottomPx: number | undefined,
  dpr: number,
): void {
  const isLefty = fb.batterHandedness === 'left';
  const isSwing = fb.kind === 'swing';
  const hasEv = Boolean(fb.contact && typeof fb.exitSpeedKmh === 'number');
  const hasDetail = Boolean(fb.resultDetail && fb.resultDetail.trim().length > 0);
  const isPortrait = height > width;
  const accent = fb.callColor || '#38bdf8';

  // Project resting home-plate strike zone using dedicated stationary restCam (NEVER moves when live cam pans!)
  restCam.setViewport(width, height);
  restCam.setTargetCenterYRatio(liveCam.getRestCenterYRatio(), true);
  restCam.resetImmediate();

  const hw = PLATE_WIDTH * 0.5;
  const ztl = restCam.project([-hw, STRIKE_ZONE_HI, HIT_PLANE_Z]);
  const ztr = restCam.project([hw, STRIKE_ZONE_HI, HIT_PLANE_Z]);
  const zbr = restCam.project([hw, STRIKE_ZONE_LO, HIT_PLANE_Z]);
  const zbl = restCam.project([-hw, STRIKE_ZONE_LO, HIT_PLANE_Z]);

  const zLeft = Math.min(ztl.sx, zbl.sx);
  const zRight = Math.max(ztr.sx, zbr.sx);
  const zTop = Math.min(ztl.sy, ztr.sy);
  const zBottom = Math.max(zbl.sy, zbr.sy);
  const zoneMidY = (zTop + zBottom) * 0.5;

  // Catcher-camera view: LHB stands on RIGHT -> open side is LEFT; RHB stands on LEFT -> open side is RIGHT
  const placeOnRight = !isLefty;
  const edgePad = Math.round((isPortrait ? 5 : 14) * dpr);
  const gap = Math.round((isPortrait ? 6 : 18) * dpr);
  const topSafe = Math.round(
    Math.max(
      (hudBottomPx ?? (isPortrait ? 92 * dpr : 104 * dpr)) + 8 * dpr,
      height * 0.11,
    ),
  );
  const bottomReserve = isPortrait && role === 'pitcher' ? Math.round(182 * dpr) : edgePad;
  const maxAvailH = Math.max(180 * dpr, height - topSafe - bottomReserve);

  // ALWAYS stay in the open side beside the strike zone (Phone, Tablet & Desktop!)
  // Strictly bounded to <= sideSpace so it NEVER covers the strike zone or top Play Call banner!
  const sideSpace = Math.max(88 * dpr, placeOnRight ? width - zRight - gap - edgePad : zLeft - gap - edgePad);
  const desiredMaxW = isPortrait ? 168 * dpr : 240 * dpr;
  let cardW = Math.round(Math.min(desiredMaxW, sideSpace));
  // Keep fonts large and readable even on compact portrait phones
  let u = Math.max(0.74 * dpr, cardW / 182);

  const calcVert = (sc: number) => {
    const outH = Math.round((hasDetail ? 38 : 28) * sc);
    const topH = Math.round(138 * sc);
    const botH = isSwing ? Math.round((hasEv ? 156 : 134) * sc) : 0;
    const divH = Math.max(1, Math.round(2 * dpr));
    const total = outH + divH + topH + (isSwing ? divH + botH : 0);
    return { outH, topH, botH, divH, total };
  };
  let hSpec = calcVert(u);
  if (hSpec.total > maxAvailH) {
    const fitRatio = maxAvailH / hSpec.total;
    u *= fitRatio;
    hSpec = calcVert(u);
  }

  const maxY = Math.max(topSafe, height - bottomReserve - hSpec.total);
  const rawX = placeOnRight ? Math.round(zRight + gap) : Math.round(zLeft - gap - cardW);
  const x = clamp(rawX, edgePad, Math.max(edgePad, width - cardW - edgePad));
  const y = clamp(Math.round(zoneMidY - hSpec.total * 0.5), topSafe, maxY);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Crisp shadow
  ctx.fillStyle = 'rgba(5, 8, 16, 0.88)';
  ctx.fillRect(x + 4 * dpr, y + 4 * dpr, cardW, hSpec.total);

  // Top Consolidated Outcome Banner
  ctx.fillStyle = '#090f1e';
  ctx.fillRect(x, y, cardW, hSpec.outH);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, cardW, Math.round(3.5 * dpr));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = accent;
  ctx.font = `800 ${Math.round(14.5 * u)}px "Chakra Petch", sans-serif`;
  if (hasDetail && fb.resultDetail) {
    ctx.fillText(fb.callLabel, x + cardW / 2, y + hSpec.outH * 0.39, cardW - 10 * u);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `700 ${Math.round(10 * u)}px "Chakra Petch", sans-serif`;
    ctx.fillText(fb.resultDetail, x + cardW / 2, y + hSpec.outH * 0.77, cardW - 10 * u);
  } else {
    ctx.fillText(fb.callLabel, x + cardW / 2, y + hSpec.outH * 0.56, cardW - 10 * u);
  }

  const topPanelY = y + hSpec.outH + hSpec.divH;
  ctx.fillStyle = '#334155';
  ctx.fillRect(x, y + hSpec.outH, cardW, hSpec.divH);

  // Top sub-panel: Pitch Location (+ PCI if swung) + Pitch Speed & Break
  drawPitchLocationSubPanel(ctx, x, topPanelY, cardW, hSpec.topH, fb, u, dpr);

  // Bottom sub-panel: Swing Timing (bat over plate!) + EV/LA (if swung)
  if (isSwing) {
    const div2Y = topPanelY + hSpec.topH;
    ctx.fillStyle = '#334155';
    ctx.fillRect(x, div2Y, cardW, hSpec.divH);
    drawTimingSubPanel(ctx, x, div2Y + hSpec.divH, cardW, hSpec.botH, fb, u, dpr, true);
  }

  // Outer crisp border
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.6, 2 * dpr);
  ctx.strokeRect(x, y, cardW, hSpec.total);

  ctx.restore();
}
