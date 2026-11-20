import type { FieldV3 } from '../physics/batted';
import type { PitchId } from '../physics/pitches';
import { PLATE_WIDTH, STRIKE_ZONE_HI, STRIKE_ZONE_LO } from '../rules/field';
import type { GameCamera } from './camera';
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
  powerSwing: boolean;
  showGuideRing: boolean;
  guideProgress: number | null; // 0..1, ~0.85..1.0 is hit window
  // High-DPI Cap rendering
  cap?: OverlayCapState;
  // ABS Hawk-Eye Replay
  absReplay?: AbsReplayState | null;
  // Arcade callout banner
  callout: {
    title: string;
    subtitle: string;
    color: string;
    ttl: number;
    maxTtl: number;
  } | null;
}

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
  if (state.role === 'batter' && (state.phase === 'idle' || state.phase === 'windup' || state.phase === 'pitch_flight')) {
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
      const dotCol = isStrike ? '#22c55e' : '#ef4444';
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
      const signStr = abs.marginCm <= 0 ? '' : '+';
      const tag = `${isStrike ? 'STRIKE' : 'BALL'} (${signStr}${abs.marginCm.toFixed(1)} cm)`;
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
      const bannerTitle = abs.overturned ? 'CALL OVERTURNED!' : 'CALL UPHELD';
      const bannerSub = `ABS HAWK-EYE · ${abs.trueCall === 'strike' ? 'STRIKE' : 'BALL'}`;
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

  // Note: Pitch/Swing play calls (STRIKE / BALL / FOUL / MISS / TOO LATE / HIT / HR)
  // are unified inside the top-left Play Call card beside the scoreboard so the
  // center strike-zone view stays completely unobstructed.
}
