import { PLATE_WIDTH, STRIKE_ZONE_HI, STRIKE_ZONE_LO } from '../rules/field';

export interface SwingFeedbackPayload {
  kind: 'swing' | 'take';
  pitchCode: string;
  speedKmh: number;
  breakCm?: number;
  plateX: number;
  plateY: number;
  callLabel: string;
  callColor: string;
  /** Optional outcome detail merged cleanly into the card (e.g. '14.8m', '外野接殺！', '外野攔截') */
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
}

export interface SwingFeedbackLabels {
  timingTitle: string;
  pciTitle: string;
  pitchLocTitle: string;
  contactLabel: string;
  evLabel: string;
  laLabel: string;
  missLabel: string;
  goodLabel: string;
  formatPitchCode?: (code: string) => string;
  formatLabel?: (raw: string) => string;
}

const DEFAULT_LABELS: SwingFeedbackLabels = {
  timingTitle: 'SWING TIMING',
  pciTitle: 'PCI PLACEMENT',
  pitchLocTitle: 'PITCH LOCATION',
  contactLabel: 'CONTACT',
  evLabel: 'EV',
  laLabel: 'LA',
  missLabel: 'MISS',
  goodLabel: 'GOOD',
};

/**
 * MLB The Show inspired compact Swing Timing + PCI Placement feedback card.
 * - Swung pitches: dual-panel (left timing fan + right 3x3 zone & PCI + bottom EV/LA bar).
 * - Unswung pitches: shown AFTER ABS challenge window closes (single-panel true pitch location).
 */
