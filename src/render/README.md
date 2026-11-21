# `src/render` 3D 像素舞台與高 DPI 覆蓋渲染模組

## 模組總覽

`src/render` 採用「雙層 Canvas」渲染架構：底層低解析度 `#pixel-canvas`（關閉影像平滑）負責繪製校園禮堂木地板、紅絲絨舞台、13 公尺全壘打牆、人物精靈與擊出後的瓶蓋；上層高 DPI `#overlay-canvas` 負責繪製清晰的好球帶網格、球路變化預覽、打者括號 PCI、投球飛行中的 3D 瓶蓋與 ABS 鷹眼重播介面。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [camera.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/camera.ts) | 實作 `GameCamera` 3D 透視投影、跨裝置參考長寬比 FOV 校正、擊球追蹤運鏡、螢幕震動與射線反推本壘平面座標（`screenToPlaneZ`）。 |
| [gymScene.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/gymScene.ts) | 繪製台灣學校大禮堂（楓木地板、多運動場線、2025-02 瓶蓋棒球標線、舞台布幕與燈具）、離屏背景快取及 24 段 13 m 藍黃圍牆。 |
| [cap3d.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/cap3d.ts) | 將 6-DOF 瓶蓋法向量轉為 `Field3D` 朝向（`simNormalToField`），並以正面圓盤、側面裙邊與背面陰影繪製真實傾斜的 3D 瓶蓋（`drawTrue3DCap`）。 |
| [sprites.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/sprites.ts) | 非同步載入投手／打者／外野手／擊球特效精靈圖集，並以畫家演算法（Painter's algorithm）深度排序繪製所有場上實體。 |
| [overlay.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/overlay.ts) | 在高 DPI 覆蓋層繪製 3×3 好球帶、3D 投球軌跡預覽、打者括號 PCI、縮圈時機導引環、高解析度投球瓶蓋、獨立靜止攝影機側邊回饋卡與 ABS 鷹眼重播。 |
| [catcherReturn.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/catcherReturn.ts) | 繪製捕手接球停頓 `0.36` s 後，由畫面右下角以 16-bit 像素右手拋回投手丘的溫和拋物線回傳動畫。 |

---

## 核心資料流／演算法

### 1. 跨裝置參考長寬比 FOV 框景（`camera.ts`）

`GameCamera.rebuildBasis` 確保無論在 16:9 桌機、4:3 平板、超寬螢幕或 9:19.5 直向手機上，投手丘、好球帶與打者都能維持一致的可見比例：

- **橫向／方正視窗（`aspect >= 0.85`）**：以 16:9 基準垂直視角 `BASE_FOV = 36°` 換算水平參考正切值 `refHalfTanH`，在較窄長寬比下自動放大垂直 `tanHalfV`，防止兩側打擊區被裁切。
- **直向手機視窗（`aspect < 0.85`）**：以 `PORTRAIT_POS = [0, 1.0, 2.48]`、`PORTRAIT_FOV = 48°` 為基礎，並依長寬比動態展開至最高 `62°` 垂直視角。
- **動態安全區垂直投影中心（`setTargetCenterYRatio`）**：手機等窄螢幕存在頂部 HUD 與底部投手面板時，會動態將投影中心 `centerYRatio` 上移至無遮擋安全區內（並同步套用於 `screenToPlaneZ()` 反推），防止好球帶下緣被投手面板遮擋。
- **擊球追蹤運鏡**：設定 `followTarget` 後，攝影機平滑插值至高角度追球視角（FOV 展開至 `44°` 橫向／`54°` 直向），將 8 m 內野、外野手與 13 m 圍牆同時納入畫面。

### 2. 禮堂靜態背景離屏快取（`gymScene.ts`）

`drawGymBackground` 使用獨立的離屏 `<canvas>`（`bgCacheCanvas`）快取靜態禮堂舞台，大幅降低 Raspberry Pi 或行動瀏覽器的每幀繪製開銷：

- 快取鍵值結合 `cam.getPoseKey()`（解析度、攝影機位置／目標／FOV）與 `Math.floor(timeSec * 4)`（4 Hz 頂燈微閃頻率）。
- 僅在攝影機移動、視窗縮放或跨過 0.25 秒燈光節拍時重繪離屏緩衝，其餘幀直接以 `ctx.drawImage(bgCacheCanvas, 0, 0)` 貼上。

### 3. 6-DOF 傾斜 3D 瓶蓋渲染（`cap3d.ts`）

