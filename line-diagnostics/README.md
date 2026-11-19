# 車城國小 LINE 網路診斷

[開啟同仁使用的診斷頁面](https://st887105.github.io/20260425/line-diagnostics/)。使用 Windows 診斷包時，解壓縮 `checheng-line-diagnostics.zip`，在同一個資料夾設定 `settings.json` 後，雙擊 `Start-Diagnostics.cmd`。已由學校設定啟動器的電腦也可從網頁開啟完整診斷。

## 管理員部署 GAS

1. 從校方私人診斷紀錄試算表選「擴充功能 → Apps Script」，複製 [Code.gs](Code.gs)，另新增名為 Dashboard 的 HTML 檔並貼入 [Dashboard.html](Dashboard.html)。
2. 用校方 Google 帳號執行 setup 並完成授權。程式會綁定目前試算表，預設用執行帳號收信。可在指令碼屬性查看 UPLOAD_TOKEN 或調整 NOTIFY_EMAIL。
3. 建立兩個網頁應用程式部署。Windows 收件版以擁有者身分執行，須允許未登入的程式呼叫，並以 UPLOAD_TOKEN 驗證寫入。管理版設為只有自己，將管理網址填入指令碼屬性 DASHBOARD_URL。管理頁另核對 Google 帳號。
4. 在診斷包的 `settings.json` 填入 Windows 回傳網址 `uploadUrl` 和金鑰 `uploadToken`。監測時長 `durationMinutes` 設為 `30`，採樣間隔 `intervalSeconds` 設為 `10`。含金鑰的設定檔限校內使用。
5. 試跑時確認一次通報寄一封通知，試算表有開始、採樣、標記、結束，且管理頁可展開原始 ipconfig /all。實際學網與外網規則請用已知線路的 Windows 網路設定檔與 IPv4 預設閘道填入 networkRules。

新版 Windows 診斷預設監測 **30 分鐘**，約每 **10 秒**採樣一次，時間到會自動停止。啟動時填寫設備位置與異常狀況。按 **M** 標記重現並加採一筆，按 **Q** 提早結束。
