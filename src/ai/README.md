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

### 4. 全場 4 人守備與等速追球（`updateOutfielders`）

守備動畫與 `src/physics/contact.ts` 共用 4 名守位（`P`、`C`、`LF`、`RF`），所有守備員皆可進入界外區接球或擋球：

- **權威攔截點等速奔跑（消除隔山打牛）**：當該名守備員負責接殺或擋球（`interception.fielderId === f.id`），在經過反應延遲（投手含投球後收尾延遲）後，改以精確等速 `d / remTime`（極短距離步移下限 `1.8` m/s）直線跑向 `interception.targetPos`，於 `targetTimeSec` 準時到位並接續撲接／撈球動作，不會提早急停或越跑越慢。
- **其餘守備員固定目標等速追球**：整球過程鎖定單一固定落點（`interception.targetPos` 或 `finalTarget`）並預先一次裁切追球半徑與界內圍牆邊界（界外區自由進出），不在球落地彈跳時切換目標或放大追球半徑，消除界外球追到一半急停再慢走的問題。

---

## 與其他模組的相依關係

- **相依於 `src/physics`**：引用 `batted.ts`（`simToField`、`FieldV3`）、`pitches.ts`（`PITCH_IDS`、`PITCH_SPECS` 等）與 `contact.ts` 的外野守備常數。
- **相依於 `src/rules`**：引用 `field.ts` 的 `FENCE_DIST`、`isInStrikeZone`、`PLATE_WIDTH`、`STRIKE_ZONE_LO`、`STRIKE_ZONE_HI`。
- **相依於 `src/render`**：引用 `sprites.ts` 的 `FielderAnim` 型別。
- **被其他模組使用**：
  - `src/main.ts` 在單機與練習模式中呼叫投打決策與外野手更新。
  - `server/index.ts` 引用 `checkCatcherCatch` 進行伺服器端權威捕手接捕判定。
