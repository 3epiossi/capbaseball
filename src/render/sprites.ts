import type { FieldV3 } from '../physics/batted';
import type { GameCamera } from './camera';
import { drawTrue3DCap } from './cap3d';
import type { DepthDrawItem } from './gymScene';

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  duration?: number;
}

interface AtlasData {
  frames: Record<string, AtlasFrame>;
  animations: Record<string, { frames: string[]; loop: boolean; duration: number }>;
}

interface PitcherMeta {
  frames: number;
  fps: number;
  w: number;
  h: number;
  baseline_y: number;
  release_frame: number;
  idle_frame: number;
}

export interface BatterRealMeta {
  frames: number;
  w: number;
  h: number;
  baseline_y: number;
  anchor_x: number;
  natural_handedness: 'left' | 'right';
  anims: {
    ready: number[];
    load: number[];
    swing_early: number[];
    swing_contact: number[];
    follow_through: number[];
  };
}

export interface SpriteBank {
  ready: boolean;
  pitcherYellow: HTMLImageElement | null;
  pitcherBlack: HTMLImageElement | null;
  pitcherMeta: PitcherMeta;
  fielderYellow: HTMLImageElement | null;
  fielderBlack: HTMLImageElement | null;
  fielderAtlas: AtlasData | null;
  batterRealHome: HTMLImageElement | null;
  batterRealAway: HTMLImageElement | null;
  batterRealMeta: BatterRealMeta;
  fxHitImg: HTMLImageElement | null;
  fxHitAtlas: AtlasData | null;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadJson<T>(src: string): Promise<T | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadSprites(): Promise<SpriteBank> {
  const [
    pitcherYellow,
    pitcherBlack,
    pitcherMeta,
    fielderYellow,
    fielderBlack,
    fielderAtlas,
    batterRealHome,
    batterRealAway,
    batterRealMeta,
    fxHitImg,
    fxHitAtlas,
  ] = await Promise.all([
    loadImage('./sprites/pitcher_strip.png'),
    loadImage('./sprites/pitcher_black_strip.png'),
    loadJson<PitcherMeta>('./sprites/pitcher.json'),
    loadImage('./sprites/fielder_yellow.png'),
    loadImage('./sprites/fielder_black.png'),
    loadJson<AtlasData>('./sprites/fielder.atlas.json'),
    loadImage('./sprites/batter_real_yellow_strip.png'),
    loadImage('./sprites/batter_real_black_strip.png'),
    loadJson<BatterRealMeta>('./sprites/batter_real.json'),
    loadImage('./sprites/fx_hit.png'),
    loadJson<AtlasData>('./sprites/fx_hit.atlas.json'),
  ]);

  return {
    ready: true,
    pitcherYellow,
    pitcherBlack,
    pitcherMeta: pitcherMeta ?? {
      frames: 60,
      fps: 24,
      w: 113,
      h: 113,
      baseline_y: 112,
      release_frame: 30,
      idle_frame: 0,
    },
    fielderYellow,
    fielderBlack,
    fielderAtlas,
    batterRealHome,
    batterRealAway,
    batterRealMeta: batterRealMeta ?? {
      frames: 10,
      w: 148,
      h: 114,
      baseline_y: 112,
      anchor_x: 62,
      natural_handedness: 'left',
      anims: {
        ready: [0, 1, 2, 1],
        load: [3],
        swing_early: [4],
        swing_contact: [4, 5],
        follow_through: [6, 7, 8, 9],
      },
    },
    fxHitImg,
    fxHitAtlas,
  };
}

export type TeamColor = 'yellow' | 'black';
export type FielderAnim = 'idle' | 'run' | 'dive';
export type BatterAnim = 'ready' | 'load' | 'swing_early' | 'swing_contact' | 'follow_through';

export interface DrawEntityListParams {
  bank: SpriteBank;
  cam: GameCamera;
  timeSec: number;
  pitchingTeam: TeamColor;
  battingTeam: TeamColor;
  pitcherFrame: number; // 0 = idle, 8..59 = pitching
  fielders: {
    pos: FieldV3;
    anim: FielderAnim;
    animTime: number;
    flipX: boolean;
  }[];
  batter: {
    handedness: 'left' | 'right';
    anim: BatterAnim;
    animTime: number;
    alpha: number;
  };
  cap: {
    pos: FieldV3;
    normalField: FieldV3;
    teamColor: TeamColor;
    trail: FieldV3[];
    visible: boolean;
    isFlyBall: boolean;
  };
  hitFx: {
    active: boolean;
    pos: FieldV3;
    kind: 'hit' | 'hr_burst';
    elapsedSec: number;
  } | null;
  fenceItems?: DepthDrawItem[];
  battedEffects?: {
    bounceRings: {
      pos: FieldV3;
      ageSec: number;
      maxAgeSec: number;
      infield: boolean;
    }[];
    fenceImpact: {
      pos: FieldV3;
      ageSec: number;
      maxAgeSec: number;
    } | null;
    hrBurst: {
      pos: FieldV3;
      ageSec: number;
      maxAgeSec: number;
    } | null;
  };
}

function drawGroundShadow(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  pos: FieldV3,
  radiusM: number,
  alpha = 0.34,
): void {
  const pr = cam.project([pos[0], 0.005, pos[2]]);
  if (!pr.visible || pr.depth <= 0.2) return;
  const rx = Math.max(2, Math.round(pr.scale * radiusM));
  const ry = Math.max(1, Math.round(rx * 0.42));
  ctx.save();
  ctx.fillStyle = `rgba(20, 12, 8, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(Math.round(pr.sx), Math.round(pr.sy), rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function pickAtlasFrame(
  atlas: AtlasData | null,
  animName: string,
  animTimeSec: number,
): AtlasFrame | null {
  if (!atlas) return null;
  const anim = atlas.animations[animName];
  if (!anim || anim.frames.length === 0) return null;
  const ms = Math.max(0, animTimeSec * 1000);
  const total = anim.duration || 100;
  const t = anim.loop ? ms % total : Math.min(ms, total - 1);
  let acc = 0;
  for (const fname of anim.frames) {
    const f = atlas.frames[fname];
    const dur = f?.duration ?? total / anim.frames.length;
    acc += dur;
    if (t < acc) return f;
  }
  return atlas.frames[anim.frames[anim.frames.length - 1]] ?? null;
}

function pickBatterRealFrame(
  meta: BatterRealMeta,
  anim: BatterAnim,
  animTimeSec: number,
): number {
  const t = Math.max(0, animTimeSec);
  switch (anim) {
    case 'ready': {
      const seq = meta.anims.ready;
      return seq[Math.floor(t * 3.5) % seq.length] ?? 0;
    }
    case 'load':
      return meta.anims.load[0] ?? 3;
    case 'swing_early':
      return meta.anims.swing_early[0] ?? 4;
    case 'swing_contact':
      return t < 0.045 ? (meta.anims.swing_contact[0] ?? 4) : (meta.anims.swing_contact[1] ?? 5);
    case 'follow_through': {
      const ft = meta.anims.follow_through;
      if (t < 0.065) return ft[0] ?? 6;
      if (t < 0.145) return ft[1] ?? 7;
      if (t < 0.26) return ft[2] ?? 8;
      return ft[3] ?? 9;
    }
  }
}

function drawSpriteFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  flipX: boolean,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (flipX) {
    ctx.translate(Math.round(dx + dw * 0.5), 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, Math.round(-dw * 0.5), Math.round(dy), Math.round(dw), Math.round(dh));
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
  }
  ctx.restore();
}

function drawBottleCap(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  pos: FieldV3,
  normalField: FieldV3,
  teamColor: TeamColor,
  trail: FieldV3[],
  isFlyBall: boolean,
  timeSec: number,
): void {
  // Ground shadow
  const heightFade = Math.max(0.16, 0.48 - pos[1] * 0.08);
  drawGroundShadow(ctx, cam, pos, 0.075, heightFade);

  // Vertical Plumb Line from (capX, capY, capZ) straight down to (capX, 0, capZ)
  if (isFlyBall && pos[1] > 0.04) {
    const pTop = cam.project(pos);
    const pBot = cam.project([pos[0], 0, pos[2]]);
    if (pTop.depth > 0.15 && pBot.depth > 0.15) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 224, 92, 0.72)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pTop.sx, pTop.sy);
      ctx.lineTo(pBot.sx, pBot.sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Motion trail
  for (let i = 0; i < trail.length; i++) {
    const tp = cam.project(trail[i]);
    if (!tp.visible || tp.depth <= 0.2) continue;
    const tRatio = (i + 1) / (trail.length + 1);
    const r = Math.max(1, Math.round(tp.scale * 0.032 * tRatio));
    ctx.fillStyle = isFlyBall
      ? `rgba(255, 224, 66, ${(0.14 + tRatio * 0.36).toFixed(3)})`
      : `rgba(255, 255, 255, ${(0.12 + tRatio * 0.35).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(Math.round(tp.sx), Math.round(tp.sy), r, 0, Math.PI * 2);
    ctx.fill();
  }

  const pr = cam.project(pos);
  if (!pr.visible || pr.depth <= 0.15) return;

  const rPx = Math.max(2.6, pr.scale * 0.04);
  const cx = Math.round(pr.sx);
  const cy = Math.round(pr.sy);

  // Fly ball glowing yellow tracking ring + pointer arrow
  if (isFlyBall) {
    const pulse = 0.65 + 0.35 * Math.sin(timeSec * 14);
    ctx.save();
    ctx.strokeStyle = `rgba(255, 224, 66, ${pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(rPx + 4, 6), 0, Math.PI * 2);
    ctx.stroke();

    const ay = cy - Math.max(rPx + 8, 11);
    ctx.fillStyle = '#ffe042';
    ctx.beginPath();
    ctx.moveTo(cx, ay + 4);
    ctx.lineTo(cx - 3, ay);
    ctx.lineTo(cx + 3, ay);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const accentColor = teamColor === 'yellow' ? '#f2c81e' : '#1e232b';
  drawTrue3DCap(ctx, cam, pos, normalField, rPx, accentColor, 1);
}

function drawFloorRing3D(
  ctx: CanvasRenderingContext2D,
  cam: GameCamera,
  center: FieldV3,
  radiusM: number,
  color: string,
  lineWidth = 2,
): void {
  const steps = 20;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const pr = cam.project([
      center[0] + Math.cos(a) * radiusM,
      0.015,
      center[2] + Math.sin(a) * radiusM,
    ]);
    if (pr.depth <= 0.15) continue;
    if (!started) {
      ctx.moveTo(pr.sx, pr.sy);
      started = true;
    } else {
      ctx.lineTo(pr.sx, pr.sy);
    }
  }
  if (started) {
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawWorldEntities(
  ctx: CanvasRenderingContext2D,
  params: DrawEntityListParams,
): void {
  const { bank, cam, timeSec } = params;

  const items: DepthDrawItem[] = params.fenceItems ? [...params.fenceItems] : [];

  // 0. Floor Bounce Ripple Rings & Fence/HR Effects
  if (params.battedEffects) {
    for (const ring of params.battedEffects.bounceRings) {
      const pr = cam.project(ring.pos);
      if (pr.depth <= 0.2) continue;
      const t = Math.min(1, ring.ageSec / Math.max(0.05, ring.maxAgeSec));
      const alpha = (1 - t) * 0.92;
      const rM = 0.14 + t * 0.72;
      const col = ring.infield
        ? `rgba(239, 68, 68, ${alpha.toFixed(3)})`
        : `rgba(74, 222, 128, ${alpha.toFixed(3)})`;
      items.push({
        depth: pr.depth + 0.08,
        draw: () => drawFloorRing3D(ctx, cam, ring.pos, rM, col, 2),
      });
    }

    const fi = params.battedEffects.fenceImpact;
    if (fi) {
      const pr = cam.project(fi.pos);
      if (pr.depth > 0.2 && pr.visible) {
        const t = Math.min(1, fi.ageSec / Math.max(0.05, fi.maxAgeSec));
        const alpha = (1 - t) * 0.95;
        items.push({
          depth: pr.depth - 0.04,
          draw: () => {
            const rPx = Math.max(4, pr.scale * (0.12 + t * 0.65));
            ctx.save();
            ctx.strokeStyle = `rgba(255, 240, 150, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(pr.sx, pr.sy, rPx, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          },
        });
      }
    }

