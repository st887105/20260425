# =====================================================================
#  車城國小｜LINE 網路小幫手 — 系統端工作程式
#  以 SYSTEM 身分由排程工作執行（一般使用者在網頁按鈕即可觸發）
#  模式：queue（讀取網頁送來的請求）／guard（校外自動還原）／fix／restore／monitor
#  車城國小資訊老師徐吉德整理製作@2026
# =====================================================================
param([ValidateSet('queue','guard','fix','restore','monitor')][string]$Mode = 'queue')

# ======================= 設定區（只需改這裡） =======================
$Config = @{
  Version        = 'v3.0.0'
  DnsV4          = '163.24.239.2'                 # 學網備援 IPv4 DNS
  DnsV6          = '2001:288:8600:1::1002'        # 學網備援 IPv6 DNS
  TestHost       = 'obs.line-apps.com'            # LINE 傳檔/傳圖伺服器
  GasUrl         = 'https://script.google.com/macros/s/請貼上新部署的網址/exec'
  UploadToken    = 'chcs-line-請改成自己的密語'     # 必須和 GAS 指令碼屬性 UPLOAD_TOKEN 相同
  MonitorMinutes = 30                             # 監測總長（分鐘）
  IntervalSec    = 10                             # 採樣間隔（秒）
  BatchSize      = 6                              # 累積幾筆上傳一次（6 筆 ≈ 1 分鐘）
}
# ====================================================================

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root      = 'C:\ProgramData\CheChengLineHelper'
$QueueDir  = Join-Path $Root 'queue'
$StatusDir = Join-Path $Root 'status'
$LogDir    = Join-Path $Root 'logs'
$StateFile = Join-Path $Root 'state.json'
$Pending   = Join-Path $Root 'pending.json'
foreach ($d in @($Root, $QueueDir, $StatusDir, $LogDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

function Write-Log([string]$msg) {
  $line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  [' + $Mode + ']  ' + $msg
  try {
    $f = Join-Path $LogDir 'helper.log'
    if ((Test-Path $f) -and (Get-Item $f).Length -gt 2MB) { Move-Item $f ($f + '.old') -Force }
    Add-Content -Path $f -Value $line -Encoding UTF8
  } catch {}
  Write-Host $line
}

# ---------- 狀態檔 ----------
function Get-State {
  if (Test-Path $StateFile) {
    try { return (Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json) } catch {}
  }
  return [pscustomobject]@{ intent = 'auto'; applied = $false; previous = @() }
}
function Save-State($state) {
  $state | ConvertTo-Json -Depth 5 | Set-Content -Path $StateFile -Encoding UTF8
}
function Write-Status([string]$id, [bool]$ok, [string]$msg) {
  [pscustomobject]@{ id = $id; ok = $ok; message = $msg; time = (Get-Date).ToString('o') } |
    ConvertTo-Json | Set-Content -Path (Join-Path $StatusDir 'last.json') -Encoding UTF8
  Write-Log ('狀態：' + $msg)
}

# ---------- 網卡 ----------
function Get-TargetAdapters {
  $gwIdx = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object { $_.ifIndex })
  @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -eq 'Up' -and $gwIdx -contains $_.ifIndex })
}
function Split-Servers([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return @() }
  @($s -split '[,\s]+' | Where-Object { $_ })
}
function Get-StaticDns($adapter) {
  $g = $adapter.InterfaceGuid
  $v4 = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$g"  -Name NameServer -ErrorAction SilentlyContinue).NameServer
  $v6 = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces\$g" -Name NameServer -ErrorAction SilentlyContinue).NameServer
  [pscustomobject]@{ guid = [string]$g; name = $adapter.Name; v4 = [string]$v4; v6 = [string]$v6 }
}
function Get-CurrentDnsText {
  $list = @()
  foreach ($a in Get-TargetAdapters) {
    $list += @(Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue |
      ForEach-Object { $_.ServerAddresses }) | Where-Object { $_ -and $_ -notlike 'fec0:*' }
  }
  (@($list | Select-Object -Unique) -join ', ')
}
function Test-SchoolDns {
  try {
    $r = Resolve-DnsName -Name $Config.TestHost -Type A -Server $Config.DnsV4 -DnsOnly -QuickTimeout -ErrorAction Stop
    return [bool]($r | Where-Object { $_.Type -eq 'A' })
  } catch { return $false }
}

