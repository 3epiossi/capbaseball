# `deploy` 部署服務設定模組

## 模組總覽

`deploy` 目錄存放 Raspberry Pi 上線環境所需的 `systemd` 使用者層級服務設定檔（`--user`），負責常駐啟動 Cap Baseball 遊戲伺服器以及選用的 Cloudflare Quick Tunnel 通道，並確保在反向代理子路徑下正常運作。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [capbaseball.service](file:///Users/chang/Documents/raspberry%20pi/capbaseball/deploy/capbaseball.service) | 遊戲主伺服器 `systemd` 使用者服務，執行打包後的 `dist-server/index.mjs` 並設定埠號與優雅停機時間。 |
| [capbaseball-quick.service](file:///Users/chang/Documents/raspberry%20pi/capbaseball/deploy/capbaseball-quick.service) | 選用的 Cloudflare Quick Tunnel 服務，將本機 `127.0.0.1:8788` 轉發至公開的 `trycloudflare.com` 暫時網址。 |

---

## 核心資料流／演算法

### 1. 主伺服器設定（`capbaseball.service`）

- **工作目錄與執行檔**：`WorkingDirectory=%h/capbaseball/current`，透過 `%h/node/bin/node dist-server/index.mjs` 啟動。
- **環境變數**：
  - `HOST=127.0.0.1`、`PORT=8788`：伺服器僅監聽本機回環 `127.0.0.1:8788`，不對外網直接暴露埠號（統一經 Cloudflare Tunnel 轉發）；HTTP 靜態資源、`/health` 健康檢查與 WebSocket `/ws` 共用此埠。
  - `NODE_ENV=production`
  - `MATCH_LOG=%h/capbaseball/data/matches.jsonl`：對局紀錄持久化路徑，位於版本目錄之外以避免換版時遺失（Pi 上目錄權限收緊為 `700`，紀錄檔為 `600`）。
  - `DRAIN_SECONDS=300`：收到重啟／停止訊號時等待進行中對局結束的最長寬限秒數（對應 `TimeoutStopSec=330`）。
- **重啟策略**：`Restart=always`、`RestartSec=2`，搭配 `StartLimitIntervalSec=0` 避免頻繁重啟觸發啟動限制。

### 2. Cloudflare Tunnel（`capbaseball-tunnel` 正式網域與 `capbaseball-quick` 備援）

- **正式網域服務（Pi 本機 `~/.config/systemd/user/capbaseball-tunnel.service`）**：使用已授權 `3epiossi.com` 的 Named Tunnel `capbaseball`（UUID：`aa7dc803-241e-4b05-95ff-9049bacb417c`），透過 `~/.cloudflared/capbaseball.yml` 將 `https://3epiossi.com/capbaseball*` 轉發至 `http://127.0.0.1:8788`；原本的 `capbaseball-quick.service` 與舊黑白棋服務（`reversi-royale`、`rr-quick`、`rr-tunnel`）皆已停用。
- **Quick Tunnel 備援（`capbaseball-quick.service`）**：未設定 Named Tunnel 的機器可改用 `%h/cloudflared/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8788` 取得臨時測試網址。

### 3. 子路徑 `https://3epiossi.com/capbaseball` 支援架構

系統預設支援從網站根目錄 `/` 或子路徑 `/capbaseball` 提供服務：

- **前端建置（[vite.config.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/vite.config.ts)）**：設定 `base: './'`，讓編譯後的 HTML 與 JS/CSS 使用相對路徑載入資源與 WebSocket。
- **後端路由正規化（[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts)）**：
  - 當請求路徑為 `/capbaseball`（無結尾斜線）時，自動 302 導向 `/capbaseball/`，確保瀏覽器將相對路徑 `./assets` 與 `./sprites` 解析到正確子目錄。
  - 請求進入後會剝除 `/capbaseball` 前綴再對應靜態檔案與路由，因此反向代理無論保留或剝除 `/capbaseball` 前綴皆可正常運作。

---

## 與其他模組的相依關係

- **被 `scripts/deploy.sh` 佈署**：`deploy.sh` 會將 `deploy/*.service` 複製到遠端機器的 `~/.config/systemd/user/` 並執行 `systemctl --user daemon-reload`。
- **執行 `server/index.ts` 建置產物**：依賴 `npm run build` 產生的 `dist-server/index.mjs` 與前端靜態檔 `dist/`。
