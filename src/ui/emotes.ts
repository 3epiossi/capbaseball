export type EmoteId =
  | 'nice'
  | 'gg'
  | 'fire'
  | 'clap'
  | 'hr'
  | 'wow'
  | 'sweat'
  | 'k';

export interface QuickChatDef {
  id: EmoteId;
  fallbackLabel: string;
  accent: string;
}

export const EMOTE_CATALOG: readonly QuickChatDef[] = [
  { id: 'nice', fallbackLabel: 'Not bad at all!', accent: '#4ade80' },
  { id: 'gg', fallbackLabel: 'Not at all!', accent: '#a78bfa' },
  { id: 'fire', fallbackLabel: 'Alright! Bring it!', accent: '#f97316' },
  { id: 'clap', fallbackLabel: 'Tables turned!', accent: '#facc15' },
  { id: 'hr', fallbackLabel: 'Barely grazed it~', accent: '#ffd23f' },
  { id: 'k', fallbackLabel: 'Three times! Three!', accent: '#f43f5e' },
  { id: 'wow', fallbackLabel: 'Hmm?', accent: '#38bdf8' },
  { id: 'sweat', fallbackLabel: 'This is bad!', accent: '#60a5fa' },
];

export const ALL_EMOTE_IDS: readonly EmoteId[] = EMOTE_CATALOG.map((e) => e.id);

const CHAT_MAP = new Map<string, QuickChatDef>(EMOTE_CATALOG.map((e) => [e.id, e]));

export interface ChatHubUiLabels {
  title: string;
  broadcastTag: string;
  systemTag: string;
  cooldownHint: string;
  offlineNote: string;
  emptyLog: string;
}

interface FeedEntry {
  kind: 'chat' | 'broadcast' | 'system';
  tag: string;
  text: string;
  accent: string;
}

const DEFAULT_UI_LABELS: ChatHubUiLabels = {
  title: 'CHAT & FEED',
  broadcastTag: 'CALL',
  systemTag: 'SYS',
  cooldownHint: 'COOLDOWN',
  offlineNote: 'Quick-chat available in Online Matches',
  emptyLog: 'No messages yet',
};

const SEND_COOLDOWN_MS = 3000;
const MAX_HISTORY = 5;

/**
 * Applies a gentle font shrink to long player-name labels (CJK / full-width glyphs count as 2 units)
 * and exposes the full name via `title`. Any residual overflow is ellipsized by CSS, so long names
 * never change the surrounding layout or clip the accompanying message / score.
 */
export function fitNameLabel(el: HTMLElement, name: string, shortUnits = 8, longUnits = 12): void {
  let units = 0;
  for (const ch of name) {
    units += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  }
  const scale = units <= shortUnits ? 1 : units <= longUnits ? 0.86 : 0.76;
  el.style.setProperty('--name-scale', String(scale));
  el.title = units > shortUnits ? name : '';
}

/**
 * Unified Speech-Bubble Chat & Broadcast Hub:
 * - Hosts 8 fixed text-only quick-chat presets
 * - Hosts all non-pitch game broadcasts (Next Batter, IBB, Pitch Clock) & online system notices
 * - Fully localized into zh-TW / ja / en with zero sticker/emoji graphics
 */
export class EmoteController {
  private readonly dock: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly tray: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly onSend: (id: EmoteId) => void;
  private readonly onPlaySfx: () => void;

  private lastSentAt = 0;
  private cooldownInterval: number | null = null;
  private bubbleTimer: number | null = null;
  private labelOverrides: Partial<Record<EmoteId, string>> = {};
  private uiLabels: ChatHubUiLabels = DEFAULT_UI_LABELS;
  private onlineSendEnabled = false;
  private history: FeedEntry[] = [];

  mutedOpponent = false;
  sfxEnabled = true;

