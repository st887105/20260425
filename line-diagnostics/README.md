# 車城國小 LINE 網路診斷

[開啟同仁使用的診斷頁面](https://st887105.github.io/20260425/line-diagnostics/)。第一次使用時下載並解壓縮 Windows 啟動器，雙擊 Install-Launcher.cmd。之後在網頁按「開啟 CMD 並執行」，Windows 會顯示 ipconfig /all。

## 管理員部署 GAS

1. 從校方私人診斷紀錄試算表選「擴充功能 → Apps Script」，複製 [Code.gs](Code.gs)，另新增名為 Dashboard 的 HTML 檔並貼入 [Dashboard.html](Dashboard.html)。
2. 用校方 Google 帳號執行 setup 並完成授權。程式會綁定目前試算表，預設用執行帳號收信。可在指令碼屬性查看 UPLOAD_TOKEN 或調整 NOTIFY_EMAIL。
3. 建立兩個網頁應用程式部署。Windows 收件版以擁有者身分執行，須允許未登入的程式呼叫，並以 UPLOAD_TOKEN 驗證寫入。管理版設為只有自己，將管理網址填入指令碼屬性 DASHBOARD_URL。管理頁另核對 Google 帳號。
4. 解壓縮啟動器，將 settings.example.json 另存為 settings.json，填入收件版網址和金鑰。只在校內分發真實設定，公開版保持空白。設定完成後在各 Windows 使用者帳戶執行 Install-Launcher.cmd。
5. 試跑時確認一次通報寄一封通知，試算表有開始、採樣、標記、結束，且管理頁可展開原始 ipconfig /all。實際學網與外網規則請用已知線路的 Windows 網路設定檔與 IPv4 預設閘道填入 networkRules。

一般下載版可本機執行 ipconfig /all。配置校內同步的電腦可在 CMD 輸入異常狀況，按 M 標記重現，按 Q 提早結束。預設監測 10 分鐘後自動停止。
