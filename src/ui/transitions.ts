export type TransitionSpeed = 'normal' | 'compact';

export interface TransitionConfig {
  speed: TransitionSpeed;
  fxEnabled: boolean;
}

export interface TransitionLabels {
  playBall: string;
  changeSides: string;
  tieBreakerBadge: string;
  out: string;
  strikeOut: string;
  walkOffBadge: string;
  bigFlyBadge: string;
  coldGameBadge: string;
  finalBadge: string;
  atBatPrefix: string;
  formatInning: (half: 'top' | 'bottom', inning: number) => string;
}

const DEFAULT_TRANS_LABELS: TransitionLabels = {
  playBall: 'PLAY BALL',
  changeSides: 'CHANGE SIDES',
  tieBreakerBadge: 'TIE-BREAKER · 0 OUTS, BASES LOADED',
  out: 'OUT',
  strikeOut: 'STRIKE OUT!',
  walkOffBadge: 'WALK-OFF VICTORY',
  bigFlyBadge: 'BIG FLY',
  coldGameBadge: 'COLD GAME',
  finalBadge: 'FINAL',
  atBatPrefix: 'AT BAT',
  formatInning: (half, inning) => (half === 'top' ? `TOP ${inning}` : `BOT ${inning}`),
};

/**
 * Broadcast Transition Director + Hit-Stop / Slow-Motion / Camera-Shake FX controller.
 */
export class TransitionDirector {
  private readonly layer: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly art: HTMLElement;

  private activeTimer: number | null = null;
  private hitStopSec = 0;
  private slowMoSec = 0;
  private slowMoScale = 1;
  private shakeSec = 0;
  private shakeMag = 0;

  config: TransitionConfig;
  labels: TransitionLabels = DEFAULT_TRANS_LABELS;

  constructor(
    els: {
      layer: HTMLElement;
      badge: HTMLElement;
      title: HTMLElement;
      sub: HTMLElement;
      art: HTMLElement;
    },
    config: TransitionConfig,
  ) {
    this.layer = els.layer;
    this.badge = els.badge;
    this.title = els.title;
    this.sub = els.sub;
    this.art = els.art;
    this.config = config;
  }

  setLabels(labels: TransitionLabels): void {
    this.labels = labels;
  }

  private dur(ms: number): number {
    return this.config.speed === 'compact' ? Math.round(ms * 0.5) : ms;
  }

  triggerHitStop(sec = 0.042): void {
    if (!this.config.fxEnabled) return;
    this.hitStopSec = Math.max(this.hitStopSec, sec);
  }

  triggerSlowMo(sec = 0.65, scale = 0.42): void {
    if (!this.config.fxEnabled) return;
    this.slowMoSec = Math.max(this.slowMoSec, sec);
    this.slowMoScale = Math.min(this.slowMoScale, scale);
  }

  triggerShake(sec = 0.22, magPx = 5): void {
    if (!this.config.fxEnabled) return;
    this.shakeSec = Math.max(this.shakeSec, sec);
    this.shakeMag = Math.max(this.shakeMag, magPx);
  }

  /** Step hit-stop / slow-mo / camera shake and return effective scaled dt for match physics. */
  stepFx(rawDt: number): { dt: number; shakeX: number; shakeY: number } {
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeSec > 0) {
      this.shakeSec = Math.max(0, this.shakeSec - rawDt);
      const decay = Math.min(1, this.shakeSec / 0.18);
      shakeX = (Math.random() * 2 - 1) * this.shakeMag * decay;
      shakeY = (Math.random() * 2 - 1) * this.shakeMag * decay;
      if (this.shakeSec <= 0) this.shakeMag = 0;
    }

    if (this.hitStopSec > 0) {
      this.hitStopSec = Math.max(0, this.hitStopSec - rawDt);
      return { dt: 0, shakeX, shakeY };
    }

    if (this.slowMoSec > 0) {
      this.slowMoSec = Math.max(0, this.slowMoSec - rawDt);
      const scale = this.slowMoSec > 0 ? this.slowMoScale : 1;
      if (this.slowMoSec <= 0) this.slowMoScale = 1;
      return { dt: rawDt * scale, shakeX, shakeY };
    }

