# fallen skywalker — Cap Baseball（瓶蓋棒球）v1.0.0

以 **2025 年 2 月版瓶蓋棒球規則**為核心打造的 16-bit 像素風格 3D 競技網頁遊戲，支援單機對戰 CPU、本機雙人、打擊／投球練習、即時線上隨機配對（含自動降級 CPU 備援）、朋友私房對戰與即時觀戰。

- **正式上線網址**：https://3epiossi.com/capbaseball
- **目前里程碑**：`v1.0.0`（對應已部署版本 `20261121-035657`）

---

## 快速開始

```bash
# 安裝依賴
npm install

# 本機開發（Vite 前端）
npm run dev

# 執行完整型別檢查與單元／整合測試（3 檔 23 項測試）
npx tsc --noEmit && npm test

# 建置正式產物（dist/ + dist-server/index.mjs）
npm run build

# 啟動本地正式伺服器（http://127.0.0.1:8788/capbaseball/）
PORT=8788 HOST=127.0.0.1 npm run server

# 部署至 Raspberry Pi（測試 + 建置 + 優雅換版 + 健康檢查）
./scripts/deploy.sh
```

---

## 模組結構與子文件導覽

| 模組 | 說明文件 | 職責摘要 |
|---|---|---|
| `src/` | [src/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/README.md) | 遊戲主迴圈、DOM/HUD 控制、彈簧投球、Play Call／ABS 流程、跨裝置排版與 XSS 防護。 |
| `src/physics/` | [src/physics/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/README.md) | 6-DOF 瓶蓋空氣動力學、4 種變化球軌跡求解、揮棒接觸與擊球彈道物理。 |
| `src/rules/` | [src/rules/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/rules/README.md) | 2025-02 瓶蓋棒球規則引擎、好球帶、出局／得分與 ABS 挑戰判定。 |
| `src/render/` | [src/render/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/README.md) | 雙層 Canvas、`GameCamera` 3D 透視投影與動態安全區框景、禮堂舞台、精靈圖與 3D 瓶蓋繪製。 |
| `src/ai/` | [src/ai/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ai/README.md) | CPU 投打 AI 與外野手追球動畫邏輯。 |
| `src/audio/` | [src/audio/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/audio/README.md) | Web Audio API 零外部音檔程序化音效。 |
| `src/net/` | [src/net/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/README.md) | 精簡 v2 WebSocket 協定與 RTT／Jitter 連線品質監測。 |
| `server/` | [server/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/README.md) | 權威對戰伺服器、配對佇列、朋友房／觀戰、綠黃紅負載保護與安全標頭。 |
| `deploy/` | [deploy/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/deploy/README.md) | Raspberry Pi `systemd` 服務與 Cloudflare Tunnel 正式網域設定。 |
| `scripts/` | [scripts/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/scripts/README.md) | 自動化測試、打包、上傳、換版與回滾腳本。 |
| `tests/` | [tests/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/README.md) | 物理、規則與多人連線整合測試套件。 |

---

## v1.0.0 開發、除錯與上線歷程實錄（給後續 AI 的交接脈絡）

以下完整記錄從開發調整到 Raspberry Pi 正式上線期間遇到的所有關鍵問題、設計決策與修正細節：

### 1. 投打操作與手感調整
- **兩階段彈簧投球發射器**：修正原本「蓄力放開直接出手」的問題，改為「按住壓縮蓄力 → 放開彈出並觀察指針最高點落在 `NORMAL · BEST · OVER` 光譜區間 → 短暫鎖定峰值後實際出手」。
- **介面精簡與按鈕整理**：移除投球 `TRAIL` 與打擊 `SWING` 等多餘按鈕；右上角固定 2 排顯示玩家狀態、網速、線上人數與功能按鈕；`MENU` 固定於最右側避免左右切換時按鈕出現／消失造成排版抖動；將返回／主選單／棄權收進 `MENU` 對話框並支援快捷鍵返回。
- **字體清晰度**：避免小像素英數字黏連，UI 與播報卡片主力字體改用 `Chakra Petch`（標題保留 `Silkscreen`）。

### 2. 判定資訊、ABS 與對局流程修正
- **Play Call 與 ABS 位置及大小**：將 `FOUL` / `TOO LATE` / `SINGLE` / `DOUBLE` 等 Play Call 卡片與 `ABS` 挑戰按鈕移至好球帶正上方，簡化 `ABS` 按鈕文字僅保留 `ABS` 與倒數條，並放大按鈕點擊區（`min-width: clamp(132px, 15vw, 176px)`, `min-height: 48px`）以免手機誤觸不到。
- **按 `MENU` 暫停遊戲**：單機模式開啟 `MENU` / 規則 / 設定對話框時，`isGamePaused()` 會暫停物理、計時器與 CPU 行為。
- **Play Call／ABS 完全消散前鎖定投球**：`isPlayCallActive()` 會等待 Play Call 卡片、ABS 挑戰按鈕及 ABS 重播完全淡出歸零後，才解鎖 `#btn-throw`、空白鍵蓄力與 CPU 自動投球。
- **同步淡出 ABS 與判定訊息**：初版 `absPromptTimer` 固定 `3.0s`，比 `STRIKE` / `BALL` 卡片（`2.2s`）晚消失。已新增 `startAbsPromptWindow()`，讓 `ABS` 與 Play Call 卡片共用相同的 TTL 與最後 `0.4s` 淡出曲線，同時消失。
- **揮空直接顯示 timing 結果**：移除原本揮棒落空時會先閃紅色 `MISS` 再跳出 `TOO LATE` 的設計，改為直接顯示 `TOO LATE` / `TOO EARLY` / `OFF TARGET`。
- **進好球帶後才揭露球種與球速**：投球蓄力與飛行途中（`windup` / `pitch_flight`），計分板遙測只顯示 `IN FLIGHT`，直到球通過本壘板或擊中後才顯示實際球種、球速與位移量。

