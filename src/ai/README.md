# `src/ai` 電腦對手與守備模組

## 模組總覽

`src/ai` 包含單一子模組 `cpu.ts`，負責處理電腦（CPU）投手的配球決策、電腦打者的揮棒規劃、捕手接捕判斷，以及符合真實體感的弱化外野手移動與動畫更新。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [cpu.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ai/cpu.ts) | 實作 CPU 投球選擇 `chooseCpuPitch`、CPU 揮棒規劃 `evaluateCpuSwing`、捕手接球判定 `checkCatcherCatch` 與外野手追球狀態更新 `updateOutfielders`。 |

---

## 核心資料流／演算法

### 1. CPU 投球決策（`chooseCpuPitch`）

依難度 `difficulty`（限制在 `1–5`）與當前球數 `(balls, strikes)` 產生 `CpuPitchChoice`：

- **球種與球速**：從 `PITCH_IDS` 均勻隨機挑選球種，並以 `speedBias = 0.45 + diff * 0.09` 決定球速在該球種 `speedRangeKmh` 中的落點區間。
- **好球帶瞄準**：球數落後（`balls >= 2`）時投入好球帶機率提高至 `0.85`；球數領先（`strikes >= 2`）時降至 `0.52` 並轉向邊角或壞球區引誘；一般球數為 `0.72`。
- **控球誤差**：散佈半徑 `maxScatter = (6 - diff) * 0.028` m，難度越高控球越精準。

### 2. CPU 揮棒規劃（`evaluateCpuSwing`）

根據模擬出的來球軌跡 `PitchTrajectoryResult` 評估是否出棒及出棒位置：

- **好壞球辨識與追打**：利用 `simToField(pitch.hitPlanePos)` 轉換至本壘擊球點並以 `isInStrikeZone` 檢查是否在好球帶內。變化幅度 `breakMag = Math.hypot(breakDelta[1], breakDelta[2])` 越大，追打壞球機率越高（`chaseProb = max(0.08, 0.42 - diff * 0.06 + breakMag * 0.35)`）；好球放掉機率為 `takeStrikeProb = max(0.08, 0.32 - diff * 0.05)`。
- **瞄準與時機誤差**：難度越高誤差越小，且變化幅度大的球路會額外增加瞄準誤差（`aimErr = (6 - diff) * 0.025 + breakMag * 0.12`、`timingErr = (6 - diff) * 0.016` s）。

### 3. 捕手接捕判定（`checkCatcherCatch`）

- 若球未越過捕逸線（`!reachesPassLine`），直接判定接捕成功。
- **正常接捕區**：`|plateX| <= 0.58` m 且高度 `plateY` 介於 `0.10–1.48` m 之間必接住。
- **撲接邊緣區**：`|plateX| <= 0.78` m 且高度介於 `0.05–1.68` m 之間，僅有 `35%` 機率成功撲接（傳入 `seed` 時使用確定性雜湊，供伺服器與客戶端一致判定），否則形成暴投／不死三振。

### 4. 弱化外野守備（`updateOutfielders` 與確定性接殺協作）

為了避免 2 人外野守備覆蓋率過高導致安打過少，守備移動與 `src/physics/contact.ts` 中的 `simulateDeterministicCatch` 共用同一套弱化參數：

- **初始站位與分工**：左外野手（`LF`）位於 `[-4.2, 0, -9.8]`，右外野手（`RF`）位於 `[4.2, 0, -9.8]`。落點 `x <= 1.2` 由 `LF` 主追，`x >= -1.2` 由 `RF` 主追，另一人適度內縮補位。
- **反應延遲與加速曲線**：擊球後經過 `OUTFIELDER_REACTION_DELAY = 0.45` s 才啟動跑動，並在接下來的 `0.35` s 內線性加速至 `OUTFIELDER_SPRINT_SPEED = 3.2` m/s。
- **追球上限與圍牆夾緊**：距起始位置最多追出 `OUTFIELDER_MAX_CHASE_DIST = 2.6` m，且透過 `clampFielderInsideFence` 限制半徑不超過 `MAX_FIELDER_R = FENCE_DIST - 0.55`（`12.45` m）並保持在界內（`z <= -2.5`、`abs(x) <= -z`）。
- **不可接殺門檻與漏接率**（實作於 `src/physics/contact.ts`）：出速 `>= 16.5` m/s（`UNCATCHABLE_EXIT_SPEED_MS`）、仰角 `< 22°`（`UNCATCHABLE_LAUNCH_ANGLE_DEG`）或滯空 `< 0.72` s（`UNCATCHABLE_AIR_TIME_SEC`）直接視為無法接殺；即使在接球半徑 `0.48` m 內，仍依球速與衝刺距離有 `30%–55%` 的漏接率（`bobble`）。

---

## 與其他模組的相依關係

- **相依於 `src/physics`**：引用 `batted.ts`（`simToField`、`FieldV3`）、`pitches.ts`（`PITCH_IDS`、`PITCH_SPECS` 等）與 `contact.ts` 的外野守備常數。
- **相依於 `src/rules`**：引用 `field.ts` 的 `FENCE_DIST`、`isInStrikeZone`、`PLATE_WIDTH`、`STRIKE_ZONE_LO`、`STRIKE_ZONE_HI`。
- **相依於 `src/render`**：引用 `sprites.ts` 的 `FielderAnim` 型別。
- **被其他模組使用**：
  - `src/main.ts` 在單機與練習模式中呼叫投打決策與外野手更新。
  - `server/index.ts` 引用 `checkCatcherCatch` 進行伺服器端權威捕手接捕判定。
