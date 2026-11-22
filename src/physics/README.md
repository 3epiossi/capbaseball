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
| [pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) | 定義 4 種球種規格 `PITCH_SPECS`、各球種飛行包絡線 `PitchEnvelope` 與 Chord-Newton 瞄準求解器 `solvePitchTrajectory`。 |
| [batted.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/batted.ts) | 座標轉換與 `Field3D` 擊球彈道模擬 `simulateBattedCap`（空氣阻力、地面反彈／滑行、13 m 圍牆與體育館邊界碰撞）。 |
| [contact.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/contact.ts) | 揮棒接觸品質與擊球初速計算 `evaluateSwingResolution`、外野飛球接殺模擬 `simulateDeterministicCatch` 與外野滾地攔截模擬 `simulateOutfieldGroundBlock`。 |

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
3. **球種飛行包絡線與平滑裁切（`PitchEnvelope`）**：每個球種在飛行過程中都設有天花板（`maxZ`）、地板（`minZ`）與左右側牆（`minY`／`maxY`）。初版使用 `Math.max(0.6, ...)` 的固定離散步階往回推仰角與方位角，導致變速球在高點附近瞄準時會出現高度上下跳動。現已改為 7 步單調二分搜尋（分別收斂 `elDeg` 與 `azDeg`），並讓前端瞄準準心直接綁定包絡線求解後的真實擊球點 `simToField(res.hitPlanePos)`，軌跡與控制點完全貼合。
4. **高解析度終算與位移量測**：以求解後角度執行高解析度模擬（`fixedStepSec = 0.002`、預設 `120` Hz），內插出 `HIT_PLANE_X`（`9.00` m）、`PLATE_PLANE_X`（`9.22` m）與 `PASS_LINE_SIM_X`（`11.554` m）位置，並輸出擊球面實際進壘球速 `hitPlaneSpeedMs`（同步傳遞至線上多核心 `physicsWorker`）；無氣動基準落點 `ballisticPos` 以解析拋物線直接計算，節省一次完整 RK4 模擬。

### 3. 擊球彈道模擬（`simulateBattedCap`）

在 `Field3D` 中以固定步長 `dt = 0.005` s 積分最多 `6.0` s，每 `1/60` s 記錄一幀：

- **空中飛行**：承受重力（`9.80665` m/s²）、二次空氣阻力（`AIR_DRAG_COEFF = 0.07` /m）、升力補償及週期性氣動抖動（`flutter`）。
- **圍牆與場地碰撞**：跨越半徑 `13.0` m 界內弧線時，高度 `<= FENCE_HEIGHT`（`0.75` m）則標記 `hitFence` 並以恢復係數 `0.42` 反彈；超過 `0.75` m 標記 `overFence`。同時檢查是否越過全壘打牆延伸線（`isPastFenceExtension`）。
- **觸地與滑行**：垂直速度 `|vy| > 0.7` m/s 時以 `FLOOR_RESTITUTION = 0.36`、水平摩擦 `0.78` 反彈；否則轉入地面滑行（減速度 `4.6` m/s²），水平速度降到 `0.12` m/s 以下停止。

### 4. 3D 圓柱體球棒揮棒接觸判定與接殺評估（`contact.ts`）

`evaluateSwingResolution` 在 `HIT_PLANE_Z = -0.22` m 平面，將球棒建構為沿 $X$ 軸橫放的 3D 圓柱體並納入球體碰撞半徑（Minkowski 和）：

- **2D 捕手截面圓柱棒框與球體半徑**：
  - 球棒本體尺寸（`getBatPciExtents`）與前端繪製 1:1 共用：一般揮棒（`normal`）為 `halfW = 0.128` m、`halfH = 0.050` m；強力揮棒（`power`）縮窄縮扁為 `halfW = 0.092` m、`halfH = 0.036` m；左右圓弧括號 `(` `)` 採二次貝茲曲線（`bracketCurveFrac = 0.14`）搭配上下兩條隱形水平界線。
  - 球體有效碰撞半徑 `CONTACT_BALL_RADIUS_M = 0.038` m（與側邊回饋卡 `◎` 外徑 1:1 對齊）。計算球心至棒身界線之最短歐氏距離 `edgeDistM`：
    - **界內擊球**：`edgeDistM <= 0.038` m（球緣與棒框相切或重疊）且時機差 `absTiming <= 0.085` s。
    - **Edge Graze Foul（`FOUL TIP`）**：`0.038 < edgeDistM <= 0.054` m 且 `absTiming <= 0.105` s。
    - **Timing Foul**：`0.085 < absTiming <= 0.145` s 且 `edgeDistM <= 0.062` m。
    - 其餘判定為揮空（`miss`）。