function Set-FixedDns([bool]$savePrevious) {
  $state = Get-State
  $prev = @()
  $done = @()
  foreach ($a in Get-TargetAdapters) {
    $p = Get-StaticDns $a
    $already = (Split-Servers $p.v4) -contains $Config.DnsV4
    if (-not $already) { $prev += $p }
    Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses @($Config.DnsV4, $Config.DnsV6) -ErrorAction Stop
    $done += $a.Name
  }
  Clear-DnsClientCache -ErrorAction SilentlyContinue
  if ($savePrevious -and $prev.Count -gt 0) { $state.previous = $prev }
  $state.intent = 'fixed'; $state.applied = $true
  Save-State $state
  Write-Log ('已套用學網備援 DNS：' + ($done -join ', '))
  return $done
}

function Restore-Dns([bool]$clearIntent) {
  $state = Get-State
  $byGuid = @{}
  foreach ($p in @($state.previous)) { if ($p.guid) { $byGuid[$p.guid] = $p } }
  foreach ($a in Get-TargetAdapters) {
    $p = $byGuid[[string]$a.InterfaceGuid]
    $servers = @()
    if ($p) { $servers = @(Split-Servers $p.v4) + @(Split-Servers $p.v6) }
    if ($servers.Count -gt 0) {
      Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses $servers -ErrorAction SilentlyContinue
      Write-Log ('還原原本手動 DNS：' + $a.Name + ' → ' + ($servers -join ', '))
    } else {
      Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses -ErrorAction SilentlyContinue
      Write-Log ('還原為自動取得 DNS：' + $a.Name)
    }
  }
  Clear-DnsClientCache -ErrorAction SilentlyContinue
  $state.applied = $false
  if ($clearIntent) { $state.intent = 'auto'; $state.previous = @() }
  Save-State $state
}

