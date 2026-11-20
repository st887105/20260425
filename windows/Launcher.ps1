# =====================================================================
#  車城國小｜LINE 網路小幫手 — 使用者端啟動器
#  由網頁按鈕 checheng-line-dns://fix|restore|monitor 呼叫（一般使用者身分）
#  只負責：驗證網址 → 寫入請求 → 觸發 SYSTEM 排程工作 → 顯示結果
# =====================================================================
param([string]$Url = '')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root      = 'C:\ProgramData\CheChengLineHelper'
$TaskName  = 'CheChengLineHelper'
$Title     = '車城國小｜LINE 網路小幫手'

function Show-Box([string]$msg, [string]$icon = 'Information') {
  [System.Windows.Forms.MessageBox]::Show($msg, $Title, 'OK', $icon) | Out-Null
}

$m = [regex]::Match($Url.Trim(), '^checheng-line-dns://(fix|restore|monitor)/?$', 'IgnoreCase')
if (-not $m.Success) { Show-Box '無法辨識的指令，請從學校的 LINE 網路小幫手網頁按按鈕。' 'Warning'; exit 1 }
$mode = $m.Groups[1].Value.ToLower()
$id   = [guid]::NewGuid().ToString('N').Substring(0, 12)

$label = @{ fix = '一鍵修復（切換學網備援 DNS）'; restore = '還原 DNS 設定'; monitor = '只監測網路' }[$mode]

# 背景小通知：處理中
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Information
$tray.Visible = $true
$tray.ShowBalloonTip(5000, $Title, "正在執行：$label，約需 10–20 秒…", 'Info')

try {
  Set-Content -Path (Join-Path $Root "queue\$id.req") -Value "$mode|$id" -Encoding ASCII -ErrorAction Stop
} catch {
  $tray.Dispose()
  Show-Box "這台電腦還沒有安裝 LINE 網路小幫手，請聯絡資訊老師。`n`n（找不到 $Root）" 'Warning'; exit 1
}

& schtasks.exe /run /tn $TaskName 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  $tray.Dispose()
  Show-Box '無法啟動小幫手排程工作，請聯絡資訊老師重新安裝。' 'Warning'; exit 1
}

# 等待 SYSTEM 端回報結果（最多 90 秒）
$statusFile = Join-Path $Root 'status\last.json'
$result = $null
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $statusFile) {
    try {
      $s = Get-Content $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($s.id -eq $id) { $result = $s; break }
    } catch {}
  }
}
$tray.Dispose()

if ($null -eq $result) {
  Show-Box '小幫手沒有在 90 秒內回應。可能電腦忙碌中，請稍後再按一次；若持續發生請聯絡資訊老師。' 'Warning'
} elseif ($result.ok) {
  Show-Box ([string]$result.message) 'Information'
} else {
  Show-Box ([string]$result.message) 'Warning'
}
