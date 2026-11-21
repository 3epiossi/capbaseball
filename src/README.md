# `src` 前端應用入口與主控模組

## 模組總覽

`src` 根目錄負責整合遊戲主迴圈、DOM 介面事件、雙層 Canvas 調度、單機／雙人／練習／線上對戰流程以及跨裝置自適應佈局。入口頁面 [index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html) 載入 [main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 與 [styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css)，在啟動時載入精靈圖集並以 `requestAnimationFrame` 驅動全螢幕遊戲舞台。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html) | 定義雙層 Canvas（`#pixel-canvas`、`#overlay-canvas`）、頂部 HUD（`.hud-top-region`）、漢堡選單、`#update-banner` 與各式原生 `<dialog>` 視窗。 |
| [main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) | 管理遊戲階段狀態機、光譜整合彈簧投球、拖曳放開觸控打擊、線上揮棒時序佇列同步、投球時鐘、更新提示與零 `innerHTML` 安全 DOM 更新。 |
| [styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css) | 實作 16-bit 像素播報風格樣式、統一光譜彈簧軌道、桌機放大 HUD 與 `@container` 響應式規則。 |
| [i18n/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/i18n/index.ts) | 依瀏覽器語系自動切換繁體中文（`zh-TW`）、日文（`ja`）與英文（`en`），並轉換伺服器裁判播報字串。 |

---

## 核心資料流／演算法

### 1. 頂部統合播報區與 Play Call／ABS（`.hud-top-region`、`.zone-top-hud`）

- **零重疊頂部容器（`.hud-top-region`）**：將左上角計分板（`#scoreboard`）與右上角固定 2 排工具列（`.top-bar`）納入同一個 Flex 容器；寬螢幕左右並排，手機窄螢幕自動垂直堆疊，徹底避免文字換行或按鈕增減造成互遮。
- **記分板（`#scoreboard`）**：顯示客主隊分數、壘包鑽石圖（`#base-1` 至 `#base-3`）、局數／球數、出局數與 ABS 剩餘挑戰次數燈號（`#abs-1`、`#abs-2`），底部跑馬燈顯示當前打者、投手用球數與遙測資訊；投球飛行中僅顯示 `IN FLIGHT`，**通過本壘板或擊中後才揭露實際球種與球速**。
- **前景安全區 Play Call／ABS（`.zone-top-hud`）**：將 `FOUL`、`TOO LATE`、`SINGLE`、`DOUBLE` 等統一卡片與放大版 `ABS` 按鈕**釘死於螢幕前景安全區**（與 3D 好球帶投影脫鉤，追球運鏡時不再跟著移動），且揮棒落空時**直接顯示 timing 結果**（不再先閃紅色 `MISS`）；`ABS` 按鈕與卡片透過 `startAbsPromptWindow()` 同步淡出，雙方消散前鎖定投球。
- **字體選擇**：一般介面與播報文字採用 `Chakra Petch` 提升小尺寸辨識度，主標題保留 `Silkscreen`。

### 2. 右上角單列狀態與漢堡收折選單（`.top-bar`）

桌機與行動裝置一律維持單列右對齊結構，不佔用垂直畫面：

- **單列內容**：玩家暱稱晶片（`#btn-nick-chip`，手機自動隱藏）、即時網速狀態膠囊（`#net-speed-pill`）、線上人數膠囊（`#top-online-pill`），以及固定置右的三條線漢堡鈕（`#btn-menu` `☰`）；規則、設定、音效、棄權，以及打擊時的左右打切換（`#btn-hand`）／強振模式切換（`#btn-swing-type`，`#menu-bat-row`）統一收進可折疊 `#menu-dialog` 內，維持比賽主畫面單列極簡無遮擋。
- **暫停與返回導航（`isGamePaused` / `navigateBack`）**：開啟選單、規則或設定對話框時，單機對戰會立即暫停物理與計時器；**線上對戰開啟選單時不停止比賽，且會於 `#menu-online-timer` 顯示 20 秒倒數，時間歸零即強制關閉選單恢復操作**；支援點擊與全域 `Escape`／`Backspace` 快捷鍵返回。
- **伺服器版本漂移提醒（`#update-banner`）**：比對編譯注入的 `__BUILD__` 與伺服器 `welcome`／`/health` 版本號，若發現新版則提示玩家點擊刷新。