export class SwingFeedbackWidget {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly footer: HTMLElement;
  private hideTimer: number | null = null;
  labels: SwingFeedbackLabels = DEFAULT_LABELS;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, footer: HTMLElement) {
    this.root = root;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.footer = footer;
  }

  setLabels(labels: SwingFeedbackLabels): void {
    this.labels = labels;
  }

  show(payload: SwingFeedbackPayload, durationMs = 2500): void {
    this.clearTimer();
    this.root.dataset.kind = payload.kind;
    this.root.hidden = false;
    this.root.classList.remove('fading');

    this.render(payload);

    const fmtPitch = (c: string) => (this.labels.formatPitchCode ? this.labels.formatPitchCode(c) : c);
    const fmtLbl = (s: string) => (this.labels.formatLabel ? this.labels.formatLabel(s) : s);

    if (payload.kind === 'swing') {
      if (payload.contact) {
        const grade = fmtLbl(payload.contactGrade || payload.timingLabel || 'OK');
        const ev = typeof payload.exitSpeedKmh === 'number' ? `${Math.round(payload.exitSpeedKmh)} km/h` : '--';
        const la = typeof payload.launchAngleDeg === 'number' ? `${Math.round(payload.launchAngleDeg)}°` : '--';
        this.footer.textContent = `${this.labels.contactLabel} ${grade} · ${this.labels.evLabel} ${ev} · ${this.labels.laLabel} ${la}`;
      } else {
        const missText = payload.timingLabel ? fmtLbl(payload.timingLabel) : this.labels.missLabel;
        this.footer.textContent = `${missText} · ${fmtPitch(payload.pitchCode)} ${Math.round(payload.speedKmh)} km/h`;
      }
    } else {
      this.footer.textContent = `${fmtLbl(payload.callLabel)} · ${fmtPitch(payload.pitchCode)} ${Math.round(payload.speedKmh)} km/h`;
    }

    this.hideTimer = window.setTimeout(() => {
      this.root.classList.add('fading');
      this.hideTimer = window.setTimeout(() => this.hide(), 280);
    }, Math.max(800, durationMs));
  }

  hide(): void {
    this.clearTimer();
    this.root.hidden = true;
    this.root.classList.remove('fading');
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private render(p: SwingFeedbackPayload): void {
    const isDual = p.kind === 'swing';
    const cssW = isDual ? 248 : 134;
    const cssH = 122;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    // Panel background
    ctx.fillStyle = '#0c1324';
    ctx.fillRect(0, 0, cssW, cssH);

    if (isDual) {
      this.drawTimingPanel(ctx, 0, 0, 122, cssH, p);
      ctx.fillStyle = '#243454';
      ctx.fillRect(122, 0, 2, cssH);
      this.drawZonePanel(ctx, 124, 0, 124, cssH, p, true);
    } else {
      this.drawZonePanel(ctx, 0, 0, cssW, cssH, p, false);
    }

    ctx.restore();
  }

  private drawTimingPanel(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    w: number,
    h: number,
    p: SwingFeedbackPayload,
  ): void {
    // Header bar
    ctx.fillStyle = '#152039';
    ctx.fillRect(ox, oy, w, 18);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '700 9px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.labels.timingTitle, ox + w / 2, oy + 9.5);

    // Subtle dirt diamond background
    ctx.fillStyle = '#2d1f18';
    ctx.fillRect(ox, oy + 18, w, h - 18);

    // Chalk batter-box lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ox + 22, oy + 18);
    ctx.lineTo(ox + 22, oy + h);
    ctx.moveTo(ox + w - 22, oy + 18);
    ctx.lineTo(ox + w - 22, oy + h);
    ctx.stroke();

    // Home plate pentagon
    const px = ox + w / 2;
    const py = oy + 76;
    ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
    ctx.beginPath();
    ctx.moveTo(px - 14, py - 10);
    ctx.lineTo(px + 14, py - 10);
    ctx.lineTo(px + 14, py + 1);
    ctx.lineTo(px, py + 12);
    ctx.lineTo(px - 14, py + 1);
    ctx.closePath();
    ctx.fill();

    // Early -> Good -> Late radial timing fan
    const pivotX = ox + w - 18;
    const pivotY = oy + 66;
    const slices: Array<{ a0: number; a1: number; color: string }> = [
      { a0: Math.PI * 0.72, a1: Math.PI * 0.84, color: 'rgba(239, 68, 68, 0.55)' },
      { a0: Math.PI * 0.84, a1: Math.PI * 0.94, color: 'rgba(250, 204, 21, 0.62)' },
      { a0: Math.PI * 0.94, a1: Math.PI * 1.06, color: 'rgba(34, 197, 94, 0.72)' },
      { a0: Math.PI * 1.06, a1: Math.PI * 1.16, color: 'rgba(250, 204, 21, 0.62)' },
      { a0: Math.PI * 1.16, a1: Math.PI * 1.28, color: 'rgba(239, 68, 68, 0.55)' },
    ];
    for (const s of slices) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      ctx.arc(pivotX, pivotY, 64, s.a0, s.a1);
      ctx.closePath();
      ctx.fill();
    }

    // Bat angle from dtTiming (-0.15s early -> +0.15s late)
    const dt = Math.max(-0.15, Math.min(0.15, p.dtTiming ?? 0));
    const norm = dt / 0.15; // -1 early, 0 perfect, +1 late
    const batAngle = Math.PI - norm * (Math.PI * 0.25);
    const tipX = pivotX + Math.cos(batAngle) * 62;
    const tipY = pivotY + Math.sin(batAngle) * 62;

    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(pivotX + Math.cos(batAngle) * 32, pivotY + Math.sin(batAngle) * 32);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Cap contact dot along bat
    const capX = pivotX + Math.cos(batAngle) * 48;
    const capY = pivotY + Math.sin(batAngle) * 48;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(capX, capY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Timing badge pill
    const badgeW = 74;
    const badgeH = 16;
    const bx = ox + (w - badgeW) / 2;
    const by = oy + h - 22;
    ctx.fillStyle = 'rgba(7, 11, 20, 0.9)';
    ctx.fillRect(bx, by, badgeW, badgeH);
    ctx.strokeStyle = p.timingColor || '#4ade80';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx, by, badgeW, badgeH);
    ctx.fillStyle = p.timingColor || '#4ade80';
    ctx.font = '800 9.5px "Chakra Petch", sans-serif';
    const rawTiming = p.timingLabel || this.labels.goodLabel;
    const timingTxt = this.labels.formatLabel ? this.labels.formatLabel(rawTiming) : rawTiming.toUpperCase();
    ctx.fillText(timingTxt, ox + w / 2, by + 8.5);
  }

  private drawZonePanel(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    w: number,
    h: number,
    p: SwingFeedbackPayload,
    showPci: boolean,
  ): void {
    // Header bar
    ctx.fillStyle = '#152039';
    ctx.fillRect(ox, oy, w, 18);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '700 9px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(showPci ? this.labels.pciTitle : this.labels.pitchLocTitle, ox + w / 2, oy + 9.5);

    // Pitch code + speed pill
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 10px "Chakra Petch", sans-serif';
    const pitchLbl = this.labels.formatPitchCode ? this.labels.formatPitchCode(p.pitchCode) : p.pitchCode;
    ctx.fillText(`${pitchLbl} ${Math.round(p.speedKmh)} km/h`, ox + w / 2, oy + 29);

    // 3x3 strike zone box
    const zw = 54;
    const zh = 62;
    const zx = ox + (w - zw) / 2;
    const zy = oy + 40;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(zx, zy, zw, zh);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(zx, zy, zw, zh);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1;
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

    const halfW = PLATE_WIDTH / 2;
    const mapX = (fx: number) => zx + ((fx + halfW) / PLATE_WIDTH) * zw;
    const mapY = (fy: number) => zy + (1 - (fy - STRIKE_ZONE_LO) / (STRIKE_ZONE_HI - STRIKE_ZONE_LO)) * zh;
    const clampX = (sx: number) => Math.max(ox + 10, Math.min(ox + w - 10, sx));
    const clampY = (sy: number) => Math.max(oy + 36, Math.min(oy + h - 8, sy));

    // Batter PCI bracket ( • ) when swung
    if (showPci && typeof p.batX === 'number' && typeof p.batY === 'number') {
      const bx = clampX(mapX(p.batX));
      const by = clampY(mapY(p.batY));
      const rx = p.powerSwing ? 13 : 19;
      const ry = p.powerSwing ? 10 : 15;
      const col = p.powerSwing ? '#f97316' : '#f4c41c';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(bx, by, rx, ry, 0, Math.PI * 0.68, Math.PI * 1.32);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(bx, by, rx, ry, 0, -Math.PI * 0.32, Math.PI * 0.32);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(bx, by, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Actual cap location
    const cx = clampX(mapX(p.plateX));
    const cy = clampY(mapY(p.plateY));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.callColor || '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
}
