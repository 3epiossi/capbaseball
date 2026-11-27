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
  baseline_y?: number;
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
  pitcherFieldYellow: HTMLImageElement | null;
  pitcherFieldBlack: HTMLImageElement | null;
  pitcherFieldAtlas: AtlasData | null;
  pitcherMeta: PitcherMeta;
  fielderYellow: HTMLImageElement | null;
  fielderBlack: HTMLImageElement | null;
  fielderAtlas: AtlasData | null;
  batterRealHome: HTMLImageElement | null;
  batterRealAway: HTMLImageElement | null;
  batterRealMeta: BatterRealMeta;
  batter18Home: HTMLImageElement | null;
  batter18Away: HTMLImageElement | null;
  batter18Meta: BatterRealMeta;
  fxHitImg: HTMLImageElement | null;
  fxHitAtlas: AtlasData | null;
  fxFieldingImg: HTMLImageElement | null;
  fxFieldingAtlas: AtlasData | null;
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
    pitcherFieldYellow,
    pitcherFieldBlack,
    pitcherFieldAtlas,
    pitcherMeta,
    fielderYellow,
    fielderBlack,
    fielderAtlas,
    batterRealHome,
    batterRealAway,
    batterRealMeta,
    batter18Home,
    batter18Away,
    batter18Meta,
    fxHitImg,
    fxHitAtlas,
    fxFieldingImg,
    fxFieldingAtlas,
  ] = await Promise.all([
    loadImage('./sprites/pitcher_strip.png'),
    loadImage('./sprites/pitcher_black_strip.png'),
    loadImage('./sprites/pitcher_field_yellow.png'),
    loadImage('./sprites/pitcher_field_black.png'),
    loadJson<AtlasData>('./sprites/pitcher_field.atlas.json'),
    loadJson<PitcherMeta>('./sprites/pitcher.json'),
    loadImage('./sprites/fielder_yellow.png'),
    loadImage('./sprites/fielder_black.png'),
    loadJson<AtlasData>('./sprites/fielder.atlas.json'),
    loadImage('./sprites/batter_real_yellow_strip.png'),
    loadImage('./sprites/batter_real_black_strip.png'),
    loadJson<BatterRealMeta>('./sprites/batter_real.json'),
    loadImage('./sprites/batter_18_yellow_strip.png'),
    loadImage('./sprites/batter_18_black_strip.png'),
    loadJson<BatterRealMeta>('./sprites/batter_18.json'),
    loadImage('./sprites/fx_hit.png'),
    loadJson<AtlasData>('./sprites/fx_hit.atlas.json'),
    loadImage('./sprites/fx_fielding.png'),
    loadJson<AtlasData>('./sprites/fx_fielding.atlas.json'),
  ]);

  const defaultLeftBatterMeta: BatterRealMeta = {
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
  };

  return {
    ready: true,
    pitcherYellow,
    pitcherBlack,
    pitcherFieldYellow,
    pitcherFieldBlack,
    pitcherFieldAtlas,
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
    batterRealMeta: batterRealMeta ?? defaultLeftBatterMeta,
    batter18Home,
    batter18Away,
    batter18Meta: batter18Meta ?? {
      ...defaultLeftBatterMeta,
      anchor_x: 86,
      natural_handedness: 'right',
    },
    fxHitImg,
    fxHitAtlas,
    fxFieldingImg,
    fxFieldingAtlas,
  };
}

export type TeamColor = 'yellow' | 'black';
export type FielderAnim = 'idle' | 'run' | 'run_front' | 'run_back' | 'catch_fly' | 'catch_ground' | 'catch_wp' | 'dive';
export type BatterAnim = 'ready' | 'load' | 'swing_early' | 'swing_contact' | 'follow_through';