### 3. 光譜整合彈簧投球、投球時鐘與手機拖曳打擊

- **光譜整合彈簧發射器（`springMeter`）**：彈簧線圈直接繪製於 `NORMAL · BEST · OVER` 光譜軌條上——按住左側壓縮（`charging`）→ 放開後彈簧向右伸展彈射至最高點（`rebounding`）→ 鎖定峰值（`locked`）決定球速與控球並出手。
- **手機觸控打擊（下方游標操作＋直接點擊，`activeBatTouchId`）**：預設於好球帶下方（`y < 0.42m`）觸控、或好球帶內拖曳 `≥ 6px`／按住 `≥ 130ms` 時，立即鎖定向上偏移 `76–124px` 讓準心位於指尖上方不遮擋瓶蓋，放開即揮棒；快速輕點（`< 6px` 且 `< 130ms`）則維持零偏移直接對點打擊，設定中保留「僅限點擊揮棒」選項。
- **線上揮棒同步與結算防卡死**：收到擊球 `pitch_result` 時先以 `queuedOnlinePitchResult` 對齊投手端本地飛行時間，提前 `110ms` 播出打者揮棒動畫並延遲 `180ms` 追球；`match = msg.match` 延後至 `finishBattedPlay()` 套用，確保最後一球再見安打或出局不會提前被 `isGameOver` 卡死在空中。

### 4. 主選單分流、10 秒自動切 CPU 與負載備援

首頁大廳（`#lobby-hub`）並列「線上對戰」、「好友對戰」、「CPU 對戰（內含三局對戰、打擊練習、投球練習）」與「即時觀戰」。點擊線上對戰（`#btn-hub-play`）前與排隊過程中，`main.ts` 持續監聽 `onlineClient.onNetUpdate`：

- 若排隊滿 10 秒仍找不到真人對手，或偵測到 `onlineClient.isServerBusy`（僅伺服器負載達 `red` 過載時）或 `onlineClient.isUnstable`（斷線、連線逾時或 `netQuality === 'poor'`），系統自動取消排隊並執行 `autoFallbackToCpu`。
- `autoFallbackToCpu` 會直接啟動單機 `quick3` 3 局制電腦對戰，並在 Play Call 卡片提示對應狀態（`AUTO CPU`），確保玩家不因排隊久候或網路異常中斷遊玩。

### 5. 零 `innerHTML` XSS 防護與跨裝置安全區框景

- **安全 DOM 建構**：戰績結算視窗（`showGameOverModal`）、即時觀戰列表（`renderWatchRooms`）與大廳狀態文字一律使用 `replaceChildren()`、`document.createElement()` 與 `textContent` 寫入內容，完全不使用 `innerHTML`，阻斷任何來自玩家暱稱或伺服器字串的 XSS 注入。
- **跨瀏覽器／裝置佈局**：`styles.css` 以 `100dvw`／`100dvh` 搭配 `env(safe-area-inset-*)` 適配 iOS 劉海與動態網址列，觸控裝置下為主要按鈕套用至少 `44px` 點擊高度；透過 `.game-viewport` 的 `@container (max-width: 780px)` / `(max-width: 420px)` 與橫向短螢幕規則（`max-height: 500px`），結合 `updateSafeCameraFraming()` 動態調整鏡頭垂直投影中心，確保手機直／橫向時好球帶完整落在頂部 HUD 與底部投手面板之間。

---

## 與其他模組的相依關係

- **相依於 `src/render`**：透過 `GameCamera`、`drawGymBackground`、`buildFenceDepthItems`、`drawWorldEntities` 與 `drawStrikeZoneAndOverlay` 完成背景與前景高 DPI 繪製。
- **相依於 `src/physics`、`src/rules`、`src/ai`、`src/audio`**：在單機與練習模式驅動完整投打物理、規則判定、CPU 行為與程序化音效。
- **相依於 `src/net`**：透過 `OnlineClient` 管理 WebSocket 連線、v2 封包收發、2 秒延遲監測與斷線重連會話存取。
