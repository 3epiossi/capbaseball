# `src/rules` 規則與比賽狀態機模組

## 模組總覽

`src/rules` 實作 2025 年 2 月版瓶蓋棒球正式規則的球場幾何定義、投打結果判決與完整比賽狀態機。所有函式皆為純 TypeScript 邏輯，不依賴 DOM 或瀏覽器 API，可同時在前端單機模式與後端權威伺服器共用。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [field.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/rules/field.ts) | 定義 2025-02 球場尺寸常數，以及界內外、內外野、全壘打牆延伸線與好球帶的幾何判斷函式。 |
| [judge.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/rules/judge.ts) | 實作投球判決 `judgePitch`、主審好球帶邊緣誤判模擬 `evaluateUmpirePitchCall` 與擊球結果判決 `judgeBattedCap`。 |
| [match.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/rules/match.ts) | 管理 `MatchState` 比賽狀態機，包含局數推進、強迫進壘、敬遠檢查、ABS 挑戰回溯、滿壘無人出局延長突破僵局與比賽結束原因（`endReason`）。 |

---

## 核心資料流／演算法

### 1. 2025-02 正式球場規格（`field.ts`）

所有距離以本壘板尖端 `(0, 0, 0)` 為原點（單位：公尺，`-Z` 朝向投手丘與外野）：

- **投打與捕逸**：投手板距離 `MOUND_DIST = 9.22` m、寬 `MOUND_WIDTH = 0.61` m；捕逸線（Pass line）位於本壘後方 `PASS_LINE_Z = 2.334` m。
- **好球帶**：寬 `PLATE_WIDTH = 0.432` m（`±0.216` m），垂直範圍 `STRIKE_ZONE_LO = 0.42` m 至 `STRIKE_ZONE_HI = 1.02` m。
- **內外野與圍牆**：45 度邊線構成界內區（`isFair`）；內野多邊形（`isInfield`）沿邊線延伸至 `INFIELD_FOUL_DIST = 8.0` m 並連結投手板 `(0, -9.22)`；外野全壘打牆弧線半徑 `FENCE_DIST = 13.0` m、高 `FENCE_HEIGHT = 0.75` m；界外區則以垂直邊線 `13.0` m 處之延伸線（`isPastFenceExtension`）作為二壘安打判定邊界。

### 2. 投球與擊球判決（`judge.ts`）

- **`judgePitch`**：依揮棒、接觸、捕手接捕與是否越過捕逸線，輸出 `IN_PLAY`、`STRIKE`、`BALL` 或 `UNCAUGHT_THIRD_STRIKE`（不死三振），並標記是否構成暴投進壘（`isWildPitch`）。可透過 `forceCall` 套用主審或 ABS 改判結果。
- **`judgeBattedCap`**：依規則 5.06 與 5.07 依序判定擊球結果：
  1. 落地前被野手接殺（`caughtInAir`）→ `OUT`。
  2. 未落地直接飛越全壘打牆（`bouncesBeforeFence === 0 && overFence`）→ `HR`。
  3. 未落地直接擊中全壘打牆（`bouncesBeforeFence === 0 && hitFence`）→ `3B`。
  4. 落點於界外或內野滾出界外 → `FOUL`。
  5. 落地反彈後（`bounces >= 1`）擊中圍牆、越牆或越過圍牆延伸線 → `2B`。
  6. 球停於內野區（`isInfield`）→ `OUT`。
  7. 落地於外野區且未觸牆／越線 → `1B`。

### 3. 主審邊緣誤判與 ABS 挑戰（`judge.ts`、`match.ts`）

- **主審誤判模擬**：`computeStrikeZoneMarginM` 計算球緣（含瓶蓋半徑 `CAP_RADIUS_M = 0.015` m）與好球帶矩形的有號距離（`<= 0` 為真實好球）。當 `|marginM| <= ABS_BORDERLINE_MARGIN_M`（`0.065` m）時，`evaluateUmpirePitchCall` 以確定性亂數產生 `26%`（`UMPIRE_BLOWN_CALL_RATE = 0.26`）的誤判率。
- **挑戰配額與狀態回溯**：每隊開局擁有 `2` 次挑戰機會（`absChallenges: { away: 2, home: 2 }`）。僅主審判決不利方（好球由打擊方、壞球由守備方）可對上一球提出挑戰。`applyAbsChallenge` 檢查資格後：
  - 若 `trueCall !== umpireCall`（挑戰成功／改判）：自 `preSnapshot` 還原球數、出局數、壘包、分數與打序，扣減重複計算的投球數，再以 `forceCall: lc.trueCall` 重新執行 `applyPitchResult`，且**不扣除**挑戰次數。
  - 若維持原判（`UPHELD`）：扣除挑戰方 `1` 次挑戰機會。

### 4. 比賽進程與延長突破僵局（`match.ts`）

- **模式設定**：`official6` 為 6 局制，`quick3` 為 3 局制；`practice_bat` 與 `practice_pitch` 無限循環局數且每次換打者重置 ABS 挑戰次數。
- **延長突破僵局（滿壘無人出局，取消全壘打大賽）**：正規局數結束若仍平手，每一個延長半局均由 `transitionHalfInning` 自動設定為 **0 出局滿壘**（由當前打序前三位打者佔據一、二、三壘），持續進行直到分出勝負（不再於第 4 局後切換全壘打大賽）。
- **扣倒制（Mercy Rule / Cold Game）與結束原因（`endReason`）**：自第 2 局起，只要半局結束（或下半局主隊領先）分差達 `10` 分以上且已啟用 `mercyRule`（預設開啟，好友房建房時可切換），比賽直接提前結束並標記 `mercyTriggered = true` 與 `endReason = 'mercy'`；線上對戰另區分 `disconnect`（對手斷線逾時）與 `resign`（對手棄權）。
- **投球時鐘規則（`getPitchClockSeconds` / `applyPitchClockViolation`）**：壘上無人為 `15` 秒，壘上有跑者為 `20` 秒；超時判自動壞球（第 4 球四壞保送、支援滿壘再見保送）。
- **突破僵局模式（`tiebreak` / `populateTiebreakBases`）**：1 局制開局即為第 1 局上 0 出局滿壘，平手進入延長局亦延續 0 出局滿壘開局，1 下半局超前即再見勝利。

---

## 與其他模組的相依關係

- **相依於 `src/physics`**：
  - `judge.ts` 與 `match.ts` 引用 `src/physics/batted.ts` 的 `BattedCapResult` 型別。
- **被其他模組使用**：
  - `src/physics/batted.ts` 與 `src/physics/contact.ts` 引用 `field.ts` 幾何函式與 `judge.ts` 判決邏輯。
  - `src/ai/cpu.ts` 引用 `field.ts` 的好球帶與圍牆常數。
  - `src/render/gymScene.ts`、`src/render/overlay.ts` 與 `src/net/client.ts` 引用場地常數與 `MatchState` 型別。
