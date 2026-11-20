# `src/audio` 程式化音效合成模組

## 模組總覽

`src/audio` 僅包含 `sfx.ts`，使用瀏覽器原生的 Web Audio API 即時合成復古風格的遊戲音效，不依賴外部音檔資源，並處理自動播放政策下的音訊解鎖與靜音狀態。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [sfx.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/audio/sfx.ts) | 實作 `RetroSfxEngine` 類別並匯出單例 `sfx`，封裝 `AudioContext` 生命週期與各類比賽事件音效。 |

---

## 核心資料流／演算法

### 1. 解鎖與生命週期管理

- **延遲建立與恢復**：`unlock()` 先檢查 `typeof window !== 'undefined'`（確保 SSR 或純 Node 測試環境不會報錯）。初次呼叫時建立 `window.AudioContext`（或 `webkitAudioContext`）；若處於瀏覽器預設的 `'suspended'` 狀態則呼叫 `resume()`。
- **靜音控制**：透過 `setMuted(muted)` 與 `isMuted()` 切換靜音；靜音時 `tone()` 直接返回，不建立振盪器節點。

### 2. 程式化音效合成（`tone()`）

所有音效皆由 `tone(freqStart, freqEnd, durationSec, type, gainPeak, delaySec)` 組合而成：

1. 每次觸發時自動呼叫 `this.unlock()`，確保使用者互動後即可正常發聲。
2. 建立 `OscillatorNode`（支援 `triangle`、`square`、`sawtooth`）與 `GainNode`。
3. 頻率控制：若 `freqEnd !== freqStart`，使用 `exponentialRampToValueAtTime` 做滑音（下限鉗制於 `20` Hz）。
4. 音量包絡（Envelope）：從 `0.0001` 於 `0.01` s 線性爬升至 `gainPeak`，再指數衰減回 `0.0001`，並在 `durationSec + 0.02` s 停止振盪器以避免爆音。

### 3. 內建事件音效清單

| 方法 | 用途 | 合成波形與特徵 |
|---|---|---|
| `playPitchWhoosh()` | 投手出手破空聲 | `triangle` 波由 `420` Hz 降至 `140` Hz（`0.11` s） |
| `playBatCrack(quality)` | 擊球聲（`weak` / `good` / `perfect` / `hr`） | 依擊球品質切換單音 `square` 或雙層 `sawtooth` + `square` 疊加 |
| `playFloorBounce()` | 瓶蓋落地反彈 | `triangle` 波由 `190` Hz 降至 `85` Hz（`0.06` s） |
| `playFenceHit()` | 擊中全壘打牆 | `sawtooth` 波由 `140` Hz 降至 `62` Hz（`0.16` s） |
| `playCatchPop()` | 捕手或野手接球 | `square` 波由 `320` Hz 升至 `580` Hz（`0.06` s） |
| `playUmpireTone(kind)` | 好球／壞球／出局判決 | 好球雙音上揚（`440` → `587` Hz），壞球微降，出局下降長音 |
| `playInningChange()` | 換局提示音 | C5–E5–G5–C6 四連音爬升（`square` 波） |
| `playHomeRunFanfare()` | 全壘打慶祝號角 | 6 音階上行 Fanfare（結尾延長至 `0.32` s） |

---

## 與其他模組的相依關係

- **無內部模組相依**：`sfx.ts` 為獨立模組，僅依賴瀏覽器 Web Audio API。
- **被其他模組使用**：`src/main.ts` 匯入 `sfx` 單例，於使用者點擊解鎖音訊並在投球、揮棒、碰撞、判決與換局時觸發對應音效。