- **選手揮棒速度（BBS 公式）與 3D 圓柱法向量投影**：
  - 由選手基準揮棒速度 `v_bat`（預設 `defaultBatSpeedMs = 18.0` m/s，可由可選參數 `batSpeedMs` 傳入；強振模式乘上 `powerBatSpeedMult = 1.22`）與擊球面進壘球速 `v_pitch_hit` 計算棒心峰值初速：$v_{\text{peak}} = q\,v_{\text{pitch,hit}} + (1 + q)\,v_{\text{bat}}$（$q = 0.22$）。
  - 垂直偏移 $u_y = \Delta y / (H_{\text{bat}} + R_{\text{ball}})$ 對應圓柱截面表面法向量夾角 $\phi = \arcsin(\text{clamp}(0.95\,u_y,\,-0.95,\,0.95))$；法向分力與斜撞損耗係數 $f_{\text{cyl}} = (\cos\phi)^{1.45}$、橫向甜區衰減 $f_{\text{axis}} = 1 - 0.52\,\tilde{u}_x^2$、時機衰減 $f_{\text{time}} = 1 - 0.28\,\tau^2$，組合得初速 $v_{\text{exit}} = 2.5 + (v_{\text{peak}} - 2.5)\,f_{\text{cyl}}\,f_{\text{axis}}\,f_{\text{time}}$。
  - 擊球仰角依圓柱法向量偏移：$\theta_{\text{launch}} = \text{clamp}(\theta_0 + 0.95\,\phi_{\text{deg}},\,-35^\circ,\,+74^\circ)$（一般 $\theta_0 = 10^\circ$、強振 $13^\circ$）；越偏向上緣打出軟弱高沖天炮、越偏向下緣打出軟弱滾地球。水平噴射角結合揮棒時機拉推與棒端圓弧微偏角 $\psi = \arcsin(0.22\,\tilde{u}_x)$（限縮於 `±44°`）。
  - 擊球品質採乘積式 `rawQuality = fCyl * fAxis * (0.65 + 0.35 * timingQuality)`，確保咬在圓柱極端邊緣時維持鈍悶的 `'weak'` 擊球音效。
- **確定性接殺評估（`simulateDeterministicCatch`）**：在接球前先檢查不可接殺門檻（出速 `>= 16.5` m/s 或仰角 `< 22°`），接著逐幀推進左／右外野手（反應延遲 `0.45` s、衝刺極速 `3.2` m/s、最大追球距離 `2.6` m、圍牆緩衝限制 `12.45` m）。即使進入接球半徑 `0.48` m 且滯空時間 `>= 0.72` s，仍依出速與追球距離計算 `0.30–0.55` 的漏接率（`bobble`）。
- **外野滾地攔截守備（`simulateOutfieldGroundBlock`）**：針對未在空中接殺也未直接過牆的擊球，外野手以較短反應延遲（`0.24` s）、較快衝刺（`4.5` m/s）與較大攔截半徑（`1.05` m、最大追球距離 `4.2` m）攔截反彈或滾地強襲球；攔截成功時將擊球軌跡截斷於外野場內，使原本可能滾撞圍牆的二壘安打被壓制為一壘安打（`1B`）。

---

## 與其他模組的相依關係

- **相依於 `src/rules`**：
  - `batted.ts` 引用 `src/rules/field.ts` 的 `FENCE_DIST`、`FENCE_HEIGHT`、`isInfield`、`isOutfield` 與 `isPastFenceExtension`。
  - `contact.ts` 引用 `src/rules/field.ts` 的 `FENCE_DIST`，以及 `src/rules/judge.ts` 的 `judgeBattedCap` 與 `BattedOutcome`。
- **被其他模組使用**：
  - `src/ai/cpu.ts` 引用 `simToField`、`PITCH_IDS`、`PITCH_SPECS`、`contact.ts` 的外野手參數常數。
  - `src/rules/judge.ts` 與 `src/rules/match.ts` 引用 `BattedCapResult` 型別。
  - `src/render/*`（`camera.ts`、`cap3d.ts`、`gymScene.ts`、`overlay.ts`、`sprites.ts`）與 `src/net/client.ts` 引用 `FieldV3`、`PitchId` 等型別。