  constructor(
    els: {
      dock: HTMLElement;
      toggleBtn: HTMLButtonElement;
      tray: HTMLElement;
      bubble: HTMLElement;
    },
    onSend: (id: EmoteId) => void,
    onPlaySfx: () => void,
  ) {
    this.dock = els.dock;
    this.toggleBtn = els.toggleBtn;
    this.tray = els.tray;
    this.bubble = els.bubble;
    this.onSend = onSend;
    this.onPlaySfx = onPlaySfx;

    this.buildTray();

    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = this.tray.hidden;
      this.tray.hidden = !willOpen;
      this.toggleBtn.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        this.hideBubbleImmediate();
        this.buildTray();
      }
    });

    // Close quick-chat popover cleanly when tapping anywhere outside the hub
    document.addEventListener('pointerdown', (e) => {
      if (this.tray.hidden) return;
      const target = e.target as Node | null;
      if (target && !this.dock.contains(target)) {
        this.tray.hidden = true;
        this.toggleBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  setLabels(labels: Partial<Record<EmoteId, string>>, ui?: Partial<ChatHubUiLabels>): void {
    this.labelOverrides = labels;
    if (ui) {
      this.uiLabels = { ...this.uiLabels, ...ui };
    }
    this.toggleBtn.setAttribute('aria-label', this.uiLabels.title);
    this.toggleBtn.title = this.uiLabels.title;
    this.buildTray();
  }

  setOnlineSendEnabled(enabled: boolean): void {
    this.onlineSendEnabled = enabled;
    if (!this.tray.hidden) {
      this.buildTray();
    }
  }

  setVisible(visible: boolean): void {
    this.dock.hidden = !visible;
    if (!visible) {
      this.tray.hidden = true;
      this.toggleBtn.setAttribute('aria-expanded', 'false');
      this.hideBubbleImmediate();
    }
  }

  clearHistory(): void {
    this.history = [];
    this.hideBubbleImmediate();
    if (!this.tray.hidden) {
      this.buildTray();
    }
  }

  getPhraseById(id: EmoteId): string {
    const def = CHAT_MAP.get(id);
    if (!def) return id;
    return this.getPhrase(def);
  }

  private getPhrase(def: QuickChatDef): string {
    return this.labelOverrides[def.id] || def.fallbackLabel;
  }

  private getCooldownRemainingSec(): number {
    const remMs = SEND_COOLDOWN_MS - (Date.now() - this.lastSentAt);
    return remMs > 0 ? Math.ceil(remMs / 1000) : 0;
  }

  private buildTray(): void {
    this.tray.replaceChildren();

    // Header row with title + live cooldown indicator
    const head = document.createElement('div');
    head.className = 'chat-tray-head';
    const titleEl = document.createElement('span');
    titleEl.className = 'chat-tray-title';
    titleEl.textContent = this.uiLabels.title;
    head.appendChild(titleEl);

    const remSec = this.getCooldownRemainingSec();
    if (this.onlineSendEnabled && remSec > 0) {
      const cdEl = document.createElement('span');
      cdEl.className = 'chat-tray-cd';
      cdEl.textContent = `${this.uiLabels.cooldownHint} ${remSec}s`;
      head.appendChild(cdEl);
    }
    this.tray.appendChild(head);

    // Recent messages log (last 4 entries)
    const logBox = document.createElement('div');
    logBox.className = 'chat-log';
    if (this.history.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'chat-log-empty';
      emptyEl.textContent = this.uiLabels.emptyLog;
      logBox.appendChild(emptyEl);
    } else {
      for (const item of this.history.slice(-4)) {
        const row = document.createElement('div');
        row.className = 'chat-log-row';
        row.dataset.kind = item.kind;
        const tagEl = document.createElement('span');
        tagEl.className = 'chat-log-tag';
        tagEl.style.color = item.accent;
        tagEl.textContent = item.tag;
        fitNameLabel(tagEl, item.tag);
        const msgEl = document.createElement('span');
        msgEl.className = 'chat-log-text';
        msgEl.textContent = item.text;
        row.append(tagEl, msgEl);
        logBox.appendChild(row);
      }
    }
    this.tray.appendChild(logBox);

    // Quick-chat text options (8 fixed presets in online matches) or concise offline note
    if (this.onlineSendEnabled) {
      const grid = document.createElement('div');
      grid.className = 'chat-options-grid';
      const onCooldown = remSec > 0;
      for (const def of EMOTE_CATALOG) {
        const phrase = this.getPhrase(def);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-opt-btn';
        btn.dataset.emote = def.id;
        btn.disabled = onCooldown;
        btn.textContent = phrase;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.trySend(def.id);
        });
        grid.appendChild(btn);
      }
      this.tray.appendChild(grid);
    } else {
      const note = document.createElement('div');
      note.className = 'chat-offline-note';
      note.textContent = this.uiLabels.offlineNote;
      this.tray.appendChild(note);
    }
  }

  private trySend(id: EmoteId): void {
    if (!this.onlineSendEnabled) return;
    const now = Date.now();
    if (now - this.lastSentAt < SEND_COOLDOWN_MS) return;
    this.lastSentAt = now;
    this.tray.hidden = true;
    this.toggleBtn.setAttribute('aria-expanded', 'false');
    this.startCooldownTicker();
    this.onSend(id);
  }

  private startCooldownTicker(): void {
    if (this.cooldownInterval !== null) {
      window.clearInterval(this.cooldownInterval);
      this.cooldownInterval = null;
    }
    this.toggleBtn.classList.add('cooling');
    this.cooldownInterval = window.setInterval(() => {
      if (this.getCooldownRemainingSec() <= 0) {
        if (this.cooldownInterval !== null) {
          window.clearInterval(this.cooldownInterval);
          this.cooldownInterval = null;
        }
        this.toggleBtn.classList.remove('cooling');
      }
      if (!this.tray.hidden) {
        this.buildTray();
      }
    }, 250);
  }

  /** Display an opponent, spectator, or self quick-chat preset bubbling out of the speech-bubble icon. */
  showBubble(id: string, senderLabel: string, isOpponent: boolean, isSpectator = false): void {
    if (isOpponent && this.mutedOpponent) return;
    const def = CHAT_MAP.get(id);
    if (!def) return;
    const phrase = this.getPhrase(def);
    const accent = isSpectator ? '#c084fc' : isOpponent ? '#38bdf8' : def.accent;
    this.pushFeed({ kind: 'chat', tag: senderLabel, text: phrase, accent }, isOpponent ? 'opp' : 'self', 2600, true);
  }

  /** Display a game broadcast event (Next Batter, Intentional Walk, Pitch Clock) from the speech bubble. */
  showBroadcast(tag: string, text: string, accent = '#f4c41c', durationMs = 2200): void {
    const cleanTag = tag || this.uiLabels.broadcastTag;
    this.pushFeed({ kind: 'broadcast', tag: cleanTag, text, accent }, 'broadcast', durationMs, false);
  }

  /** Display an online/system status message (Reconnect, Rematch, Maintenance, Timeout) from the speech bubble. */
  showSystem(title: string, detail = '', accent = '#f97316', durationMs = 2800): void {
    const combined = detail && detail.toUpperCase() !== title.toUpperCase() ? `${title} · ${detail}` : title;
    this.pushFeed({ kind: 'system', tag: this.uiLabels.systemTag, text: combined, accent }, 'system', durationMs, true);
  }

  private pushFeed(
    entry: FeedEntry,
    sideAttr: 'self' | 'opp' | 'broadcast' | 'system',
    durationMs: number,
    playChime: boolean,
  ): void {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
    if (!this.tray.hidden) {
      this.buildTray();
    }
    if (this.dock.hidden) return;

    this.bubble.replaceChildren();
    const tagEl = document.createElement('span');
    tagEl.className = 'chat-b-tag';
    tagEl.style.color = entry.accent;
    tagEl.textContent = entry.tag;
    fitNameLabel(tagEl, entry.tag);

    const textEl = document.createElement('span');
    textEl.className = 'chat-b-text';
    textEl.textContent = entry.text;

    this.bubble.append(tagEl, textEl);
    this.bubble.dataset.side = sideAttr;
    this.bubble.style.setProperty('--chat-accent', entry.accent);
    this.bubble.style.borderColor = entry.accent;
    this.bubble.hidden = false;
    this.bubble.classList.remove('out');

    // Pulse the speech-bubble icon briefly to tie the popup visually to the icon
    this.toggleBtn.classList.remove('pulse');
    void this.toggleBtn.offsetWidth;
    this.toggleBtn.classList.add('pulse');

    if (playChime && this.sfxEnabled) {
      this.onPlaySfx();
    }

    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubble.classList.add('out');
      this.bubbleTimer = window.setTimeout(() => {
        this.bubble.hidden = true;
        this.bubble.classList.remove('out');
        this.toggleBtn.classList.remove('pulse');
        this.bubbleTimer = null;
      }, 220);
    }, durationMs);
  }

  private hideBubbleImmediate(): void {
    if (this.bubbleTimer !== null) {
      window.clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    this.bubble.hidden = true;
    this.bubble.classList.remove('out');
    this.toggleBtn.classList.remove('pulse');
  }
}