`drawTrue3DCap` 依據物理引擎輸出的世界座標法向量 `normalField` 建立正交基底 `(u, v, n)`，並依真實瓶蓋比例（半高 `halfH = rWorld * 0.44`，對應 14 mm 高／31 mm 直徑）投影出前蓋面、後底面與 16 段側壁：

- 透過攝影機視線與法向量點積判斷 `topFacing`，正面朝向觀眾時繪製亮白頂面、隊色內圈與高光點；背蓋朝向觀眾時則繪製凹槽陰影（`#cbd5e1`）。
- 若投影行列式過小（側緣正對視線 `|det| <= 0.25`），自動退化為圓頭細長膠囊線段，避免側飛時閃爍消失。

### 4. 深度排序渲染管線（`sprites.ts`）

`drawWorldEntities` 將 `buildFenceDepthItems` 產生的 24 片圍牆（含擊牆閃光）、彈跳波紋圈、圍牆／全壘打爆裂特效、投手（`z = -9.22`）、左右外野手、左右打擊區鏡像打者（`x = ±0.76, z = 0.14`）以及擊出後的瓶蓋（含高飛球黃色追蹤框與垂直鉛垂線）全數收集至 `DepthDrawItem[]`，最後依 `depth` 由遠而近排序繪製，正確處理飛球越牆、外野手站位與圍牆前後遮擋關係。

> **精靈圖修補紀錄**：`public/sprites/pitcher_strip.png` 與 `public/sprites/pitcher_black_strip.png` 曾於 15 個影格的大腿／短褲區域（`y=48..80`）出現封閉透明破洞，已使用邊界像素向內填補完畢（共修補 1,007 個像素）。

### 5. 括號 PCI、側邊回饋卡與 ABS 鷹眼重播（`overlay.ts`）

- **括號 PCI（Plate Coverage Indicator）**：打擊階段在 `HIT_PLANE_Z = -0.22` 平面繪製左／右括號 `( • )` 與中心甜區點；打者一揮棒即刻隱藏 3D 實時括號，避免與側邊回饋卡重複殘留。一般揮棒（`NORMAL`）世界半徑為 `0.098` m（垂直 `0.076` m），強力揮棒（`POWER`）縮窄為 `0.068` m（垂直 `0.052` m）並轉為橘色邊框；投球飛行中同步顯示向中心收縮的時機導引環（`guideProgress` 進入 `0.85..1.08` 時閃爍金藍提示）。
- **獨立靜止攝影機側邊回饋卡（`drawStackedSideFeedback`）**：
  - 使用專用靜止參考攝影機 `restCam` 計算本壘好球帶投影，確保鏡頭追球與回拉期間側邊卡完全不漂移。
  - 依捕手視角放置於打者對側空位（左打者站畫面右側，卡片放左側；右打者站畫面左側，卡片放右側），並將寬度嚴格限制在 `<= sideSpace`，桌機、平板與直向手機皆不遮擋好球帶。
  - 上格整合結果大標、細項、球種／球速／變化量與 3×3 進球落點（揮棒時同步繪製 PCI）；下格以本壘板為中心繪製橫掃板面上方的球棒軌跡與紅黃綠扇形時機區，並顯示初速與仰角。
  - **ABS 方案 B 原地翻牌遮罩**：未揮棒且玩家具 ABS 挑戰資格時，側邊卡先以 `? ABS 可挑戰` 遮罩蓋住 3×3 落點防劇透；2.2 秒倒數結束未挑戰時，於同一張卡片原地閃光翻開真實進壘點。
- **ABS 鷹眼重播（`AbsReplayState`）**：觸發挑戰時，將好球帶轉為水藍色鷹眼網格，標出實際進壘點與最近邊緣距離（`±X.X cm`，好球黃點、壞球綠點與全站 BSO 色系一致），並在畫面上方顯示 `CALL OVERTURNED!` 或 `CALL UPHELD` 播報橫幅。

---

## 與其他模組的相依關係

- **相依於 `src/physics`**：引用 `FieldV3` 與 `PitchId` 型別。
- **相依於 `src/rules`**：引用 `field.ts` 中的球場與好球帶常數（`FENCE_DIST`、`FENCE_HEIGHT`、`MOUND_DIST`、`PASS_LINE_Z`、`PLATE_WIDTH`、`STRIKE_ZONE_LO`、`STRIKE_ZONE_HI` 等）。
- **被其他模組使用**：`src/main.ts` 呼叫本模組完成每幀渲染；`src/ai/cpu.ts` 引用 `sprites.ts` 的 `FielderAnim` 型別。