    const hb = params.battedEffects.hrBurst;
    if (hb) {
      const pr = cam.project(hb.pos);
      if (pr.depth > 0.2 && pr.visible) {
        const t = Math.min(1, hb.ageSec / Math.max(0.05, hb.maxAgeSec));
        const alpha = (1 - t) * 0.95;
        items.push({
          depth: pr.depth - 0.06,
          draw: () => {
            const rPx = Math.max(6, pr.scale * (0.2 + t * 1.1));
            ctx.save();
            ctx.strokeStyle = `rgba(255, 210, 63, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(pr.sx, pr.sy, rPx, 0, Math.PI * 2);
            ctx.stroke();
            for (let k = 0; k < 8; k++) {
              const ang = (k / 8) * Math.PI * 2 + t * 1.5;
              ctx.beginPath();
              ctx.moveTo(pr.sx + Math.cos(ang) * rPx * 0.45, pr.sy + Math.sin(ang) * rPx * 0.45);
              ctx.lineTo(pr.sx + Math.cos(ang) * rPx * 1.15, pr.sy + Math.sin(ang) * rPx * 1.15);
              ctx.stroke();
            }
            ctx.restore();
          },
        });
      }
    }
  }

  // 1. Pitcher at mound (0, 0, -9.22)
  {
    const pPos: FieldV3 = [0, 0, -9.22];
    const pr = cam.project(pPos);
    if (pr.visible && pr.depth > 0.2) {
      items.push({
        depth: pr.depth,
        draw: () => {
          drawGroundShadow(ctx, cam, pPos, 0.34, 0.34);
          const img = params.pitchingTeam === 'yellow' ? bank.pitcherYellow : bank.pitcherBlack;
          const meta = bank.pitcherMeta;
          const frameIdx = Math.max(0, Math.min(meta.frames - 1, Math.floor(params.pitcherFrame)));
          const heightM = 1.72;
          const dh = Math.max(18, pr.scale * heightM);
          const dw = dh * (meta.w / meta.h);
          const breathe = frameIdx === 0 ? Math.sin(timeSec * 3.2) * 0.7 : 0;
          const dx = pr.sx - dw * 0.5;
          const dy = pr.sy - dh * (meta.baseline_y / meta.h) + breathe;
          if (img) {
            drawSpriteFrame(
              ctx,
              img,
              frameIdx * meta.w,
              0,
              meta.w,
              meta.h,
              dx,
              dy,
              dw,
              dh,
              false,
              1,
            );
          } else {
            ctx.fillStyle = params.pitchingTeam === 'yellow' ? '#f2c81e' : '#1e232b';
            ctx.fillRect(Math.round(pr.sx - 6), Math.round(pr.sy - 26), 12, 26);
          }
        },
      });
    }
  }

  // 2. Outfielders (LF & RF)
  for (const f of params.fielders) {
    const pr = cam.project(f.pos);
    if (pr.visible && pr.depth > 0.2) {
      items.push({
        depth: pr.depth,
        draw: () => {
          drawGroundShadow(ctx, cam, f.pos, 0.32, 0.32);
          const img = params.pitchingTeam === 'yellow' ? bank.fielderYellow : bank.fielderBlack;
          const frame = pickAtlasFrame(bank.fielderAtlas, f.anim, f.animTime);
          const heightM = 1.66;
          const dh = Math.max(14, pr.scale * heightM);
          const dw = dh * (32 / 40);
          const dx = pr.sx - dw * 0.5;
          const dy = pr.sy - dh * (35.5 / 40);
          if (img && frame) {
            drawSpriteFrame(
              ctx,
              img,
              frame.frame.x,
              frame.frame.y,
              frame.frame.w,
              frame.frame.h,
              dx,
              dy,
              dw,
              dh,
              f.flipX,
              1,
            );
          } else {
            ctx.fillStyle = params.pitchingTeam === 'yellow' ? '#f2c81e' : '#1e232b';
            ctx.fillRect(Math.round(pr.sx - 5), Math.round(pr.sy - 22), 10, 22);
          }
        },
      });
    }
  }

  // 3. Foreground Batter
  {
    // Natural orientation is left-handed ('left') in RIGHT box (+0.76, z=0.14);
    // right-handed ('right') mirrors around anchor_x in LEFT box (-0.76, z=0.14).
    const bx = params.batter.handedness === 'right' ? -0.76 : 0.76;
    const bPos: FieldV3 = [bx, 0, 0.14];
    const pr = cam.project(bPos);
    if (pr.visible && pr.depth > 0.2) {
      items.push({
        depth: pr.depth,
        draw: () => {
          drawGroundShadow(ctx, cam, bPos, 0.32, 0.28);
          const img = params.battingTeam === 'yellow' ? bank.batterRealHome : bank.batterRealAway;
          const meta = bank.batterRealMeta;
          const frameIdx = Math.max(
            0,
            Math.min(meta.frames - 1, pickBatterRealFrame(meta, params.batter.anim, params.batter.animTime)),
          );
          const heightM = 1.72;
          const dh = Math.max(20, pr.scale * heightM);
          const dw = dh * (meta.w / meta.h);
          const flipX = params.batter.handedness === 'right';
          const axFrac = meta.anchor_x / meta.w;
          const dx = flipX ? pr.sx - dw * (1 - axFrac) : pr.sx - dw * axFrac;
          const dy = pr.sy - dh * (meta.baseline_y / meta.h);
          if (img) {
            drawSpriteFrame(
              ctx,
              img,
              frameIdx * meta.w,
              0,
              meta.w,
              meta.h,
              dx,
              dy,
              dw,
              dh,
              flipX,
              params.batter.alpha,
            );
          } else {
            ctx.save();
            ctx.globalAlpha = params.batter.alpha;
            ctx.fillStyle = params.battingTeam === 'yellow' ? '#f2c81e' : '#1e232b';
            ctx.fillRect(Math.round(pr.sx - 12), Math.round(pr.sy - 64), 24, 64);
            ctx.restore();
          }
        },
      });
    }
  }

  // 4. Bottle Cap
  if (params.cap.visible) {
    const pr = cam.project(params.cap.pos);
    items.push({
      depth: Math.max(0.25, pr.depth),
      draw: () => {
        drawBottleCap(
          ctx,
          cam,
          params.cap.pos,
          params.cap.normalField,
          params.cap.teamColor,
          params.cap.trail,
          params.cap.isFlyBall,
          timeSec,
        );
      },
    });
  }

  // 5. Hit / HR FX
  if (params.hitFx && params.hitFx.active && bank.fxHitImg && bank.fxHitAtlas) {
    const fx = params.hitFx;
    const pr = cam.project(fx.pos);
    if (pr.visible && pr.depth > 0.2) {
      const frame = pickAtlasFrame(bank.fxHitAtlas, fx.kind, fx.elapsedSec);
      if (frame) {
        items.push({
          depth: pr.depth - 0.05,
          draw: () => {
            const size = Math.max(24, pr.scale * (fx.kind === 'hr_burst' ? 1.1 : 0.72));
            drawSpriteFrame(
              ctx,
              bank.fxHitImg!,
              frame.frame.x,
              frame.frame.y,
              frame.frame.w,
              frame.frame.h,
              pr.sx - size * 0.5,
              pr.sy - size * 0.5,
              size,
              size,
              false,
              1,
            );
          },
        });
      }
    }
  }

  // Painter's algorithm: farthest first
  items.sort((a, b) => b.depth - a.depth);
  for (const it of items) {
    it.draw();
  }
}