    return { dt: rawDt, shakeX, shakeY };
  }

  playMatchStart(awayName: string, homeName: string): void {
    this.showBanner({
      variant: 'matchup',
      badge: this.labels.playBall,
      title: `${awayName} VS ${homeName}`,
      sub: '',
      ms: this.dur(1350),
    });
  }

  playInningChange(
    inning: number,
    half: 'top' | 'bottom',
    awayRuns: number,
    homeRuns: number,
    isTieBreaker = false,
  ): void {
    const label = this.labels.formatInning(half, inning);
    this.showBanner({
      variant: 'wipe',
      badge: isTieBreaker ? this.labels.tieBreakerBadge : this.labels.changeSides,
      title: label,
      sub: `${awayRuns} — ${homeRuns}`,
      ms: this.dur(isTieBreaker ? 1500 : 1200),
    });
  }

  playStrikeout(batterName: string): void {
    this.triggerShake(0.18, 4.5);
    this.showBanner({
      variant: 'strikeout',
      badge: this.labels.out,
      title: this.labels.strikeOut,
      sub: batterName,
      ms: this.dur(1350),
      umpirePunchOut: true,
    });
  }

  playBigHit(title: string, sub: string, isWalkOff: boolean): void {
    this.triggerHitStop(0.045);
    this.triggerShake(isWalkOff ? 0.32 : 0.24, isWalkOff ? 7 : 5);
    this.triggerSlowMo(isWalkOff ? 0.85 : 0.6, 0.44);
    this.showBanner({
      variant: isWalkOff ? 'walkoff' : 'homerun',
      badge: isWalkOff ? this.labels.walkOffBadge : this.labels.bigFlyBadge,
      title,
      sub,
      ms: this.dur(isWalkOff ? 1850 : 1450),
    });
  }

  playWildPlay(badge: string, title: string, sub: string): void {
    this.triggerHitStop(0.032);
    this.triggerShake(0.24, 5.5);
    this.showBanner({
      variant: 'wildplay',
      badge,
      title,
      sub,
      ms: this.dur(1400),
      wildPlayArt: true,
    });
  }

  playWalk(badge: string, title: string, sub: string): void {
    this.showBanner({
      variant: 'walk',
      badge,
      title,
      sub,
      ms: this.dur(1250),
    });
  }

  playOverturnedContinue(badge: string, title: string, sub: string): void {
    this.showBanner({
      variant: 'overturned',
      badge,
      title,
      sub,
      ms: this.dur(1100),
    });
  }

  playGameSet(title: string, scoreLine: string, isColdGame: boolean): void {
    this.showBanner({
      variant: 'gameset',
      badge: isColdGame ? this.labels.coldGameBadge : this.labels.finalBadge,
      title,
      sub: scoreLine,
      ms: this.dur(1650),
    });
  }

  isActive(): boolean {
    return !this.layer.hidden;
  }

  clear(): void {
    if (this.activeTimer !== null) {
      window.clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    this.hitStopSec = 0;
    this.slowMoSec = 0;
    this.slowMoScale = 1;
    this.shakeSec = 0;
    this.layer.hidden = true;
  }

  private showBanner(opts: {
    variant: 'matchup' | 'wipe' | 'strikeout' | 'homerun' | 'walkoff' | 'gameset' | 'wildplay' | 'walk' | 'overturned';
    badge: string;
    title: string;
    sub: string;
    ms: number;
    umpirePunchOut?: boolean;
    wildPlayArt?: boolean;
  }): void {
    if (this.activeTimer !== null) {
      window.clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    this.layer.dataset.variant = opts.variant;
    this.badge.textContent = opts.badge;
    this.title.textContent = opts.title;
    this.sub.textContent = opts.sub;
    this.sub.hidden = !opts.sub;
    this.art.replaceChildren();
    if (opts.umpirePunchOut) {
      this.art.appendChild(createUmpirePunchOutSvg());
      this.art.hidden = false;
    } else if (opts.wildPlayArt) {
      this.art.appendChild(createWildPlaySvg());
      this.art.hidden = false;
    } else {
      this.art.hidden = true;
    }

    this.layer.hidden = false;
    this.layer.classList.remove('out');

    this.activeTimer = window.setTimeout(() => {
      this.layer.classList.add('out');
      this.activeTimer = window.setTimeout(() => {
        this.layer.hidden = true;
        this.layer.classList.remove('out');
        this.activeTimer = null;
      }, 220);
    }, Math.max(450, opts.ms));
  }
}

/** Original 16-bit pixel umpire punch-out silhouette SVG (zero external assets). */
function createUmpirePunchOutSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '44');
  svg.setAttribute('aria-hidden', 'true');
  const rects: Array<[number, number, number, number, string]> = [
    [9, 2, 6, 2, '#1e293b'],  // cap
    [8, 4, 8, 1, '#f4c41c'],  // brim
    [9, 5, 6, 4, '#fed7aa'],  // face
    [7, 9, 10, 7, '#0f172a'], // chest protector
    [17, 6, 4, 3, '#fed7aa'], // raised punch-out fist!
    [15, 8, 3, 3, '#0f172a'], // raised right arm
    [4, 10, 3, 4, '#0f172a'], // left arm
    [8, 16, 3, 6, '#334155'], // left leg
    [13, 16, 3, 6, '#334155'], // right leg
  ];
  for (const [x, y, w, h, fill] of rects) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    r.setAttribute('fill', fill);
    svg.appendChild(r);
  }
  return svg;
}

/** 16-bit pixel dropped bottle-cap graphic for wild pitch / passed ball / uncaught 3rd strike. */
function createWildPlaySvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '44');
  svg.setAttribute('aria-hidden', 'true');
  const rects: Array<[number, number, number, number, string]> = [
    [3, 12, 3, 1, '#fb923c'],  // speed lines
    [2, 15, 5, 1, '#f97316'],
    [9, 9, 8, 5, '#f43f5e'],   // escaping cap body
    [8, 14, 10, 2, '#f4c41c'], // cap rim
    [17, 7, 4, 2, '#38bdf8'],  // deflection spark
  ];
  for (const [x, y, w, h, fill] of rects) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    r.setAttribute('fill', fill);
    svg.appendChild(r);
  }
  return svg;
}
