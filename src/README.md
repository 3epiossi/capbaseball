# `src` 前端應用入口與主控模組

## 模組總覽

`src` 根目錄負責整合遊戲主迴圈、DOM 介面事件、雙層 Canvas 調度、單機／雙人／練習／線上對戰流程以及跨裝置自適應佈局。入口頁面 [index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html) 載入 [main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 與 [styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css)，在啟動時載入精靈圖集並以 `requestAnimationFrame` 驅動全螢幕遊戲舞台。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html) | 定義雙層 Canvas（`#pixel-canvas`、`#overlay-canvas`）、左上播報 HUD、右上雙列工具列、大廳選單與各式原生 `<dialog>` 視窗。 |
| [main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) | 管理遊戲階段狀態機、兩階段彈簧投球儀表、指標與鍵盤操作、線上同步、CPU 自動備援以及零 `innerHTML` 安全 DOM 更新。 |
| [styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css) | 實作 16-bit 像素播報風格樣式、彈簧壓縮／回彈動畫、安全區域（`env(safe-area-inset-*)`）與 `@container` 響應式規則。 |

---

## 核心資料流／演算法

### 1. 頂部統合播報區與 Play Call／ABS（`.hud-top-region`、`.zone-top-hud`）

- **零重疊頂部容器（`.hud-top-region`）**：將左上角計分板（`#scoreboard`）與右上角固定 2 排工具列（`.top-bar`）納入同一個 Flex 容器；寬螢幕左右並排，手機窄螢幕自動垂直堆疊，徹底避免文字換行或按鈕增減造成互遮。
- **記分板（`#scoreboard`）**：顯示客主隊分數、壘包鑽石圖（`#base-1` 至 `#base-3`）、局數／球數、出局數與 ABS 剩餘挑戰次數燈號（`#abs-1`、`#abs-2`），底部跑馬燈顯示當前打者、投手用球數與遙測資訊；投球飛行中僅顯示 `IN FLIGHT`，**通過本壘板或擊中後才揭露實際球種與球速**。
- **好球帶上方 Play Call／ABS（`.zone-top-hud`）**：將 `FOUL`、`TOO LATE`、`SINGLE`、`DOUBLE` 等統一卡片與放大版 `ABS` 按鈕置於好球帶正上方，且揮棒落空時**直接顯示 timing 結果**（不再先閃紅色 `MISS`）；`ABS` 按鈕的顯示時間與最後 `0.4s` 淡出曲線透過 `startAbsPromptWindow()` 與 Play Call 卡片完全同步，且雙方消散前會由 `isPlayCallActive()` 鎖定下一球投球。
- **字體選擇**：一般介面與播報文字採用 `Chakra Petch` 提升小尺寸辨識度，主標題保留 `Silkscreen`。

### 2. 固定雙列右上角功能條（`.top-bar`）

桌機與行動裝置採用相同的雙列對齊結構（`.top-status` 與 `.header-actions`），確保按鈕不任意換行遮擋球場：

- **第一列狀態列**：玩家暱稱晶片（`#btn-nick-chip`）、即時網速狀態膠囊（`#net-speed-pill`，依連線品質切換 `LOCAL`、`SYNC`、`<rtt>ms` 或 `BUSY`）與線上人數膠囊（`#top-online-pill`）。
- **第二列操作列**：左右打切換（`#btn-hand`）、一般／強力揮棒切換（`#btn-swing-type`）、規則、設定、音效靜音，以及固定置右的 `MENU` 按鈕（`#btn-menu`）。
- **暫停與返回導航（`isGamePaused` / `navigateBack`）**：開啟 `MENU`、規則或設定對話框時，單機對戰會立即暫停物理與計時器；支援點擊與全域 `Escape`／`Backspace` 快捷鍵返回。

### 3. 兩階段彈簧投球發射器（`springMeter`）

投球控制採用類彈珠台拉桿的物理手感，階段依序為 `idle` → `charging` → `rebounding` → `locked`：

1. **壓縮蓄力（`charging`）**：按住投球鍵、`#spring-chamber` 或空白鍵時，`springMeter.charge` 以每秒 `0.88` 的速率向內壓縮至 `1.0`（滿壓時進入高頻微幅震盪），此時指針維持在 `0%` 原點以預告蓄力張力。
2. **釋放回彈（`rebounding`）**：放開控制後計算目標頂點 `peak = clamp(0.1 + 0.9 * charge^0.95, 0.1, 1)`，並在 `0.28 + 0.24 * peak` 秒內以三次緩出曲線將指針彈射至頂點，同時透過 `buildSpringCoilPath` 繪製阻尼彈簧震盪。
3. **頂點鎖定與出手（`locked`）**：抵達頂點後停留 `0.36` 秒（`lockTimer`）顯示落點區間（`NORMAL`、`BEST` 或 `OVER`），隨後呼叫 `commitSpringPitch` 依 `evaluateSpring` 計算實際球速與控球散佈誤差並送出投球。

### 4. 伺服器忙碌與網路不穩自動切換 CPU

點擊快速配對（`#btn-hub-play`）前與連線過程中，`main.ts` 持續監聽 `onlineClient.onNetUpdate`：

- 若偵測到 `onlineClient.isServerBusy`（伺服器負載非 `green`）或 `onlineClient.isUnstable`（斷線、連線逾時或 `netQuality === 'poor'`），系統自動取消排隊並執行 `autoFallbackToCpu`。
- `autoFallbackToCpu` 會啟動單機 `quick3` 3 局制電腦對戰，並在 Play Call 卡片提示 `SERVER BUSY` 或 `UNSTABLE NET`（`AUTO CPU`），確保玩家不因排隊卡死或高延遲中斷遊玩。

### 5. 零 `innerHTML` XSS 防護與跨裝置安全區框景

- **安全 DOM 建構**：戰績結算視窗（`showGameOverModal`）、即時觀戰列表（`renderWatchRooms`）與大廳狀態文字一律使用 `replaceChildren()`、`document.createElement()` 與 `textContent` 寫入內容，完全不使用 `innerHTML`，阻斷任何來自玩家暱稱或伺服器字串的 XSS 注入。
- **跨瀏覽器／裝置佈局**：`styles.css` 以 `100dvw`／`100dvh` 搭配 `env(safe-area-inset-*)` 適配 iOS 劉海與動態網址列，觸控裝置下為主要按鈕套用至少 `44px` 點擊高度；透過 `.game-viewport` 的 `@container (max-width: 780px)` / `(max-width: 420px)` 與橫向短螢幕規則（`max-height: 500px`），結合 `updateSafeCameraFraming()` 動態調整鏡頭垂直投影中心，確保手機直／橫向時好球帶完整落在頂部 HUD 與底部投手面板之間。

---

## 與其他模組的相依關係

- **相依於 `src/render`**：透過 `GameCamera`、`drawGymBackground`、`buildFenceDepthItems`、`drawWorldEntities` 與 `drawStrikeZoneAndOverlay` 完成背景與前景高 DPI 繪製。
- **相依於 `src/physics`、`src/rules`、`src/ai`、`src/audio`**：在單機與練習模式驅動完整投打物理、規則判定、CPU 行為與程序化音效。
- **相依於 `src/net`**：透過 `OnlineClient` 管理 WebSocket 連線、v2 封包收發、2 秒延遲監測與斷線重連會話存取。
