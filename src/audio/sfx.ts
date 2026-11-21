class RetroSfxEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    durationSec: number,
    type: OscillatorType,
    gainPeak = 0.14,
    delaySec = 0,
  ): void {
    if (this.muted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;

    const t0 = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + durationSec);
    }

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durationSec + 0.02);
  }

  playPitchWhoosh(): void {
    this.tone(420, 140, 0.11, 'triangle', 0.11);
  }

  playBatCrack(quality: 'weak' | 'good' | 'perfect' | 'hr'): void {
    if (quality === 'weak') {
      this.tone(260, 110, 0.08, 'square', 0.12);
    } else if (quality === 'good') {
      this.tone(520, 180, 0.11, 'square', 0.16);
      this.tone(880, 440, 0.08, 'triangle', 0.1, 0.01);
    } else {
      this.tone(720, 220, 0.14, 'sawtooth', 0.2);
      this.tone(1180, 520, 0.12, 'square', 0.14, 0.015);
    }
  }

  playFloorBounce(): void {
    this.tone(190, 85, 0.06, 'triangle', 0.09);
  }

  playFenceHit(): void {
    this.tone(140, 62, 0.16, 'sawtooth', 0.16);
  }

  playCatchPop(): void {
    this.tone(320, 580, 0.06, 'square', 0.11);
  }

  playClockTick(urgent = false): void {
    this.tone(urgent ? 880 : 660, urgent ? 880 : 660, 0.045, 'square', urgent ? 0.08 : 0.05);
  }

  playUmpireTone(kind: 'strike' | 'ball' | 'out' | 'foul'): void {
    if (kind === 'strike') {
      this.tone(440, 440, 0.08, 'square', 0.1);
      this.tone(587, 587, 0.12, 'square', 0.11, 0.09);
    } else if (kind === 'foul') {
      // Distinct crisp dead-ball double-tap for foul balls (different from strike/ball/out)
      this.tone(523, 466, 0.07, 'triangle', 0.11);
      this.tone(415, 349, 0.11, 'triangle', 0.11, 0.085);
    } else if (kind === 'ball') {
      this.tone(330, 294, 0.12, 'triangle', 0.09);
    } else {
      this.tone(392, 261, 0.18, 'square', 0.13);
    }
  }

  playInningChange(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.tone(n, n, 0.12, 'square', 0.09, i * 0.09);
    });
  }

  playHomeRunFanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    const times = [0, 0.1, 0.2, 0.3, 0.45, 0.56];
    notes.forEach((n, i) => {
      this.tone(n, n, i === notes.length - 1 ? 0.32 : 0.11, 'square', 0.12, times[i]);
    });
  }
}

export const sfx = new RetroSfxEngine();