export interface DrawEntityListParams {
  bank: SpriteBank;
  cam: GameCamera;
  timeSec: number;
  pitchingTeam: TeamColor;
  battingTeam: TeamColor;
  pitcherFrame: number; // 0 = idle, 8..59 = pitching
  pitcherFielder?: {
    active: boolean;
    pos: FieldV3;
    anim: FielderAnim;
    animTime: number;
    flipX: boolean;
  };
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
    posOffset?: readonly [number, number, number];
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
  fieldingFx?: {
    pos: FieldV3;
    kind: 'catch_pop' | 'dive_dust';
    elapsedSec: number;
  }[];
  fenceItems?: DepthDrawItem[];
  battedEffects?: {
    bounceRings: {
      pos: FieldV3;
      ageSec: number;
      maxAgeSec: number;
      infield: boolean;
    }[];
    /** Flash under the fielder's feet when the ball touches him: red = batter out, green = not. */
    touchRing?: { pos: FieldV3; handled: boolean; ageSec: number; maxAgeSec: number } | null;
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

/** Anchor for fly-ball catch white pop FX on the fielder's raised hands. */
export function getFlyCatchHandPos(fielder: {
  id: 'LF' | 'RF' | 'P' | 'C';
  pos: FieldV3;
  flipX: boolean;
}): FieldV3 {
  const isPitcher = fielder.id === 'P';
  const handDx = isPitcher ? 0.14 : 0.03;
  const handY = isPitcher ? 1.52 : 1.46;
  return [
    fielder.pos[0] + (fielder.flipX ? -handDx : handDx),
    handY,
    fielder.pos[2] + 0.08,
  ];
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

function resolveAtlasAnim(
  atlas: AtlasData,
  animName: string,
): { frames: string[]; loop: boolean; duration: number } | null {
  if (atlas.animations[animName]?.frames.length) return atlas.animations[animName];
  if (animName === 'catch_wp') {
    return (
      atlas.animations['catch_ground'] ??
      atlas.animations['dive'] ??
      atlas.animations['idle'] ??
      null
    );
  }
  if (animName === 'run_front' || animName === 'run_back') return atlas.animations['run'] ?? atlas.animations['idle'] ?? null;
  if (animName === 'catch_fly' || animName === 'catch_ground') {
    return atlas.animations['dive'] ?? atlas.animations['idle'] ?? null;
  }
  return atlas.animations['idle'] ?? null;
}

/** Front/back run sprites are drawn as-is: mirroring would flip the back number. */
function mirrorFor(atlas: AtlasData | null, anim: string, flipX: boolean): boolean {
  return flipX && !((anim === 'run_front' || anim === 'run_back') && atlas?.animations[anim]);
}

function pickAtlasFrame(
  atlas: AtlasData | null,
  animName: string,
  animTimeSec: number,
): AtlasFrame | null {
  if (!atlas) return null;
  const anim = resolveAtlasAnim(atlas, animName);
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
  const pickSeq = (seq: number[], durationSec: number, loop = false): number => {
    if (!seq || seq.length === 0) return 0;
    if (seq.length === 1) return seq[0];
    const progress = loop ? (t % durationSec) / durationSec : Math.min(0.9999, t / durationSec);
    return seq[Math.floor(progress * seq.length)] ?? seq[seq.length - 1];
  };
  switch (anim) {
    case 'ready': {
      const seq = meta.anims.ready;
      const fps = seq.length > 4 ? 6.5 : 3.5;
      return seq[Math.floor(t * fps) % seq.length] ?? 0;
    }
    case 'load':
      return pickSeq(meta.anims.load, 0.06);
    case 'swing_early':
      return pickSeq(meta.anims.swing_early, 0.05);
    case 'swing_contact':
      return pickSeq(meta.anims.swing_contact, 0.07);
    case 'follow_through':
      return pickSeq(meta.anims.follow_through, 0.34);
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

    const tr = params.battedEffects.touchRing;
    if (tr) {
      const pr = cam.project(tr.pos);
      if (pr.depth > 0.2) {
        const k = tr.ageSec / tr.maxAgeSec;
        const rM = 0.35 + 0.35 * k;
        const a = (1 - k).toFixed(2);
        const col = tr.handled ? `rgba(239, 68, 68, ${a})` : `rgba(74, 222, 128, ${a})`;
        items.push({
          depth: pr.depth + 0.08,
          draw: () => drawFloorRing3D(ctx, cam, tr.pos, rM, col, 4),
        });
      }
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

  // 1. Pitcher (#18 Skywalker: custom pitching strip on mound; fielding atlas/strip when fielding!)
  {
    const pf = params.pitcherFielder;
    const isFielding = Boolean(pf && pf.active);
    const pPos: FieldV3 = isFielding ? pf!.pos : [0, 0, -9.22];
    const pr = cam.project(pPos);
    if (pr.visible && pr.depth > 0.2) {
      items.push({
        depth: pr.depth,
        draw: () => {
          const isCatchAction =
            isFielding &&
            (pf!.anim === 'dive' || pf!.anim === 'catch_ground' || pf!.anim === 'catch_fly');
          drawGroundShadow(ctx, cam, pPos, isCatchAction ? 0.44 : 0.34, 0.34);
          const fieldImg = params.pitchingTeam === 'yellow' ? bank.pitcherFieldYellow : bank.pitcherFieldBlack;
          const heightM = 1.72;
          const dh = Math.max(18, pr.scale * heightM);

          if (isFielding && pf && fieldImg) {
            const atlasFrame = pickAtlasFrame(bank.pitcherFieldAtlas, pf.anim, pf.animTime);
            if (atlasFrame) {
              const fw = atlasFrame.frame.w;
              const fh = atlasFrame.frame.h;
              const baselineY = bank.pitcherFieldAtlas?.baseline_y ?? fh - 1;
              const dw = dh * (fw / fh);
              const dx = pr.sx - dw * 0.5;
              const dy = pr.sy - dh * (baselineY / fh);
              drawSpriteFrame(
                ctx,
                fieldImg,
                atlasFrame.frame.x,
                atlasFrame.frame.y,
                fw,
                fh,
                dx,
                dy,
                dw,
                dh,
                mirrorFor(bank.pitcherFieldAtlas, pf.anim, pf.flipX),
                1,
              );
              return;
            }
            // Legacy 6-frame horizontal strip fallback (136x113 per frame, baseline_y = 112):
            // 0 = fielding ready, 1..4 = 4-frame sprint cycle, 5 = low ground-scoop lunge
            const fw = 136;
            const fh = 113;
            const baselineY = 112;
            const frameIdx =
              pf.anim === 'dive' || pf.anim === 'catch_ground' || pf.anim === 'catch_fly'
                ? 5
                : pf.anim.startsWith('run')
                  ? 1 + (Math.floor(pf.animTime * 11) % 4)
                  : 0;
            const dw = dh * (fw / fh);
            const dx = pr.sx - dw * 0.5;
            const dy = pr.sy - dh * (baselineY / fh);
            drawSpriteFrame(
              ctx,
              fieldImg,
              frameIdx * fw,
              0,
              fw,
              fh,
              dx,
              dy,
              dw,
              dh,
              pf.flipX,
              1,
            );
            return;
          }

          const img = params.pitchingTeam === 'yellow' ? bank.pitcherYellow : bank.pitcherBlack;
          const meta = bank.pitcherMeta;
          const frameIdx = Math.max(0, Math.min(meta.frames - 1, Math.floor(params.pitcherFrame)));
          const dw = dh * (meta.w / meta.h);
          const breathe = !isFielding && frameIdx === 0 ? Math.sin(timeSec * 3.2) * 0.7 : 0;
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

  // 2. Fielders (LF, RF) & Catcher (C when chasing wild pitch/passed ball or nearby batted ball) — #99 NastYboY
  for (const f of params.fielders) {
    const pr = cam.project(f.pos);
    if (pr.visible && pr.depth > 0.2) {
      items.push({
        depth: pr.depth,
        draw: () => {
          const wideShadow = f.anim === 'dive' || f.anim === 'catch_wp' || f.anim === 'catch_ground';
          drawGroundShadow(ctx, cam, f.pos, wideShadow ? 0.42 : 0.32, 0.32);
          const img = params.pitchingTeam === 'yellow' ? bank.fielderYellow : bank.fielderBlack;
          const frame = pickAtlasFrame(bank.fielderAtlas, f.anim, f.animTime);
          const heightM = 1.68;
          const dh = Math.max(14, pr.scale * heightM);
          if (img && frame) {
            const fw = frame.frame.w;
            const fh = frame.frame.h;
            const baselineY = bank.fielderAtlas?.baseline_y ?? fh * (35.5 / 40);
            const dw = dh * (fw / fh);
            const dx = pr.sx - dw * 0.5;
            const dy = pr.sy - dh * (baselineY / fh);
            drawSpriteFrame(
              ctx,
              img,
              frame.frame.x,
              frame.frame.y,
              fw,
              fh,
              dx,
              dy,
              dw,
              dh,
              mirrorFor(bank.fielderAtlas, f.anim, f.flipX),
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

  // 3. Foreground Batter (#18 Skywalker for RHB when loaded; #99 NastYboY for LHB & fallback)
  {
    const bx = params.batter.handedness === 'right' ? -0.76 : 0.58;
    const off = params.batter.posOffset;
    const bPos: FieldV3 = off ? [bx + off[0], off[1], 0.14 + off[2]] : [bx, 0, 0.14];
    const pr = cam.project(bPos);
    if (pr.visible && pr.depth > 0.2) {
      items.push({
        depth: pr.depth,
        draw: () => {
          drawGroundShadow(ctx, cam, bPos, 0.32, 0.28);
          const img18 = params.battingTeam === 'yellow' ? bank.batter18Home : bank.batter18Away;
          const useSkywalker = params.batter.handedness === 'right' && Boolean(img18);
          const img = useSkywalker
            ? img18
            : params.battingTeam === 'yellow'
              ? bank.batterRealHome
              : bank.batterRealAway;
          const meta = useSkywalker ? bank.batter18Meta : bank.batterRealMeta;
          const frameIdx = Math.max(
            0,
            Math.min(meta.frames - 1, pickBatterRealFrame(meta, params.batter.anim, params.batter.animTime)),
          );
          const heightM = 1.72;
          const dh = Math.max(20, pr.scale * heightM);
          const dw = dh * (meta.w / meta.h);
          const flipX = params.batter.handedness !== meta.natural_handedness;
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

  // 5b. Procedural PixelFX Fielding Effects (catch pop burst + floor scoop/dive dust)
  if (params.fieldingFx && params.fieldingFx.length > 0 && bank.fxFieldingImg && bank.fxFieldingAtlas) {
    const baselineY = bank.fxFieldingAtlas.baseline_y ?? 48;
    for (const fx of params.fieldingFx) {
      const pr = cam.project(fx.pos);
      if (!pr.visible || pr.depth <= 0.2) continue;
      const frame = pickAtlasFrame(bank.fxFieldingAtlas, fx.kind, fx.elapsedSec);
      if (!frame) continue;
      const fw = frame.frame.w;
      const fh = frame.frame.h;
      const isDust = fx.kind === 'dive_dust';
      items.push({
        depth: isDust ? pr.depth + 0.04 : pr.depth - 0.12,
        draw: () => {
          const dh = Math.max(20, pr.scale * (isDust ? 1.18 : 0.82));
          const dw = dh * (fw / fh);
          const dx = pr.sx - dw * 0.5;
          const dy = isDust ? pr.sy - dh * (baselineY / fh) : pr.sy - dh * 0.5;
          drawSpriteFrame(
            ctx,
            bank.fxFieldingImg!,
            frame.frame.x,
            frame.frame.y,
            fw,
            fh,
            dx,
            dy,
            dw,
            dh,
            false,
            1,
          );
        },
      });
    }
  }

  // Painter's algorithm: farthest first
  items.sort((a, b) => b.depth - a.depth);
  for (const it of items) {
    it.draw();
  }
}