### 3. 精靈圖修補與跨裝置／手機版重排版
- **投手精靈圖破洞修補**：檢查 `public/sprites/pitcher_strip.png` 與 `public/sprites/pitcher_black_strip.png` 發現 15 個影格的大腿／短褲處（`y=48..80`）存在封閉透明破洞，已透過邊界色向內填補共 **1,007 個像素**。
- **手機直向／橫向重排版（零重疊）**：
  - 初版手機直向截圖出現「計分板遮住右上按鈕」與「底部投手控制面板遮住好球帶下緣」問題。
  - 已在 `index.html` 與 `src/styles.css` 將計分板與右上工具列整併進同一個 `.hud-top-region` Flex 容器（桌機左右並排、手機自動垂直堆疊，徹底消除硬寫 `top` 造成重疊的風險）。
  - 在 `GameCamera` 新增動態垂直投影中心 `setTargetCenterYRatio()`，依據頂部 HUD 下緣與底部投手面板上緣自動計算安全區框景，使好球帶與本壘板居中不被面板遮擋，同時保持 `screenToPlaneZ()` 觸控瞄準座標完全一致。
  - 手機橫向短螢幕（`max-height: 500px`）將球種選擇改為左下角緊湊 2×2 網格，與計分板留出淨空。

### 4. 線上對戰、延遲容忍與觀戰設計
- **朋友房刻意對觀戰公開**：`server/index.ts` 的 `case 'list'` 只過濾尚未開打或已結束的房間，朋友房開打後亦會出現在觀戰列表（`room_list`）供觀戰（`tests/multiplayer.test.ts` 第 5 項整合測試覆蓋此行為）。
- **放寬網路延遲門檻**：初版將 `avgRttMs > 280ms` 或 `jitterMs > 120ms` 視為 `poor` 並自動退回 CPU，導致經 Cloudflare Tunnel 與行動網路連線的玩家容易被踢出線上配對。因本遊戲為回合制投打同步，已放寬為：
  - `good`：`avgRttMs <= 220ms` 且 `jitterMs <= 120ms`
  - `fair`（可正常連線對戰）：`avgRttMs <= 650ms` 且 `jitterMs <= 350ms`
  - `poor`（觸發 CPU 自動備援）：`missedPings >= 3`（單次逾時 `2500ms`）、`avgRttMs > 650ms` 或 `jitterMs > 350ms`
  - 初始配對連線逾時從 `2400ms` 放寬至 `4500ms`。

### 5. 資安強化、Pi 環境與正式網域踩雷紀錄
- **停用舊服務**：已確認 Pi 上的黑白棋服務（`reversi-royale.service`、`rr-quick.service`、`rr-tunnel.service`）維持 `inactive (dead)` 狀態。
- **應用程式與 Pi 服務安全**：
  - 前端零 `innerHTML` 拼接；後端全面回傳 `CSP`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy`。
  - `capbaseball.service` 設定 `HOST=127.0.0.1` 僅監聽本機回環埠 `8788`（透過 `ss -tulpn` 實測從 `*:8788` 收斂為 `127.0.0.1:8788`）；`~/capbaseball/data` 權限收緊為 `700` / `600`。
  - `npm audit --omit=dev` 回傳 `found 0 vulnerabilities`。
  - 作業系統層（`ufw`、`fail2ban`、`unattended-upgrades`）因需 Pi 本機 `sudo` 權限，已提供指令由擁有者於本機執行（務必先放行 `22/tcp`、`5353/udp` 與 `tailscale0`）。
- **正式網域綁定與 DNS 負快取排查**：
  - 使用 Pi 上既有 `cloudflared` 憑證建立 Named Tunnel `capbaseball`（UUID：`aa7dc803-241e-4b05-95ff-9049bacb417c`），透過 `~/.cloudflared/capbaseball.yml` 將 `3epiossi.com` 下的 `^/capbaseball(/.*)?$` 轉發至 `http://127.0.0.1:8788`，並切換為常駐 `capbaseball-tunnel.service`（停用 `capbaseball-quick`；`scripts/deploy.sh` 已同步防呆）。
  - **排錯紀錄**：上線當下 Mac 端曾持續遇到 `ERR_NAME_NOT_RESOLVED`，經查權威 DNS（`1.1.1.1` / `8.8.8.8` / 路由器 `192.168.1.1`）皆已正常解析，實因 **Tailscale MagicDNS (`100.100.100.100`) 暫存了較早的 SOA 負快取**導致 Mac `mDNSResponder` 只快取 `AAAA` 而無 `A` 紀錄；待 Tailscale DNS TTL 過期後重啟 `mDNSResponder` 即可恢復正常。
