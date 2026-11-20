# `src/physics` 物理模擬模組

## 模組總覽

`src/physics` 負責瓶蓋棒球的 3D 剛體飛行、擊球後飛行彈道與揮棒接觸判定。投球模擬移植自 Python `cap_flight_sim` 的 6-DOF 剛體動力學引擎，擊球與守備接殺判定則運行於球場 `Field3D` 座標系。

整體架構分為兩組座標系：

- **`cap-flight-sim`（FLU 右手系）**：用於投球積分。原點在投手板，`+X` 朝向捕手，`+Y` 為投手左側（打者右側），`+Z` 向上。
- **`Field3D`（球場座標系）**：用於擊球飛行與規則判定。原點 `(0, 0, 0)` 在本壘板尖端，`+X` 朝向一壘側，`+Y` 向上，`-Z` 朝向投手丘與外野（投手板位於 `z = -9.22` m，全壘打牆半徑 `13.0` m），`+Z` 為本壘後方（捕逸線 `z = +2.334` m）。

`batted.ts` 提供 `simToField` 與 `fieldToSim` 進行兩者轉換，偏移常數為 `PLATE_TO_MOUND_M = 9.22`。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [vector.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/vector.ts) | 3D 向量（`V3`）、四元數（`Q4`、`[w, x, y, z]`）、3x3 矩陣（`M3`）與歐拉角轉換純函式，不依賴 `three.js`。 |
| [config.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/config.ts) | 將 JSON 原始設定展開為 SI 單位的 `SimConfig`，計算薄壁杯狀瓶蓋（`thin_walled_cup`）質量特性與 13 維初始狀態 `y0`。 |
| [aerodynamics.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/aerodynamics.ts) | 實作 `simple` 氣動力係數模型，計算攻角、側滑角、阻力（`drag`）、升力（`lift`）、馬格努斯力（`magnus`）與力矩。 |
| [wake.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/wake.ts) | 實驗性非定常尾流橫力與力矩模型（`makeWakeEvaluator`），以多頻帶正弦疊加產生抖動並隨轉速衰減。 |
| [dynamics.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/dynamics.ts) | 組裝 13 維剛體狀態微分函式 `makeDerivative`（啟用 `wake` 時擴充為 14 維，含尾流相位 `Φ`）。 |
| [simulate.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/simulate.ts) | 固定步長 RK4 積分器、三次 Hermite 內插、Brent 法事件定位（觸地 `ground`、捕手面 `catcher_plane`）與等頻取樣。 |
| [pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) | 定義 4 種球種規格 `PITCH_SPECS` 與 Chord-Newton 瞄準求解器 `solvePitchTrajectory`。 |
| [batted.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/batted.ts) | 座標轉換與 `Field3D` 擊球彈道模擬 `simulateBattedCap`（空氣阻力、地面反彈／滑行、13 m 圍牆與體育館邊界碰撞）。 |
| [contact.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/contact.ts) | 揮棒接觸品質與擊球初速計算 `evaluateSwingResolution`，以及外野手確定性接殺模擬 `simulateDeterministicCatch`。 |

---

## 核心資料流／演算法

### 1. 4 種球種規格（`pitches.ts`）

`PITCH_SPECS` 定義了 `straight`、`cutter`、`fork` 與 `changeup` 四種球路：

| `PitchId` | 代碼 | 初始姿態（`baseAttitude`） | 轉速（`rpm`） | 球速範圍（km/h） | 氣動特性 |
|---|---|---|---|---|---|
| `straight` | `4SFB` | `flat`（仰角 `5.5°`） | `2000`（`cap` 軸逆時針） | `64–76`（預設 `70`） | `clAlphaPerRad = 0.8`、`magnusCoeff = 0.015`，12 點鐘微上飄 |
| `cutter` | `CUT` | `flat`（右傾 `-34°`、仰角 `1.0°`） | `1500`（`cap` 軸順時針） | `64–75`（預設 `70`） | `clAlphaPerRad = 0.9`、`magnusCoeff = 0.04`，4 點鐘斜下竄 |
| `fork` | `FORK` | `edge_on` | `500`（`world_y` 逆時針） | `58–70`（預設 `65`） | `clAlphaPerRad = 0.08`、`magnusCoeff = 0.25`，6 點鐘急墜 |
| `changeup` | `CH` | `edge_on`（右傾 `-90°`、仰角 `75°`） | `0` | `44–56`（預設 `50`） | `cdProjected = 0.28`、`clAlphaPerRad = 0.72`，正面迎風高阻力慢墜 |

### 2. Chord-Newton 投球瞄準求解器（`solvePitchTrajectory`）

給定目標擊球點 `(targetPlateY, targetPlateZ)`，求解器需找出讓瓶蓋在 `HIT_PLANE_X = 9.0` m 通過目標的發射方位角 `azDeg` 與仰角 `elDeg`：

