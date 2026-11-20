# =====================================================================
#  車城國小｜LINE 網路小幫手 — 安裝／移除程式（需系統管理員）
#  由 install.bat / uninstall.bat 呼叫，資訊老師每台電腦執行一次即可
# =====================================================================
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$Root      = 'C:\ProgramData\CheChengLineHelper'
$Src       = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskMain  = 'CheChengLineHelper'
$TaskGuard = 'CheChengLineHelperGuard'
$Proto     = 'checheng-line-dns'
$SiteOrigin = 'https://st887105.github.io'
$PS = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

# ---------------- 移除 ----------------
if ($Uninstall) {
  Say '== 移除 LINE 網路小幫手 ==' 'Cyan'
  if (Test-Path "$Root\LineHelper.ps1") {
    Say '先把 DNS 還原為原本設定…'
    & $PS -NoProfile -ExecutionPolicy Bypass -File "$Root\LineHelper.ps1" -Mode restore
  }
  foreach ($t in @($TaskMain, $TaskGuard)) { & schtasks.exe /delete /tn $t /f 2>&1 | Out-Null }
  Remove-Item "HKLM:\SOFTWARE\Classes\$Proto" -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
  Say '移除完成（瀏覽器的自動開啟原則若有設定，請到登錄檔 Policies 自行刪除）。' 'Green'
  return
}

# ---------------- 安裝 ----------------
Say '== 安裝 車城國小｜LINE 網路小幫手 ==' 'Cyan'

# 1. 複製檔案並鎖定權限（避免一般使用者改寫以 SYSTEM 執行的程式）
New-Item -ItemType Directory -Path $Root, "$Root\queue", "$Root\status", "$Root\logs" -Force | Out-Null
Copy-Item "$Src\LineHelper.ps1", "$Src\Launcher.ps1" -Destination $Root -Force
# SID：S-1-5-18 SYSTEM、S-1-5-32-544 Administrators、S-1-5-32-545 Users（中文版 Windows 也通用）
& icacls.exe $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' /T /Q | Out-Null
& icacls.exe "$Root\queue" /grant '*S-1-5-32-545:(OI)(CI)M' /Q | Out-Null
Say '[1/4] 程式已複製到 C:\ProgramData\CheChengLineHelper（已鎖定權限）' 'Green'

# 2. 建立排程工作（以 SYSTEM 執行）
function New-TaskXml([string]$triggers, [string]$arguments, [string]$limit) {
@"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>車城國小 LINE 網路小幫手</Description></RegistrationInfo>
  <Triggers>$triggers</Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>$limit</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>$PS</Command><Arguments>$arguments</Arguments></Exec>
  </Actions>
</Task>
"@
}
$argBase = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File &quot;$Root\LineHelper.ps1&quot;"
$guardTriggers = @'
<BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger>
<EventTrigger><Enabled>true</Enabled><Delay>PT20S</Delay>
<Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"&gt;&lt;Select Path="Microsoft-Windows-NetworkProfile/Operational"&gt;*[System[(EventID=10000)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
</EventTrigger>
'@
$tmp = Join-Path $env:TEMP 'chcs-line-task.xml'
New-TaskXml '' "$argBase -Mode queue" 'PT45M' | Set-Content -Path $tmp -Encoding Unicode
& schtasks.exe /create /tn $TaskMain /xml $tmp /f | Out-Null
New-TaskXml $guardTriggers "$argBase -Mode guard" 'PT5M' | Set-Content -Path $tmp -Encoding Unicode
& schtasks.exe /create /tn $TaskGuard /xml $tmp /f | Out-Null
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# 讓一般使用者（Authenticated Users）可以「執行」主排程，但不能修改
$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$task = $svc.GetFolder('\').GetTask($TaskMain)
$sd = $task.GetSecurityDescriptor(4)   # 只取 DACL
if ($sd -notmatch '\(A;;GRGX;;;AU\)') { $task.SetSecurityDescriptor($sd + '(A;;GRGX;;;AU)', 0) }
Say '[2/4] 排程工作已建立（主工作 + 校外自動還原）' 'Green'

# 3. 註冊網頁按鈕協定 checheng-line-dns://
$key = "HKLM:\SOFTWARE\Classes\$Proto"
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $key -Name '(default)' -Value 'URL:CheCheng LINE Helper'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
Set-ItemProperty -Path "$key\shell\open\command" -Name '(default)' `
  -Value "`"$PS`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Root\Launcher.ps1`" `"%1`""
Say "[3/4] 已註冊 ${Proto}:// 協定" 'Green'

# 4. （選用）讓 Chrome / Edge 從學校網站開啟時不再每次詢問
$policyValue = '[{"protocol":"checheng-line-dns","allowed_origins":["' + $SiteOrigin + '"]},{"protocol":"checheng-line-diag","allowed_origins":["' + $SiteOrigin + '"]}]'
foreach ($p in @('HKLM:\SOFTWARE\Policies\Google\Chrome', 'HKLM:\SOFTWARE\Policies\Microsoft\Edge')) {
  if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
  $cur = (Get-ItemProperty -Path $p -Name 'AutoLaunchProtocolsFromOrigins' -ErrorAction SilentlyContinue).AutoLaunchProtocolsFromOrigins
  if ([string]::IsNullOrWhiteSpace($cur)) {
    Set-ItemProperty -Path $p -Name 'AutoLaunchProtocolsFromOrigins' -Value $policyValue
  } elseif ($cur -notmatch 'checheng-line-dns') {
    Say "  ! $p 已有其他自動開啟原則，未覆蓋，請手動合併。" 'Yellow'
  }
}
Say '[4/4] 已設定 Chrome/Edge 自動開啟原則（重開瀏覽器後生效）' 'Green'

Say ''
Say '安裝完成！老師現在可以在網頁按「一鍵修復」，不需要輸入管理員密碼。' 'Cyan'
Say '紀錄檔：C:\ProgramData\CheChengLineHelper\logs\helper.log'
