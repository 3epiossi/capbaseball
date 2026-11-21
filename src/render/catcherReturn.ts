import type { GameCamera } from './camera';

export interface CatcherReturnAnim {
  active: boolean;
  elapsedSec: number;
  /** Beat before hand enters so the catcher picks up / grips the cap behind the camera */
  pauseSec: number;
  /** Arm raise to release moment */
  windupSec: number;
  /** Follow-through after release while arm exits frame */
  followThroughSec: number;
  /** Parabolic lob flight time from catcher hand to pitcher glove */
  flightSec: number;
  teamColor: 'yellow' | 'black';
  handedness: 'right' | 'left';
}

export function createCatcherReturnState(): CatcherReturnAnim {
  return {
    active: false,
    elapsedSec: 0,
    pauseSec: 0.36,
    windupSec: 0.1,
    followThroughSec: 0.22,
    flightSec: 0.56,
    teamColor: 'yellow',
    handedness: 'right',
  };
}

export function startCatcherReturn(
  state: CatcherReturnAnim,
  teamColor: 'yellow' | 'black',
  compact = false,
  handedness: 'right' | 'left' = 'right',
): void {
  state.active = true;
  state.elapsedSec = 0;
  state.pauseSec = compact ? 0.22 : 0.36;
  state.windupSec = compact ? 0.07 : 0.1;
  state.followThroughSec = compact ? 0.15 : 0.22;
  state.flightSec = compact ? 0.36 : 0.56;
  state.teamColor = teamColor;
  state.handedness = handedness;
}

export function stepCatcherReturn(state: CatcherReturnAnim, dt: number): void {
  if (!state.active) return;
  state.elapsedSec += dt;
  const totalSec = state.pauseSec + state.windupSec + Math.max(state.followThroughSec, state.flightSec);
  if (state.elapsedSec >= totalSec) {
    state.active = false;
    state.elapsedSec = 0;
  }
}

/**
 * Draw crisp retro pixel-art foreground catcher arm & hand flicking the cap back to the pitcher.
 */
function drawPixelCatcherHand(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  phase: 'windup' | 'follow',
  u: number, // 0..1 within phase
  teamColor: 'yellow' | 'black',
  handedness: 'right' | 'left',
  dpr: number,
): void {
  const dir = handedness === 'right' ? 1 : -1;
  const baseUnit = Math.max(3, Math.round(Math.min(w, h) * 0.0085));
  const px = (n: number) => Math.round(n * baseUnit);

  // Hand anchor in normalized screen coords: enters from bottom-right (or bottom-left for LHP catcher)
  let normX: number;
  let normY: number;
  let rotRad: number;
  let fingersOpen: boolean;

  if (phase === 'windup') {
    // Ease-out upward swing into release position
    const e = 1 - Math.pow(1 - u, 2.2);
    normX = 0.5 + dir * (0.34 - 0.16 * e);
    normY = 1.06 - 0.32 * e;
    rotRad = dir * (-0.36 + 0.24 * e);
    fingersOpen = false;
  } else {
    // Crisp forward-downward whip follow-through and exit
    const e = Math.pow(u, 1.35);
    normX = 0.5 + dir * (0.18 - 0.08 * Math.min(1, u * 1.4));
    normY = 0.74 + 0.38 * e;
    rotRad = dir * (-0.12 - 0.42 * e);
    fingersOpen = true;
  }

  const hx = Math.round(normX * w);
  const hy = Math.round(normY * h);
  const alpha = phase === 'follow' && u > 0.65 ? Math.max(0, 1 - (u - 0.65) / 0.35) : 1;

  const sleeveMain = teamColor === 'yellow' ? '#f4c41c' : '#1e293b';
  const sleeveShade = teamColor === 'yellow' ? '#b45309' : '#0f172a';
  const sleeveTrim = teamColor === 'yellow' ? '#fef08a' : '#38bdf8';
  const skinMain = '#f2c197';
  const skinShade = '#ce9264';
  const outline = '#090d16';

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(hx, hy);
  ctx.rotate(rotRad);
  if (dir < 0) ctx.scale(-1, 1);

  const block = (gx: number, gy: number, gw: number, gh: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(px(gx), px(gy), px(gw), px(gh));
  };

  // Forearm sleeve (extending off bottom-right)
  block(-3, 9, 13, 24, outline);
  block(-2, 10, 11, 23, sleeveMain);
  block(5, 10, 4, 23, sleeveShade);
  block(-2, 10, 11, 2, sleeveTrim); // jersey cuff stripe

  // Wrist & Palm
  block(-4, 0, 12, 11, outline);
  block(-3, 1, 10, 9, skinMain);
  block(4, 1, 3, 9, skinShade);

  // Thumb on left side of palm
  block(-7, 2, 4, 6, outline);
  block(-6, 3, 3, 4, skinMain);

  if (!fingersOpen) {
    // Gripping fingers curled around the bottle cap right before release
    block(-3, -6, 10, 7, outline);
    block(-2, -5, 8, 5, skinMain);
    block(1, -5, 1, 5, skinShade);
    block(4, -5, 1, 5, skinShade);

    // Bottle cap held at fingertips!
    const capCol = teamColor === 'yellow' ? '#f4c41c' : '#38bdf8';
    block(-4, -9, 7, 5, outline);
    block(-3, -8, 5, 3, capCol);
    block(-2, -8, 3, 1, '#ffffff');
  } else {
    // Open splayed fingers after flicking the cap forward
    block(-4, -8, 3, 9, outline);
    block(-3, -7, 2, 8, skinMain);
    block(0, -9, 3, 10, outline);
    block(1, -8, 2, 9, skinMain);
    block(4, -7, 3, 8, outline);
    block(5, -6, 2, 7, skinShade);

    // Subtle crisp release motion lines at early follow-through
    if (u < 0.45) {
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
      ctx.lineWidth = Math.max(1.5, 2 * dpr);
      ctx.beginPath();
      ctx.moveTo(px(-3), px(-12));
      ctx.lineTo(px(-5), px(-17));
      ctx.moveTo(px(2), px(-13));
      ctx.lineTo(px(2), px(-19));
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Draw authentic behind-catcher return throw:
 * 1) Brief beat while catcher catches/grips the cap off-screen
 * 2) Pixel-art foreground throwing hand swings in from bottom-right & flicks the cap
 * 3) Gentle high-arc lob from right-hand release point back to pitcher's glove
 */