1. **幾何初猜**：依釋球點 `DEFAULT_RELEASE_POS = [0.35, -0.22, 1.18]` 與目標點計算直線角度作為初始 `(azDeg, elDeg)`。
2. **Chord-Newton 迭代**（最多 14 次）：以粗步長（`fixedStepSec = 0.004`、`outputHz = 30`、關閉尾流）呼叫 `runSimulation` 評估偏差。僅在第 0 次或誤差未收斂至前次 `0.7` 倍時，以 `epsDeg = 0.25` 有限差分重算 2x2 Jacobian，避免在 ARM/Raspberry Pi 上重複計算。誤差小於 `0.008` m 即停止。
3. **高解析度終算與位移量測**：以求解後角度執行高解析度模擬（`fixedStepSec = 0.002`、預設 `120` Hz），內插出 `HIT_PLANE_X`（`9.00` m）、`PLATE_PLANE_X`（`9.22` m）與 `PASS_LINE_SIM_X`（`11.554` m）位置；同時跑一組關閉氣動力的純重力彈道，計算氣動位移變化量 `breakDelta`。

### 3. 擊球彈道模擬（`simulateBattedCap`）

在 `Field3D` 中以固定步長 `dt = 0.005` s 積分最多 `6.0` s，每 `1/60` s 記錄一幀：

- **空中飛行**：承受重力（`9.80665` m/s²）、二次空氣阻力（`AIR_DRAG_COEFF = 0.07` /m）、升力補償及週期性氣動抖動（`flutter`）。
- **圍牆與場地碰撞**：跨越半徑 `13.0` m 界內弧線時，高度 `<= FENCE_HEIGHT`（`0.75` m）則標記 `hitFence` 並以恢復係數 `0.42` 反彈；超過 `0.75` m 標記 `overFence`。同時檢查是否越過全壘打牆延伸線（`isPastFenceExtension`）。
- **觸地與滑行**：垂直速度 `|vy| > 0.7` m/s 時以 `FLOOR_RESTITUTION = 0.36`、水平摩擦 `0.78` 反彈；否則轉入地面滑行（減速度 `4.6` m/s²），水平速度降到 `0.12` m/s 以下停止。

### 4. 揮棒接觸判定與接殺評估（`contact.ts`）

`evaluateSwingResolution` 在 `HIT_PLANE_Z = -0.22` m 平面評估揮棒：

- **接觸半徑與時機窗**：`meetRadius` 在一般揮棒（`normal`）為 `0.108` m，強力揮棒（`power`）為 `0.076` m；`radialNorm = dist / meetRadius`。
  - **界內擊球**：`radialNorm <= 1.0` 且時機差 `absTiming <= 0.085` s。
  - **Timing Foul**：`0.085 < absTiming <= 0.145` s 且 `radialNorm <= 1.42`。
  - **Edge Graze Foul**：`1.0 < radialNorm <= 1.38` 且 `absTiming <= 0.105` s。
  - 其餘判定為揮空（`miss`）。
- **擊球品質與初速**：`rawQuality = 0.55 * centerQuality + 0.45 * timingQuality`。`rawQuality > 0.78` 為 `perfect`（初速範圍 `21.0–26.5` m/s normal、`24.0–31.0` m/s power），其餘依 `dtTiming` 分為 `good`、`early` 或 `late`。接著依揮棒時機與棒頭偏移推算噴射角 `sprayDeg`（限縮於 `±44°`）與仰角 `elevDeg`（`-6°–52°`），送入 `simulateBattedCap`。
- **確定性接殺評估（`simulateDeterministicCatch`）**：在接球前先檢查不可接殺門檻（出速 `>= 16.5` m/s 或仰角 `< 22°`），接著逐幀推進左／右外野手（反應延遲 `0.45` s、衝刺極速 `3.2` m/s、最大追球距離 `2.6` m、圍牆緩衝限制 `12.45` m）。即使進入接球半徑 `0.48` m 且滯空時間 `>= 0.72` s，仍依出速與追球距離計算 `0.30–0.55` 的漏接率（`bobble`）。

---

## 與其他模組的相依關係

- **相依於 `src/rules`**：
  - `batted.ts` 引用 `src/rules/field.ts` 的 `FENCE_DIST`、`FENCE_HEIGHT`、`isInfield`、`isOutfield` 與 `isPastFenceExtension`。
  - `contact.ts` 引用 `src/rules/field.ts` 的 `FENCE_DIST`，以及 `src/rules/judge.ts` 的 `judgeBattedCap` 與 `BattedOutcome`。
- **被其他模組使用**：
  - `src/ai/cpu.ts` 引用 `simToField`、`PITCH_IDS`、`PITCH_SPECS`、`contact.ts` 的外野手參數常數。
  - `src/rules/judge.ts` 與 `src/rules/match.ts` 引用 `BattedCapResult` 型別。
  - `src/render/*`（`camera.ts`、`cap3d.ts`、`gymScene.ts`、`overlay.ts`、`sprites.ts`）與 `src/net/client.ts` 引用 `FieldV3`、`PitchId` 等型別。
