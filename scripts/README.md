# `scripts` 部署腳本模組

## 模組總覽

`scripts` 目錄包含自動化部署腳本 `deploy.sh`，負責從本機測試、建置、同步檔案到 Raspberry Pi，並透過軟連結原子切換版本與優雅重啟 `systemd` 服務，在健康檢查失敗時自動回滾。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [deploy.sh](file:///Users/chang/Documents/raspberry%20pi/capbaseball/scripts/deploy.sh) | 整合測試、打包、遠端上傳、依賴安裝、原子換版、`systemd` 重載、健康檢查與自動／手動回滾的部署腳本。 |

---

## 核心資料流／演算法

`deploy.sh` 預設目標主機為 `DEPLOY_HOST`（預設 `chang@pi.local`），支援四種執行模式：

### 1. 標準部署（`scripts/deploy.sh`）與立即重啟（`scripts/deploy.sh --now`）

1. **本機驗證與打包**：依序執行 `npm test` 與 `npm run build`，並從 `dist/version.json` 讀取本次建置序號 `BUILD`（時間戳格式 `YYYYMMDD-HHMMSS`）。
2. **檔案同步**：在遠端建立 `~/capbaseball/releases/$BUILD` 與 `~/capbaseball/data`，以 `rsync -a --delete` 上傳 `dist`、`dist-server`、`deploy`、`package.json` 與 `package-lock.json`。
3. **依賴快取與安裝**：比對前一版本 `current/package-lock.json`；若完全相同則使用 `cp -al` 硬連結複製 `node_modules` 以節省時間與空間，否則執行 `npm ci --omit=dev --no-audit --no-fund`。
4. **更新與重載 `systemd`**：將 `deploy/*.service` 複製到 `~/.config/systemd/user/`，執行 `systemctl --user daemon-reload`，啟用 `capbaseball`；若遠端已啟用 `capbaseball-tunnel` 正式通道則啟動之，否則在存在 `~/cloudflared/cloudflared` 時改為啟用 `capbaseball-quick`。
5. **原子切換 `current`**：執行 `ln -sfn "releases/$BUILD" current` 切換現行版本指標。
6. **服務重啟**：
   - 預設模式：執行 `systemctl --user restart capbaseball`，等待進行中的對局打完（最長 `DRAIN_SECONDS=300` 秒）後換版。
   - `--now` 模式：若服務運作中，發送 `SIGINT`（`systemctl --user kill -s SIGINT capbaseball`）立即結束並由 `systemd` 重啟。
7. **健康檢查與自動回滾**：每秒輪詢 `localhost:8788/health`（最多 30 秒），確認回傳 JSON 包含 `"version":"$BUILD"`。通過後寫入 `.ok` 標記並只保留最近 5 個舊版本；若逾時未通過則印出最後 30 行 `journalctl` 日誌、刪除失敗版本、將 `current` 指回前一版並重啟服務。

### 2. 手動回滾（`scripts/deploy.sh rollback`）

從 `~/capbaseball/releases` 中尋找小於當前版本且帶有 `.ok` 標記的最新版本，以 `ln -sfn` 原子切換 `current` 後重啟 `capbaseball`，並以 `curl -fsS localhost:8788/health` 驗證服務存活。

### 3. 查詢通道網址（`scripts/deploy.sh url`）

從遠端 `journalctl --user-unit capbaseball-quick` 擷取最新的 `https://*.trycloudflare.com` 網址並輸出。

---

## 與其他模組的相依關係

- **相依於根目錄建置設定**：呼叫 `package.json` 的 `test` 與 `build` 腳本，並讀取 `vite.config.ts` 產生的 `dist/version.json`。
- **相依於 `deploy/`**：將 `deploy/capbaseball.service` 與 `deploy/capbaseball-quick.service` 同步並註冊至遠端 `systemd --user`。
- **相依於 `server/index.ts`**：依賴 `/health` 端點回傳版本資訊與 `SIGINT`／`SIGTERM` 優雅停機流程。
