# Cap Baseball（fallen skywalker）系統架構總覽

## 模組總覽

Cap Baseball（`fallen skywalker`）是一款採用 2025 年 2 月版台灣瓶蓋棒球正式規則的 3D 像素風多人對戰網頁遊戲。系統以純 TypeScript 實作 6-DOF 瓶蓋氣動力物理引擎與規則狀態機，並由前端雙層 Canvas 渲染與後端 Node.js 權威伺服器共用同一套物理與規則核心。

---

## 全模組文件索引

| 模組 | 職責摘要 | 文件連結 |
|---|---|---|
| `src` | 前端主程式協調、HUD 與彈簧投球 UI、跨裝置佈局與自動切換 CPU | [src/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/README.md) |
| `src/physics` | 6-DOF 剛體投球積分、Chord-Newton 瞄準求解、擊球彈道與接殺評估 | [src/physics/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/README.md) |
| `src/rules` | 2025-02 球場幾何、投打判決、主審邊緣誤判、ABS 挑戰與突破僵局／全壘打大賽 | [src/rules/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/rules/README.md) |
| `src/render` | 跨裝置 FOV 攝影機、禮堂離屏快取、3D 瓶蓋繪製、深度排序與鷹眼重播 | [src/render/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/README.md) |
| `src/ai` | CPU 投打決策、捕手接捕判定與弱化外野手追球狀態更新 | [src/ai/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ai/README.md) |
| `src/audio` | Web Audio API 零外部音檔程序化音效合成器 | [src/audio/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/audio/README.md) |
| `src/net` | 精簡 v2 線路協定編解碼、子路徑 WS 偵測、2 秒 RTT 探測與連線品質評估 | [src/net/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/README.md) |
| `server` | 權威對戰伺服器、靜態資源雙路徑服務、綠區負載卸載、安全標頭與優雅停機 | [server/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/README.md) |
| `deploy` | Raspberry Pi `systemd --user` 常駐服務與 Cloudflare Quick Tunnel 設定 | [deploy/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/deploy/README.md) |
| `scripts` | 測試、打包、硬連結快取、原子換版與健康檢查自動回滾部署腳本 | [scripts/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/scripts/README.md) |
| `tests` | 23 項 Vitest 單元與整合測試（物理、規則、精簡協定、負載卸載與安全防護） | [tests/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/README.md) |

---

## 端對端系統架構

```mermaid
flowchart LR
    Browser["瀏覽器客戶端 (index.html / main.ts)"] -->|HTTP GET / 或 /capbaseball/| HttpSrv["Node.js HTTP 伺服器"]
    Browser -->|WebSocket v2 (/ws 或 /capbaseball/ws)| WsSrv["WebSocketServer (16KB / 無 deflate)"]
    subgraph ClientModules ["前端模組 (src/)"]
        Main["main.ts + styles.css"]
        Render["render/ (雙層 Canvas)"]
        Net["net/ (protocol.ts + client.ts)"]
        Audio["audio/sfx.ts"]
        AI["ai/cpu.ts"]
    end
    subgraph SharedCore ["前後端共用核心"]
        Physics["physics/ (6-DOF + Batted)"]
        Rules["rules/ (2025-02 規則 + ABS)"]
    end
    subgraph ServerNode ["權威後端 (server/index.ts)"]
        HttpSrv
        WsSrv
        Gate["綠區負載閘門 (ELD / RSS / Room / Client)"]
        Rooms["房間與配對狀態機"]
    end
    Main --> Render
    Main --> Net
    Main --> Audio
    Main --> AI
    Main --> SharedCore
    Rooms --> SharedCore
    WsSrv --> Gate --> Rooms
```

---

## 核心機制與資料流

### 1. 精簡 v2 線路協定（`protocol.ts`）

前後端在連線交握（`{ t: 'hi', v: 2 }`）後切換至精簡 v2 格式，相較原始 JSON 減少約 75% 至 80% 的封包體積：

- **短標籤與枚舉編碼**：使用 `"p"`、`"po"`、`"ps"`、`"sw"`、`"ns"`、`"pl"`、`"pr"`、`"ms"`、`"ss"`、`"sp"`、`"ab"` 等短鍵名，並將球種與負載狀態轉為整數索引。
- **`packMatch` / `unpackMatch`**：將壘包狀態壓縮為 3-bit 位元遮罩（`0..7`），統計與局數改為緊湊元組，打序陣列於客戶端本地重建。
- **三位小數捨入**：透過 `round2` 與 `round3` 消除 17 位 IEEE-754 浮點序列化冗餘。

### 2. 綠區負載卸載與網路不穩自動切換 CPU

系統同時從伺服器端與客戶端防護多人對戰體驗，避免高延遲或過載影響遊玩：

1. **伺服器綠區閘門（`getServerLoad`）**：伺服器使用 `monitorEventLoopDelay` 量測事件迴圈延遲（p95），並監控 RSS 記憶體、房間數與連線數，分級為 `green`、`yellow` 與 `red`。當狀態非 `green` 時，拒絕新的 `queue` 與 `create` 請求並回傳 `server_busy`。
2. **客戶端雙重偵測與自動切換（`OnlineClient` + `main.ts`）**：前端每 2 秒發送一次 RTT 探測並維護 5 筆滑動視窗，依平均 RTT 與抖動（jitter）計算 `NetQuality`（`good`、`fair`、`poor`、`offline`）。一旦 `isServerBusy`（`serverLoad !== 'green'`）或 `isUnstable`（未連線或 `netQuality === 'poor'`）觸發，主程式立即呼叫 `autoFallbackToCpu`，將排隊玩家無感轉入單機 CPU 快速 3 局對戰。

### 3. 安全性摘要

- **HTTP 安全標頭與存取限制**：`server/index.ts` 全域套用嚴格 `Content-Security-Policy`（`default-src 'self'`、`frame-ancestors 'none'`）、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer` 與 `Permissions-Policy`，並封鎖所有以 `.` 開頭的隱藏檔（如 `/.env`）與路徑穿越請求。
- **WebSocket 防護**：限制 `maxPayload: 16 * 1024`（16 KB）、關閉 `perMessageDeflate` 避免壓縮膨脹攻擊與 CPU 耗損，並實作單一 IP 連線上限（預設 12）與每秒滑動視窗頻率限制（預設 30 訊息／秒）。
- **零 `innerHTML` 與名稱淨化**：前後端一律以 `sanitizeName` 過濾控制字元與 HTML 特殊符號（`<>'"`&`），前端 UI 全面改用 `textContent` 與 `document.createElement` 建構 DOM，杜絕 XSS 風險。