# ---------- 量測 ----------
function Measure-Tcp([string]$ip, [int]$port = 443, [int]$timeout = 3000) {
  if (-not $ip) { return $null }
  $c = $null
  try {
    $addr = [System.Net.IPAddress]::Parse($ip)
    $c = New-Object System.Net.Sockets.TcpClient($addr.AddressFamily)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $ar = $c.BeginConnect($addr, $port, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne($timeout)) { return $null }
    $c.EndConnect($ar); $sw.Stop()
    return [int]$sw.ElapsedMilliseconds
  } catch { return $null } finally { if ($c) { $c.Close() } }
}
function Measure-Ping([string]$target, [int]$count = 4) {
  if (-not $target) { return @{ avg = $null; loss = $null } }
  $p = New-Object System.Net.NetworkInformation.Ping
  $ok = 0; $sum = 0
  for ($i = 0; $i -lt $count; $i++) {
    try { $r = $p.Send($target, 1000); if ($r.Status -eq 'Success') { $ok++; $sum += $r.RoundtripTime } } catch {}
  }
  $avg = $null; if ($ok -gt 0) { $avg = [int]($sum / $ok) }
  @{ avg = $avg; loss = [int](100 * ($count - $ok) / $count) }
}
function Resolve-Records([string]$type) {
  try {
    @(Resolve-DnsName -Name $Config.TestHost -Type $type -DnsOnly -QuickTimeout -ErrorAction Stop |
      Where-Object { $_.Type -eq $type } | ForEach-Object { $_.IPAddress })
  } catch { @() }
}
function Get-HostInfo {
  $a = Get-TargetAdapters | Select-Object -First 1
  $ip = ''; $mac = ''
  if ($a) {
    $mac = $a.MacAddress
    $ip = (Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
  }
  @{ hostname = $env:COMPUTERNAME; ip = [string]$ip; mac = [string]$mac }
}
function Get-Sample([string]$phase) {
  $state = Get-State
  Clear-DnsClientCache -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $a4 = Resolve-Records 'A'
  $sw.Stop(); $dnsMs = [int]$sw.ElapsedMilliseconds
  $a6 = Resolve-Records 'AAAA'
  $v4ip = ($a4 | Select-Object -First 1); $v6ip = ($a6 | Select-Object -First 1)
  $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
  $ping = Measure-Ping $gw 4
  $v6g = [bool](Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue |
           Where-Object { $_.PrefixOrigin -in @('RouterAdvertisement','Dhcp','Manual') -and $_.IPAddress -notlike 'fe80*' -and $_.AddressState -eq 'Preferred' })
  $dnsMode = 'auto'; if ($state.applied) { $dnsMode = 'fixed' }
  [ordered]@{
    ts          = (Get-Date).ToString('o')
    phase       = $phase
    dns_mode    = $dnsMode
    dns_servers = Get-CurrentDnsText
    a_count     = $a4.Count
    aaaa_count  = $a6.Count
    dns_ms      = $(if ($a4.Count -gt 0) { $dnsMs } else { $null })
    v4_ip       = [string]$v4ip
    v6_ip       = [string]$v6ip
    tcp_v4_ms   = Measure-Tcp $v4ip
    tcp_v6_ms   = $(if ($v6ip) { Measure-Tcp $v6ip } else { $null })
    gw_ping_ms  = $ping.avg
    gw_loss_pct = $ping.loss
    v6_global   = $v6g
  }
}

# ---------- 上傳 ----------
function Send-Samples([string]$session, [string]$mode, $samples) {
  $all = @()
  if (Test-Path $Pending) {
    try { foreach ($x in (Get-Content $Pending -Raw -Encoding UTF8 | ConvertFrom-Json)) { $all += $x } } catch {}
  }
  $all += @($samples)
  if ($all.Count -eq 0) { return $true }
  if ($all.Count -gt 500) { $all = $all[($all.Count - 500)..($all.Count - 1)] }
  $info = Get-HostInfo
  $body = [ordered]@{
    action = 'upload'; token = $Config.UploadToken; version = $Config.Version
    hostname = $info.hostname; ip = $info.ip; mac = $info.mac
    session = $session; mode = $mode; samples = @($all)
  } | ConvertTo-Json -Depth 6 -Compress
  try {
    $r = Invoke-RestMethod -Uri $Config.GasUrl -Method Post -ContentType 'text/plain; charset=utf-8' `
           -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 25 -UseBasicParsing
    if ($r.status -eq 'ok') {
      if (Test-Path $Pending) { Remove-Item $Pending -Force -ErrorAction SilentlyContinue }
      Write-Log ('已上傳 ' + $all.Count + ' 筆')
      return $true
    }
    Write-Log ('上傳被拒：' + $r.message)
  } catch { Write-Log ('上傳失敗，下次重送：' + $_.Exception.Message) }
  ConvertTo-Json -InputObject @($all) -Depth 5 | Set-Content -Path $Pending -Encoding UTF8
  return $false
}

# ---------- 請求佇列（網頁按鈕 → Launcher.ps1 寫入） ----------
function Read-Request {
  $files = @(Get-ChildItem -Path $QueueDir -Filter '*.req' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)
  if ($files.Count -eq 0) { return $null }
  $last = $files[-1]
  $txt = ''
  try { $txt = (Get-Content $last.FullName -Raw -ErrorAction Stop).Trim() } catch {}
  $files | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
  $m = [regex]::Match($txt, '^(fix|restore|monitor)\|([A-Za-z0-9]{1,40})$')
  if (-not $m.Success) { Write-Log '忽略格式不正確的請求'; return $null }
  @{ mode = $m.Groups[1].Value; id = $m.Groups[2].Value }
}

function Format-Ms($v) { if ($null -eq $v) { '逾時' } else { "$v ms" } }

function Start-Monitor([string]$session, [string]$mode, $initial) {
  $buffer = @($initial)
  $end = (Get-Date).AddMinutes($Config.MonitorMinutes)
  Write-Log ('開始監測 ' + $Config.MonitorMinutes + ' 分鐘')
  while ((Get-Date) -lt $end) {
    Start-Sleep -Seconds $Config.IntervalSec
    $req = Read-Request
    if ($req) {
      if ($req.mode -eq 'restore') {
        Send-Samples $session $mode $buffer | Out-Null
        Invoke-Request $req
        return
      }
      Write-Status $req.id $true ('小幫手已在監測中（剩約 ' + [int](($end - (Get-Date)).TotalMinutes) + ' 分鐘），不用重複按。')
    }
    $buffer += Get-Sample 'monitor'
    if ($buffer.Count -ge $Config.BatchSize) {
      Send-Samples $session $mode $buffer | Out-Null
      $buffer = @()
    }
  }
  Send-Samples $session $mode $buffer | Out-Null
  Write-Log '監測結束'
}

function Invoke-Request($req) {
  $session = (Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + $req.mode
  switch ($req.mode) {
    'fix' {
      if (-not (Test-SchoolDns)) {
        Write-Status $req.id $false ('連不到學網備援 DNS（' + $Config.DnsV4 + '），可能不在校內網路，DNS 沒有更改。')
        Send-Samples $session 'fix' @(Get-Sample 'fix-skip') | Out-Null
        return
      }
      $before = Get-Sample 'before'
      try { $names = Set-FixedDns $true }
      catch { Write-Status $req.id $false ('修改 DNS 失敗：' + $_.Exception.Message); return }
      Start-Sleep -Seconds 2
      $after = Get-Sample 'after'
      if ($after.aaaa_count -eq 0 -and $after.a_count -gt 0) {
        $msg = "已切換為學網備援 DNS（$($names -join '、')）。`nLINE 傳檔伺服器現在只回應 IPv4，請再試一次傳圖/傳檔。`n（之後 $($Config.MonitorMinutes) 分鐘會在背景自動記錄網路狀況）"
        Write-Status $req.id $true $msg
      } else {
        $msg = "已切換 DNS，但 LINE 伺服器仍回應 $($after.aaaa_count) 筆 IPv6 位址（IPv4 $($after.a_count) 筆）。`n已自動通知資訊老師，請先照常使用。"
        Write-Status $req.id $false $msg
      }
      Start-Monitor $session 'fix' @($before, $after)
    }
    'restore' {
      Restore-Dns $true
      Start-Sleep -Seconds 2
      $s = Get-Sample 'restore'
      Write-Status $req.id $true ('已還原為原本的 DNS 設定。目前 DNS：' + $s.dns_servers)
      Send-Samples $session 'restore' @($s) | Out-Null
    }
    'monitor' {
      $s = Get-Sample 'monitor'
      Write-Status $req.id $true ("開始監測 $($Config.MonitorMinutes) 分鐘（不更改 DNS）。`n目前：IPv4 $($s.a_count) 筆、IPv6 $($s.aaaa_count) 筆；TCP 443 v4 $(Format-Ms $s.tcp_v4_ms)、v6 $(Format-Ms $s.tcp_v6_ms)")
      Start-Monitor $session 'monitor' @($s)
    }
  }
}