export function drawCatcherReturnThrow(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  state: CatcherReturnAnim,
  dpr: number,
): void {
  if (!state.active) return;

  const t = state.elapsedSec;
  if (t < state.pauseSec) return; // Catcher picking up & gripping behind camera

  const releaseT = state.pauseSec + state.windupSec;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const dir = state.handedness === 'right' ? 1 : -1;

  // 1. Cap lob flight (only AFTER release moment!)
  if (t >= releaseT) {
    const flightElapsed = t - releaseT;
    if (flightElapsed <= state.flightSec) {
      const u = Math.max(0, Math.min(1, flightElapsed / Math.max(0.05, state.flightSec)));
      // Smooth ease-out distance so it feels like a relaxed toss back, not a batted rocket
      const distU = 1 - Math.pow(1 - u, 1.28);

      // Start clearly offset to catcher's throwing-hand side (x = ±0.36, y = 1.24, z = +1.05) -> Pitcher glove
      const startX = dir * 0.36;
      const endX = -0.18;
      const startZ = 1.05;
      const endZ = -9.22;
      const startY = 1.24;
      const endY = 1.18;

      const x = startX + (endX - startX) * distU;
      const z = startZ + (endZ - startZ) * distU;
      const arcY = startY + (endY - startY) * distU + Math.sin(Math.PI * u) * 0.88;

      const p = cam.project([x, arcY, z]);
      const g = cam.project([x, 0.02, z]);
      if (p.depth > 0.2) {
        ctx.save();
        // Ground shadow
        if (g.depth > 0.2) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
          ctx.beginPath();
          ctx.ellipse(g.sx, g.sy, Math.max(2, 0.055 * g.scale), Math.max(1, 0.022 * g.scale), 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // Soft lob arc trail
        const uPrev = Math.max(0, u - 0.13);
        const dPrev = 1 - Math.pow(1 - uPrev, 1.28);
        const px = startX + (endX - startX) * dPrev;
        const pz = startZ + (endZ - startZ) * dPrev;
        const py = startY + (endY - startY) * dPrev + Math.sin(Math.PI * uPrev) * 0.88;
        const pPrev = cam.project([px, py, pz]);
        if (pPrev.depth > 0.2) {
          ctx.strokeStyle = 'rgba(248, 250, 252, 0.42)';
          ctx.lineWidth = Math.max(1.5, 2.0 * dpr);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pPrev.sx, pPrev.sy);
          ctx.lineTo(p.sx, p.sy);
          ctx.stroke();
        }

        // Cap puck
        const rad = Math.max(2.6 * dpr, Math.min(8.5 * dpr, 0.023 * p.scale));
        ctx.fillStyle = state.teamColor === 'yellow' ? '#f4c41c' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // 2. Foreground pixel-art catcher throwing hand (windup + release follow-through)
  if (t < releaseT) {
    const u = (t - state.pauseSec) / Math.max(0.01, state.windupSec);
    drawPixelCatcherHand(ctx, w, h, 'windup', Math.max(0, Math.min(1, u)), state.teamColor, state.handedness, dpr);
  } else if (t < releaseT + state.followThroughSec) {
    const u = (t - releaseT) / Math.max(0.01, state.followThroughSec);
    drawPixelCatcherHand(ctx, w, h, 'follow', Math.max(0, Math.min(1, u)), state.teamColor, state.handedness, dpr);
  }
}
