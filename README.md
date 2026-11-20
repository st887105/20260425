# 車城國小｜LINE 網路小幫手 v3.0.0 部署說明

一鍵把 DNS 切換到學網備援 DNS，讓 LINE 傳檔走 IPv4，並把封包監測數值寫進試算表、異常時通知管理者。

- IPv4 DNS：`163.24.239.2`
- IPv6 DNS：`2001:288:8600:1::1002`
- 測試目標：`obs.line-apps.com`（LINE 傳圖／傳檔伺服器）

## 檔案結構

```
line-helper/
├─ windows/              ← 複製到隨身碟，每台電腦裝一次
│  ├─ install.bat        資訊老師執行一次（會要求管理員權限）
│  ├─ uninstall.bat      移除（會先還原 DNS）
│  ├─ admin-oneclick.bat 備案：沒裝小幫手、但有管理員密碼時直接用
│  ├─ install.ps1        安裝程式本體
│  ├─ LineHelper.ps1     以 SYSTEM 執行：改 DNS、量測、上傳、校外自動還原
│  └─ Launcher.ps1       網頁按鈕 → 觸發 SYSTEM 工作 → 跳出結果視窗
├─ gas/Code.gs           新的 GAS 後端（不需要改原本網路監控的 Code.gs）
└─ web/index.html        合併後的網站（老師端＋管理端儀表板）
```

## 運作方式

```
老師按「一鍵修復」(網頁)
  └→ checheng-line-dns://fix → Launcher.ps1（一般使用者身分）
        └→ 寫入請求檔 → schtasks /run CheChengLineHelper
              └→ LineHelper.ps1（SYSTEM 身分，不用輸入密碼）
                   ├ 先確認學網 DNS 連得到（校外就不改）
                   ├ 修改前量一次 → 改 DNS → 修改後量一次
                   ├ 結果寫進 status\last.json → Launcher 跳出結果視窗
                   └ 背景監測 30 分鐘／每 10 秒，每 1 分鐘上傳一批
                        └→ GAS → 試算表「LINE監測紀錄」「LINE電腦狀態」
                                 └→ 異常 → LINE Messaging API／Gmail 通知管理者
開機或切換網路時 → CheChengLineHelperGuard
  └→ 連不到學網 DNS（帶筆電回家）就暫時還原，回校後自動重新套用
```

每次採樣記錄的數值：A／AAAA 筆數、DNS 解析時間、obs 的 IPv4／IPv6、TCP 443 連線時間（v4／v6）、閘道 ping 與掉包率、目前的 DNS 伺服器，以及這台電腦有沒有 IPv6 位址。

## 部署步驟

### 1. GAS 後端（約 10 分鐘）
1. 建立試算表「車城國小｜LINE 網路小幫手」，再到「擴充功能 → Apps Script」貼上 `gas/Code.gs`。
2. 依序執行 `setupDatabase()` 和 `setupConfig()`。
3. 到「專案設定 → 指令碼屬性」填入下列值：
   - `UPLOAD_TOKEN`：自己訂一組密語，第 4 步會用到。
   - `LINE_TOKEN`：LINE 官方帳號 Messaging API 的 Channel access token。
   - `LINE_TO`：管理者的 userId，U 開頭；多位用逗號分隔。
   - `ADMIN_EMAIL`：Email 備援。LINE 沒設定或推播失敗時，會改寄這裡。
4. 執行 `testNotify()` 確認收得到通知，再執行 `testUpload()` 確認試算表有寫入資料。
5. 到「部署 → 新增部署作業 → 網頁應用程式」：執行身分選「我」，存取權選「所有人」，然後複製網址。

### 2. Windows 小幫手
1. 用記事本打開 `windows/LineHelper.ps1`，修改最上方設定區的兩個值，存檔時保持 UTF-8 編碼：
   - `GasUrl`：第 1 步複製的網址。
   - `UploadToken`：要和 GAS 的 `UPLOAD_TOKEN` 一樣。
2. 把 `windows` 資料夾複製到隨身碟，在每台電腦對 `install.bat` 按兩下，按「是」允許管理員權限。
3. 安裝會順便設定 Chrome／Edge 原則，之後從 st887105.github.io 開啟時不會再每次詢問。瀏覽器要重開才會生效。

### 3. 網站
1. 打開 `web/index.html`，把 `LINE_GAS_URL` 改成第 1 步的網址。
2. 上傳到 GitHub Pages 的 `20260425/line-diagnostics/index.html`，取代原本的頁面。
3. 網址說明：
   - 老師用：`https://st887105.github.io/20260425/line-diagnostics/`
   - 管理者：`https://st887105.github.io/20260425/line-diagnostics/#admin`
4. 原本的 `20260425/index.html`（v2.6）可以保留，不受影響。

## 測試建議（回報給縣網中心）
1. 找一台平常傳檔會卡的電腦，先按「只監測、不改設定」，留下修改前的資料。
2. 再按「一鍵修復」，記下結果視窗的內容：如果出現「只回應 IPv4」，就代表備援 DNS 有過濾 AAAA。
3. 實際用 LINE 傳圖、傳檔，再到儀表板比對修改前後的 AAAA 筆數和 TCP 443 v6 的數值。

## 注意事項
- 改 DNS 一定要有管理員權限，這是 Windows 的限制。網頁本身改不了，所以每台電腦都要由資訊老師先裝一次小幫手。
- 如果學校用 GPO 強制 PowerShell 執行原則為 AllSigned，就要先替 .ps1 檔簽章，或請網管調整原則。
- `checheng-line-dns://` 只接受 fix、restore、monitor 三個固定指令，DNS 位址是寫死在程式裡的，網頁無法指定別的 DNS。
- LINE 官方帳號免費方案每月有訊息則數上限，而且群發時每位收件人都會各算一則。電腦數量多時，可以把 `NOTIFY_FIX` 改成 `false`，只保留異常通知。
- 試算表資料量變大時，可以替 `cleanupOldLogs()` 設定每週觸發，會刪除 60 天前的紀錄。
- 縣網中心如果決定全縣套用，DNS 會在中心端統一處理。到時候可以按「還原」或執行 `uninstall.bat`，把各台電腦的設定恢復成自動取得。

車城國小資訊老師徐吉德整理製作@2026
