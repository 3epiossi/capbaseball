# `tests` 單元與整合測試模組

## 模組總覽

`tests` 目錄使用 Vitest 驗證物理引擎、2025-02 瓶蓋棒球規則引擎以及多人連線伺服器整合行為。全套測試共包含 3 個測試檔案、合計 52 項自動化測試（可透過 `npm test` 執行）。

---

## 子模組／檔案職責表

| 檔案 | 測試數 | 職責 |
|---|---|---|
| [physics.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/physics.test.ts) | 9 | 驗證 6-DOF 投球積分無 `NaN`、4 種球路瞄準誤差 `< 0.025` m、時鐘方向變化量、各球種飛行包絡線、外野與內野 4 人守備攔截、四元數／法向量朝向、座標系轉換與擊球反彈／過牆行為。 |
| [rules.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/rules.test.ts) | 11 | 驗證球場幾何、5.06／5.07 安打與全壘打判決、不死三振與暴投、扣倒制（Mercy Rule）、投球時鐘違規、延長賽滿壘無人出局突破僵局與禁止再見敬遠、高飛球與滾地守備、擦棒界外球與 ABS 邊緣誤判／挑戰。 |
| [multiplayer.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/multiplayer.test.ts) | 32 | 啟動真實 `startServer(0)` 測試親友房／快配對戰（含親友房先攻／後攻隨機分配）、優先權 CPU／練習候補邀約轉邀與 `LIVE`/`FRIEND` 觀戰清單、即時 `spectator_count` 觀戰人數推播、揮空真值回傳、連續 2 次投球逾時裁定敗北（實際投球重置計數）、敬遠與不揮棒、冪等序號防護、斷線重連、即時觀戰（含觀眾快捷對話與 3 秒冷卻）、ABS 挑戰同步、v2 精簡封包大小、480 公開＋20 好友房保留席、3 秒快捷對話防洗頻、雙方同時建房死鎖解鎖、線上選單暫停凍結時鐘與自動恢復、ABS 視窗防搶投、`/monitor.js` `no-store` 破快取、`/metrics` 10 桶真實頁面分布與 `standbyCount`（零 PII）與安全防護。 |

---

## 各測試檔覆蓋項目

### 1. `physics.test.ts`（5 項測試）

1. 驗證 `straight`、`cutter`、`fork`、`changeup` 四種球路皆能無 `NaN` 收斂並通過 `0.025` m 內瞄準門檻，且 `sampleAt` 內插正常。
2. 驗證四種球路的氣動位移方向（直球 12 點鐘微上飄、卡特球 4 點鐘橫竄、指叉球 6 點鐘急墜、變速球高阻力慢墜）。
3. 驗證出手瞬間 3D 瓶蓋法向量 `normalWorld` 與單位四元數 `q` 正規化精度。
4. 驗證 `simToField` 與 `fieldToSim` 雙向座標轉換一致性（投手丘偏移 `9.22` m）。
5. 驗證擊球模擬的過牆全壘打與內野滾地反彈停球。

### 2. `rules.test.ts`（9 項測試）

1. 驗證 `isFair`、`isInfield`、`isOutfield`、`isPastFenceExtension` 與 `isInStrikeZone` 幾何函式。
2. 驗證 `judgeBattedCap` 對內野出局、外野一安、彈地觸牆／越延伸線二安、直擊牆三安、過牆全壘打與飛球接殺的判決。
3. 驗證界外球兩好球上限、不死三振上壘與暴投推進壘包。
4. 驗證 6 局平手進入第 7 局 1 出局滿壘突破僵局，以及規則 5.01(D) 下半局平手滿壘禁止再見敬遠。
5. 驗證弱化外野手門檻（出速 `>= 16.5` m/s、仰角 `< 22°`、超出追球距離無法接殺，圍牆內夾緊 `12.45` m 與確定性漏接率）。
6. 驗證揮棒過早／過晚（`EARLY FOUL`／`LATE FOUL`）與 PCI 邊緣擦棒（`FOUL TIP`）。
7. 驗證 `practice_bat` 與 `practice_pitch` 練習模式中的 ABS 挑戰及新打席自動補滿挑戰次數。
8. 驗證邊緣 6.5 cm 主審 ~26% 誤判率、挑戰成功時自 `preSnapshot` 完整回溯局數／出局數且不扣次數，以及維持原判扣除 1 次次數。
9. 驗證 `quick3` 從 3 局正規賽 → 第 4 局滿壘突破僵局 → 5 球全壘打大賽 → 每輪 1 球驟死賽的完整升級流程。

### 3. `multiplayer.test.ts`（15 項測試）

1. 親友房建立、加入與完整投球→揮棒→擊球結算同步。
2. 快速配對、敬遠保送（`ibb`）與不揮棒（`no_swing`）好球判決。
3. 冪等與回合防護：忽略非當局者、過期 `pitchSeq` 與重複送出的 `pitch_submit`／`swing_input`。
4. 斷線重連：在寬限期內憑 `token` 透過 `reconnect` 取得 `state_sync` 並通知對手 `opponent_reconnected`。
5. 即時觀戰：透過 `list`、`watch` 與 `unwatch` 接收 `spectate_sync` 與即時投打廣播。
6. ABS 挑戰跨雙方玩家與觀戰者同步 `abs_result`。
7. **精簡 v2 線路協定封包大小斷言**：驗證客戶端 `ps` `< 80` bytes、`ns` `< 28` bytes，伺服器 `pl` `< 130` bytes、`pr` `< 550` bytes。
8. **綠區負載卸載閘門**：以 `getLoadOverride` 強制設為 `red` 時，驗證 `queue` 與 `create` 回傳 `server_busy`；恢復 `green` 後立即恢復建房。
9. **安全強化斷言**：驗證 `/health` 回傳 `nosniff`、`DENY` 與 `CSP` 標頭，封鎖 `/.env`（回傳 `403`／`404`），並確認 `hello` 名稱中的 `<script>`／`<img>` 等 XSS 字元已被清除。
10. 房主在好友加入前斷線，好友於寬限內加入成功，房主憑 `token` 重連取得 `state_sync` 並通知對手。
11. 房主斷線後在好友加入前重連，收到同房號與 `token` 的 `room_created`。
12. 等待中的房間在 `waitingGraceMs` 後回收，之後加入回 `room_not_found`；12b：好友在房主離線時加入，收到 `opponent_disconnected`，`graceMs` 後判勝。
13. 不回應 ping 的連線會被伺服器 `terminate()`（`deadSocketTimeoutMs`）。
14. 好友斷線後以 `token` `reconnect` 保住座位，另一個新連線 `join` 仍回 `room_full`。

---

## 與其他模組的相依關係

- **測試目標模組**：直接匯入並測試 `src/physics/*`、`src/rules/*`、`src/ai/cpu.ts`、`src/net/protocol.ts` 與 `server/index.ts`。
- **被 `scripts/deploy.sh` 呼叫**：部署腳本在建置與上傳遠端前會先執行 `npm test`，確保全部 52 項測試通過後才進行打包與換版。