# ---------- 校外自動還原（開機、網路切換時執行） ----------
function Invoke-Guard {
  Start-Sleep -Seconds 15
  $state = Get-State
  if ($state.intent -ne 'fixed') { return }
  if (Test-SchoolDns) {
    if (-not $state.applied) { Set-FixedDns $false | Out-Null; Write-Log '回到校網，重新套用備援 DNS' }
  } else {
    if ($state.applied) { Restore-Dns $false; Write-Log '連不到學網 DNS（可能在校外），暫時還原原本設定' }
  }
}

# ---------- 主程式 ----------
$mutex = New-Object System.Threading.Mutex($false, 'Global\CheChengLineHelper')
$got = $false
try { $got = $mutex.WaitOne($(if ($Mode -eq 'guard') { 0 } else { 5000 })) } catch [System.Threading.AbandonedMutexException] { $got = $true }
if (-not $got) { Write-Log '另一個工作執行中，略過'; exit 0 }
try {
  switch ($Mode) {
    'guard'   { Invoke-Guard }
    'queue'   { $r = Read-Request; if ($r) { Invoke-Request $r } else { Write-Log '佇列是空的' } }
    default   { Invoke-Request @{ mode = $Mode; id = 'admin' } }
  }
} finally { $mutex.ReleaseMutex() }
