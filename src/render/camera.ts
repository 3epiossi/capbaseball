import type { FieldV3 } from '../physics/batted';

export interface ProjectedPoint {
  sx: number;
  sy: number;
  depth: number;
  scale: number;
  visible: boolean;
}

export interface CameraPose {
  pos: [number, number, number];
  look: [number, number, number];
  fovDeg: number;
}

const BASE_POS: [number, number, number] = [0.0, 1.0, 2.38];
const BASE_LOOK: [number, number, number] = [0.0, 0.86, -9.22];
const BASE_FOV = 36;

const PORTRAIT_POS: [number, number, number] = [0.0, 1.0, 2.48];
const PORTRAIT_LOOK: [number, number, number] = [0.0, 0.86, -9.22];
const PORTRAIT_FOV = 48;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sub3(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm3(a: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export class GameCamera {
  width = 480;
  height = 270;

  private current: CameraPose = {
    pos: [...BASE_POS],
    look: [...BASE_LOOK],
    fovDeg: BASE_FOV,
  };

  private followTarget: FieldV3 | null = null;
  private wildPitchTarget: FieldV3 | null = null;
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeIntensity = 0;
  private shakeOffset: [number, number, number] = [0, 0, 0];

  // Cached basis vectors
  private forward: [number, number, number] = [0, 0, -1];
  private right: [number, number, number] = [1, 0, 0];
  private up: [number, number, number] = [0, 1, 0];
  private focalPx = 400;
  private centerYRatio = 0.5;
  private targetCenterYRatio = 0.5;

  constructor() {
    this.rebuildBasis();
  }

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.rebuildBasis();
  }

  /** Shift vertical projection center (0.5 = screen middle) to frame strike zone inside unobstructed safe area. */
  setTargetCenterYRatio(ratio: number, immediate = false): void {
    const clamped = Math.max(0.32, Math.min(0.56, ratio));
    this.targetCenterYRatio = clamped;
    if (immediate) {
      this.centerYRatio = clamped;
    }
  }

  getRestCenterYRatio(): number {
    return this.targetCenterYRatio;
  }

  /** True once followTarget and wildPitchTarget are cleared and the camera has settled back near home plate. */
  isNearRest(): boolean {
    if (this.followTarget || this.wildPitchTarget) return false;
    const targetPos = this.isPortrait ? PORTRAIT_POS : BASE_POS;
    const targetLook = this.isPortrait ? PORTRAIT_LOOK : BASE_LOOK;
    const posErr = Math.hypot(
      this.current.pos[0] - targetPos[0],
      this.current.pos[1] - targetPos[1],
      this.current.pos[2] - targetPos[2],
    );
    const lookErr = Math.hypot(
      this.current.look[0] - targetLook[0],
      this.current.look[1] - targetLook[1],
      this.current.look[2] - targetLook[2],
    );
    return posErr < 0.14 && lookErr < 0.35;
  }

  get isPortrait(): boolean {
    return this.height > this.width;
  }

  setFollowTarget(target: FieldV3 | null): void {
    this.followTarget = target;
  }

  /** Smoothly pull camera backward & higher behind home plate to reveal wild pitch / passed ball + Catcher dive! */
  setWildPitchTarget(target: FieldV3 | null): void {
    this.wildPitchTarget = target;
  }

  resetImmediate(): void {
    this.followTarget = null;
    this.wildPitchTarget = null;
    this.current = {
      pos: [...(this.isPortrait ? PORTRAIT_POS : BASE_POS)],
      look: [...(this.isPortrait ? PORTRAIT_LOOK : BASE_LOOK)],
      fovDeg: this.isPortrait ? PORTRAIT_FOV : BASE_FOV,
    };
    this.centerYRatio = this.targetCenterYRatio;
    this.shakeOffset = [0, 0, 0];
    this.rebuildBasis();
  }

  addShake(intensity: number, durationSec: number): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = Math.max(this.shakeDuration, durationSec);
    this.shakeTime = this.shakeDuration;
  }

  update(dt: number): void {
    const baseFov = this.isPortrait ? PORTRAIT_FOV : BASE_FOV;
    let targetPos: [number, number, number] = [...(this.isPortrait ? PORTRAIT_POS : BASE_POS)];
    let targetLook: [number, number, number] = [...(this.isPortrait ? PORTRAIT_LOOK : BASE_LOOK)];
    let targetFov = baseFov;

    if (this.followTarget) {
      const [capX, capY, capZ] = this.followTarget;
      // Ground-projection broadcast/chase follow camera: keeps cap, ground shadow, 8m infield, outfielders & 13m fence in view
      const r = Math.hypot(capX, capZ);
      targetPos = [
        capX * 0.48,
        3.4 + Math.min(3.4, r * 0.20 + capY * 0.22),
        Math.min(4.0, capZ + 6.4),
      ];
      targetLook = [
        capX * 0.92,
        Math.min(1.1, capY * 0.28),
        Math.min(-3.5, capZ - 1.8),
      ];
      targetFov = this.isPortrait ? 54 : 44;
    } else if (this.wildPitchTarget) {
      const [wx, wy, _wz] = this.wildPitchTarget;
      // Pull back & elevate behind the official pass line (z = 2.334m) so Home Plate, Catcher dive,
      // pass line, and cap rolling past z = 2.334m (to z ≈ 3.0..3.8m) are all cleanly framed!
      targetPos = [
        Math.max(-1.35, Math.min(1.35, wx * 0.35)),
        this.isPortrait ? 2.40 : 2.15,
        this.isPortrait ? 6.30 : 5.75,
      ];
      targetLook = [
        Math.max(-1.6, Math.min(1.6, wx * 0.45)),
        Math.max(0.32, Math.min(0.85, wy * 0.5)),
        1.65,
      ];
      targetFov = this.isPortrait ? 54 : 44;
    }

    const activeTracking = Boolean(this.followTarget || this.wildPitchTarget);
    const smooth = 1 - Math.exp(-dt * (this.wildPitchTarget ? 6.2 : activeTracking ? 5.5 : 4.2));
    for (let i = 0; i < 3; i++) {
      this.current.pos[i] = lerp(this.current.pos[i], targetPos[i], smooth);
      this.current.look[i] = lerp(this.current.look[i], targetLook[i], smooth);
    }
    this.current.fovDeg = lerp(this.current.fovDeg, targetFov, smooth);
    const ratioSmooth = 1 - Math.exp(-dt * 10);
    this.centerYRatio = lerp(this.centerYRatio, this.targetCenterYRatio, ratioSmooth);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const ratio = this.shakeDuration > 0 ? this.shakeTime / this.shakeDuration : 0;
      const amp = this.shakeIntensity * ratio;
      this.shakeOffset = [
        (Math.random() * 2 - 1) * amp,
        (Math.random() * 2 - 1) * amp * 0.7,
        0,
      ];
      if (this.shakeTime <= 0) {
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeOffset = [0, 0, 0];
      }
    } else {
      this.shakeOffset = [0, 0, 0];
    }

    this.rebuildBasis();
  }

  private rebuildBasis(): void {
    const pos: [number, number, number] = [
      this.current.pos[0] + this.shakeOffset[0],
      this.current.pos[1] + this.shakeOffset[1],
      this.current.pos[2] + this.shakeOffset[2],
    ];
    this.forward = norm3(sub3(this.current.look, pos));
    this.right = norm3(cross3(this.forward, [0, 1, 0]));
    this.up = cross3(this.right, this.forward);

    const aspect = this.width / Math.max(1, this.height);
    const fovRad = (this.current.fovDeg * Math.PI) / 180;
    let tanHalfV = Math.tan(fovRad * 0.5);

    // Cross-device consistent reference-aspect framing:
    // Ensures pitcher, strike zone, and batter stay consistently framed across 16:9 desktop,
    // 4:3 iPad, ultrawide monitors, and 9:19.5 / 9:16 mobile browsers (Chrome, Safari, Firefox).
    if (aspect >= 0.85) {
      const refHalfTanH = Math.tan((BASE_FOV * Math.PI) / 360) * (16 / 9);
      const minTanHalfV = refHalfTanH / Math.max(1.05, Math.min(aspect, 16 / 9));
      tanHalfV = Math.max(tanHalfV, minTanHalfV);
    } else {
      const portraitTan = 0.295 / Math.max(0.44, aspect);
      tanHalfV = Math.max(tanHalfV, Math.min(Math.tan((62 * Math.PI) / 360), portraitTan));
    }
    this.focalPx = (this.height * 0.5) / tanHalfV;
  }

  /** Quantized camera pose fingerprint for static stage offscreen caching. */
  getPoseKey(): string {
    const e = this.getEyePos();
    const l = this.current.look;
    return `${this.width}x${this.height}:${e[0].toFixed(3)},${e[1].toFixed(3)},${e[2].toFixed(3)}:${l[0].toFixed(3)},${l[1].toFixed(3)},${l[2].toFixed(3)}:${this.current.fovDeg.toFixed(2)}:${this.centerYRatio.toFixed(4)}`;
  }

  getEyePos(): [number, number, number] {
    return [
      this.current.pos[0] + this.shakeOffset[0],
      this.current.pos[1] + this.shakeOffset[1],
      this.current.pos[2] + this.shakeOffset[2],
    ];
  }

  project(fieldPos: FieldV3): ProjectedPoint {
    const eye = this.getEyePos();
    const rel: [number, number, number] = [
      fieldPos[0] - eye[0],
      fieldPos[1] - eye[1],
      fieldPos[2] - eye[2],
    ];

    const depth = dot3(rel, this.forward);
    if (depth <= 0.15) {
      return { sx: -9999, sy: -9999, depth, scale: 0, visible: false };
    }

    const cx = dot3(rel, this.right);
    const cy = dot3(rel, this.up);

    const scale = this.focalPx / depth;
    const cyPx = this.height * this.centerYRatio;
    const sx = this.width * 0.5 + cx * scale;
    const sy = cyPx - cy * scale;

    return {
      sx,
      sy,
      depth,
      scale,
      visible: sx >= -120 && sx <= this.width + 120 && sy >= -120 && sy <= this.height + 120,
    };
  }

  /**
   * Intersect a screen pixel ray (sx, sy) with the vertical plane z = zPlane.
   */
  screenToPlaneZ(sx: number, sy: number, zPlane: number): [number, number, number] | null {
    const eye = this.getEyePos();
    const cyPx = this.height * this.centerYRatio;
    const nx = (sx - this.width * 0.5) / this.focalPx;
    const ny = -(sy - cyPx) / this.focalPx;

    const dir: [number, number, number] = [
      this.forward[0] + nx * this.right[0] + ny * this.up[0],
      this.forward[1] + nx * this.right[1] + ny * this.up[1],
      this.forward[2] + nx * this.right[2] + ny * this.up[2],
    ];

    if (Math.abs(dir[2]) < 1e-6) return null;
    const t = (zPlane - eye[2]) / dir[2];
    if (t <= 0) return null;

    return [eye[0] + dir[0] * t, eye[1] + dir[1] * t, zPlane];
  }
}
