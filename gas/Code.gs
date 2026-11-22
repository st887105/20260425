/**
 * =====================================================================
 *  車城國小｜LINE 網路小幫手 — GAS 後端 v3.1.0
 *  接收 Windows 小幫手上傳的封包/DNS 監測資料 → 寫入試算表 → 異常時通知管理者
 *  讀取（儀表板）：JSONP GET  ／ 上傳（小幫手）：Raw POST text/plain
 *  車城國小資訊老師徐吉德整理製作@2026
 * =====================================================================
 *  部署步驟：
 *   1. 建立試算表「車城國小｜LINE 網路小幫手」→ 擴充功能 → Apps Script → 貼上本檔
 *   2. 執行 setupDatabase()（建立工作表）與 setupConfig()（建立指令碼屬性範本）
 *   3. 專案設定 → 指令碼屬性：填入 UPLOAD_TOKEN、LINE_TOKEN、LINE_TO、ADMIN_EMAIL
 *   4. 執行 testNotify() 確認收得到通知
 *   5. 部署 → 新增部署作業 → 網頁應用程式：執行身分「我」、存取「所有人」
 * =====================================================================
 */

const APP_NAME = '車城國小｜LINE 網路小幫手';
const VERSION = 'v3.1.0';

const SHEET_LOG = 'LINE監測紀錄';
const SHEET_HOST = 'LINE電腦狀態';
const SHEET_ALERT = '通知紀錄';
const SHEET_DIFF = '修改前後比較';

const LOG_FIELDS = [
  ['ts', '時間'], ['hostname', '電腦名稱'], ['ip', 'IP'], ['mac', 'MAC'],
  ['session', '工作階段'], ['mode', '模式'], ['phase', '階段'],
  ['dns_mode', 'DNS模式'], ['dns_servers', 'DNS伺服器'],
  ['a_count', 'A筆數'], ['aaaa_count', 'AAAA筆數'], ['dns_ms', 'DNS(ms)'],
  ['v4_ip', 'obs IPv4'], ['v6_ip', 'obs IPv6'],
  ['tcp_v4_ms', 'TCP443 v4(ms)'], ['tcp_v6_ms', 'TCP443 v6(ms)'],
  ['gw_ping_ms', '閘道ping(ms)'], ['gw_loss_pct', '閘道掉包%'], ['v6_global', '有IPv6位址'],
  ['result', '判定'], ['issues', '問題'], ['version', '版本'],
  ['ip_v6', '電腦IPv6'], ['adapter', '網卡'], ['gateway', '閘道']   // v3.1 新增（接在最後，舊資料不受影響）
];
const HOST_FIELDS = [
  ['hostname', '電腦名稱'], ['ip', 'IP'], ['mac', 'MAC'], ['last_seen', '最後時間'],
  ['mode', '最後模式'], ['phase', '階段'], ['dns_mode', 'DNS模式'], ['dns_servers', 'DNS伺服器'],
  ['a_count', 'A筆數'], ['aaaa_count', 'AAAA筆數'],
  ['tcp_v4_ms', 'TCP443 v4(ms)'], ['tcp_v6_ms', 'TCP443 v6(ms)'],
  ['gw_loss_pct', '閘道掉包%'], ['v6_global', '有IPv6位址'],
  ['result', '判定'], ['issues', '問題'], ['version', '版本'],
  ['ip_v6', '電腦IPv6'], ['adapter', '網卡'], ['gateway', '閘道']
];
// 修改前後比較：每個項目有「前」「後」兩欄
const DIFF_ITEMS = [
  ['ip', 'IPv4'], ['ip_v6', 'IPv6'], ['mac', 'MAC'], ['adapter', '網卡'], ['gateway', '閘道'],
  ['dns_mode', 'DNS模式'], ['dns_servers', 'DNS伺服器'],
  ['a_count', 'A筆數'], ['aaaa_count', 'AAAA筆數'],
  ['tcp_v4_ms', 'TCP443 v4平均(ms)'], ['tcp_v6_ms', 'TCP443 v6平均(ms)'],
  ['gw_ping_ms', '閘道ping平均(ms)'], ['gw_loss_pct', '閘道掉包平均%'], ['result', '判定']
];
const DIFF_AVG_KEYS = ['tcp_v4_ms', 'tcp_v6_ms', 'gw_ping_ms', 'gw_loss_pct'];
const DIFF_HEADERS = ['時間', '電腦名稱', '動作', '工作階段', '前量測筆數', '後量測筆數']
  .concat(...DIFF_ITEMS.map(d => [d[1] + '（前）', d[1] + '（後）'])).concat(['有變化的項目']);
const ALERT_HEADERS = ['時間', '電腦名稱', '類型', '管道', '內容'];

const PROPS = PropertiesService.getScriptProperties();
function cfg(key, def) { const v = PROPS.getProperty(key); return (v === null || v === '') ? def : v; }

// ===================== 一鍵建表 / 設定 =====================
function setupDatabase() {
  const ss = getSS();
  const defs = [
    { name: SHEET_LOG, headers: LOG_FIELDS.map(f => f[1]) },
    { name: SHEET_HOST, headers: HOST_FIELDS.map(f => f[1]) },
    { name: SHEET_ALERT, headers: ALERT_HEADERS },
    { name: SHEET_DIFF, headers: DIFF_HEADERS }
  ];
  defs.forEach(({ name, headers }) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  PROPS.setProperty('SS_ID', ss.getId());
  try { SpreadsheetApp.getUi().alert('✅ 資料庫建置完成！'); } catch (e) { Logger.log('✅ 資料庫建置完成：' + ss.getUrl()); }
}

function setupConfig() {
  const defaults = {
    UPLOAD_TOKEN: 'chcs-line-jEy14dRyaZOktS1I',  // 需與 windows/LineHelper.ps1 的 UploadToken 相同
    LINE_TOKEN: '',          // LINE Messaging API Channel access token（長期）
    LINE_TO: '',             // 管理者 userId，多位用逗號分隔（U 開頭）
    ADMIN_EMAIL: '',         // 備援 Email，多位用逗號分隔
    DASHBOARD_URL: 'https://st887105.github.io/20260425/web/#admin',
    NOTIFY_FIX: 'true',      // 每次一鍵修復完成也通知（測試期建議開）
    ALERT_THROTTLE_MIN: '30' // 同一台電腦異常通知間隔（分鐘）
  };
  Object.keys(defaults).forEach(k => { if (PROPS.getProperty(k) === null) PROPS.setProperty(k, defaults[k]); });
  Logger.log('已建立指令碼屬性範本，請到「專案設定 → 指令碼屬性」填入 LINE_TOKEN / LINE_TO / ADMIN_EMAIL，並更換 UPLOAD_TOKEN');
}

function getSS() {
  const id = PROPS.getProperty('SS_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const ss = SpreadsheetApp.create(APP_NAME);
  PROPS.setProperty('SS_ID', ss.getId());
  return ss;
}
function getSheet(name) {
  const sh = getSS().getSheetByName(name);
  if (!sh) throw new Error('找不到工作表「' + name + '」，請先執行 setupDatabase()');
  return sh;
}

// ===================== 智慧路由 =====================
function doGet(e) {
  const p = (e && e.parameter) || {};
  let result;
  try { result = handleGet(p); } catch (err) { result = { status: 'error', message: String(err.message || err) }; }
  const json = JSON.stringify(result);
  const cb = p.callback;
  if (cb && /^[A-Za-z_$][\w$]{0,60}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (data.action === 'upload') result = handleUpload(data);
    else result = { status: 'error', message: '未知的動作' };
  } catch (err) {
    result = { status: 'error', message: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function handleGet(p) {
  switch (p.action) {
    case 'ping': return { status: 'ok', app: APP_NAME, version: VERSION, time: new Date().toISOString() };
    case 'summary': return { status: 'ok', version: VERSION, rows: readHosts() };
    case 'history': return { status: 'ok', rows: readHistory(String(p.hostname || ''), Number(p.limit) || 200) };
    case 'changes': return { status: 'ok', rows: readChanges(String(p.hostname || ''), Number(p.limit) || 20) };
    default: return { status: 'error', message: '未知的動作' };
  }
}

// ===================== 上傳處理 =====================
function handleUpload(d) {
  if (!d.token || d.token !== cfg('UPLOAD_TOKEN', '')) return { status: 'error', message: '上傳密語不正確' };
  const hostname = clean(d.hostname, 64);
  if (!hostname) return { status: 'error', message: '缺少電腦名稱' };
  const samples = Array.isArray(d.samples) ? d.samples.slice(-500) : [];
  if (!samples.length) return { status: 'ok', saved: 0 };

  const base = { hostname, ip: clean(d.ip, 64), mac: clean(d.mac, 32), ip_v6: clean(d.ip_v6, 64),
                 adapter: clean(d.adapter, 64), gateway: clean(d.gateway, 64), session: clean(d.session, 64),
                 mode: clean(d.mode, 16), version: clean(d.version, 16) };
  const rows = samples.map(s => {
    const r = Object.assign({}, base, normalizeSample(s));
    ['ip', 'mac', 'ip_v6', 'adapter', 'gateway'].forEach(k => { if (!r[k]) r[k] = base[k]; }); // 樣本沒帶就用整批的
    const j = judge(r);
    r.result = j.result; r.issues = j.issues.join('；');
    return r;
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const log = getSheet(SHEET_LOG);
    log.getRange(log.getLastRow() + 1, 1, rows.length, LOG_FIELDS.length)
       .setValues(rows.map(r => LOG_FIELDS.map(f => toCell(r[f[0]]))));
    upsertHost(rows[rows.length - 1]);
    var diff = buildDiff(rows);
    if (diff) {
      const sh = getSheet(SHEET_DIFF);
      sh.getRange(sh.getLastRow() + 1, 1, 1, DIFF_HEADERS.length).setValues([diff.cells.map(toCell)]);
    }
  } finally { lock.releaseLock(); }

  maybeNotify(rows, diff);
  return { status: 'ok', saved: rows.length, diff: diff ? diff.changed : null };
}

function normalizeSample(s) {
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  return {
    ts: clean(s.ts, 40) || new Date().toISOString(),
    phase: clean(s.phase, 16), dns_mode: clean(s.dns_mode, 10), dns_servers: clean(s.dns_servers, 200),
    a_count: num(s.a_count) || 0, aaaa_count: num(s.aaaa_count) || 0, dns_ms: num(s.dns_ms),
    v4_ip: clean(s.v4_ip, 64), v6_ip: clean(s.v6_ip, 64),
    tcp_v4_ms: num(s.tcp_v4_ms), tcp_v6_ms: num(s.tcp_v6_ms),
    gw_ping_ms: num(s.gw_ping_ms), gw_loss_pct: num(s.gw_loss_pct),
    v6_global: s.v6_global === true || s.v6_global === 'true',
    ip: clean(s.ip, 64), mac: clean(s.mac, 32), ip_v6: clean(s.ip_v6, 64),
    adapter: clean(s.adapter, 64), gateway: clean(s.gateway, 64)
  };
}

/** 判定規則：pass / warn / fail */
function judge(r) {
  const fail = [], warn = [];
  if (r.a_count === 0) fail.push('DNS 查不到 obs.line-apps.com');
  if (r.dns_mode === 'fixed' && r.aaaa_count > 0) fail.push('已改備援 DNS 但仍回應 AAAA ' + r.aaaa_count + ' 筆');
  if (r.aaaa_count > 0 && r.v6_global && r.tcp_v6_ms === null) fail.push('IPv6 443 連不上（LINE 傳檔會卡住）');
  if (r.a_count > 0 && r.tcp_v4_ms === null) fail.push('IPv4 443 連不上');
  if (r.gw_loss_pct !== null && r.gw_loss_pct >= 50) fail.push('閘道掉包 ' + r.gw_loss_pct + '%');
  else if (r.gw_loss_pct !== null && r.gw_loss_pct >= 20) warn.push('閘道掉包 ' + r.gw_loss_pct + '%');
  if (r.tcp_v4_ms !== null && r.tcp_v4_ms > 500) warn.push('IPv4 443 偏慢 ' + r.tcp_v4_ms + 'ms');
  if (r.dns_mode !== 'fixed' && r.aaaa_count > 0 && r.tcp_v6_ms !== null) warn.push('仍走 IPv6（未改 DNS）');
  return { result: fail.length ? 'fail' : (warn.length ? 'warn' : 'pass'), issues: fail.concat(warn) };
}

/** 同一批資料同時有 before 與 after 樣本 → 產生一列「修改前後比較」 */
function buildDiff(rows) {
  const before = rows.filter(r => r.phase === 'before');
  const after = rows.filter(r => r.phase === 'after');
  if (!before.length || !after.length) return null;
  const pick = (list, key) => {
    if (DIFF_AVG_KEYS.indexOf(key) >= 0) {
      const v = list.map(r => r[key]).filter(x => x !== null && x !== '' && !isNaN(x));
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '逾時/無';
    }
    if (key === 'result') {
      const rs = list.map(r => r.result);
      return rs.indexOf('fail') >= 0 ? 'fail' : rs.indexOf('warn') >= 0 ? 'warn' : 'pass';
    }
    const last = list[list.length - 1][key];
    return (last === null || last === undefined || last === '') ? '—' : last;
  };
  const cells = [after[after.length - 1].ts, rows[0].hostname, rows[0].mode === 'restore' ? '還原' : '一鍵修復',
                 rows[0].session, before.length, after.length];
  const changed = [];
  const lines = [];
  DIFF_ITEMS.forEach(([k, label]) => {
    const b = pick(before, k), a = pick(after, k);
    cells.push(b, a);
    const same = String(b) === String(a);
    if (!same) changed.push(label);
    lines.push((same ? '・' : '★') + label + '：' + (same ? a + '（不變）' : b + ' → ' + a));
  });
  cells.push(changed.join('、') || '無');
  return { cells, changed, text: lines.join('\n') };
}

function readChanges(hostname, limit) {
  const sh = getSheet(SHEET_DIFF);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const scan = Math.min(last - 1, 2000);
  const values = sh.getRange(last - scan + 1, 1, scan, DIFF_HEADERS.length).getValues();
  const key = hostname.toLowerCase();
  const out = [];
  for (let i = values.length - 1; i >= 0 && out.length < Math.min(limit, 100); i--) {
    const v = values[i];
    if (key && String(v[1]).toLowerCase() !== key) continue;
    const o = { time: v[0] instanceof Date ? v[0].toISOString() : v[0], hostname: v[1], action: v[2], session: v[3],
                before_n: v[4], after_n: v[5], items: [], changed: v[6 + DIFF_ITEMS.length * 2] };
    DIFF_ITEMS.forEach(([k, label], j) => o.items.push({ key: k, label, before: v[6 + j * 2], after: v[7 + j * 2] }));
    out.push(o);
  }
  return out;
}

function upsertHost(r) {
  const sh = getSheet(SHEET_HOST);
  const rowVals = [HOST_FIELDS.map(f => toCell(f[0] === 'last_seen' ? r.ts : r[f[0]]))];
  const last = sh.getLastRow();
  if (last >= 2) {
    const names = sh.getRange(2, 1, last - 1, 1).getValues().map(v => String(v[0]).toLowerCase());
    const idx = names.indexOf(r.hostname.toLowerCase());
    if (idx >= 0) { sh.getRange(idx + 2, 1, 1, HOST_FIELDS.length).setValues(rowVals); return; }
  }
  sh.getRange(last + 1, 1, 1, HOST_FIELDS.length).setValues(rowVals);
}

// ===================== 讀取 =====================
function readHosts() {
  const sh = getSheet(SHEET_HOST);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HOST_FIELDS.length).getValues().map(row => rowToObj(row, HOST_FIELDS));
}

function readHistory(hostname, limit) {
  if (!hostname) return [];
  const sh = getSheet(SHEET_LOG);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const scan = Math.min(last - 1, 5000);
  const values = sh.getRange(last - scan + 1, 1, scan, LOG_FIELDS.length).getValues();
  const key = hostname.toLowerCase();
  const out = [];
  for (let i = values.length - 1; i >= 0 && out.length < Math.min(limit, 500); i--) {
    if (String(values[i][1]).toLowerCase() === key) out.push(rowToObj(values[i], LOG_FIELDS));
  }
  return out;
}

function rowToObj(row, fields) {
  const o = {};
  fields.forEach((f, i) => {
    let v = row[i];
    if (v instanceof Date) v = v.toISOString();
    if (v === '') v = null;
    o[f[0]] = v;
  });
  return o;
}

// ===================== 通知 =====================
function maybeNotify(rows, diff) {
  const host = rows[0].hostname;
  const cache = CacheService.getScriptCache();
  const throttleSec = Math.min(21600, Math.max(60, Number(cfg('ALERT_THROTTLE_MIN', '30')) * 60));

  // 1) 一鍵修復／還原結果（附修改前後比較）
  if (cfg('NOTIFY_FIX', 'true') === 'true' && diff) {
    const after = rows.filter(r => r.phase === 'after').pop();
    const isRestore = rows[0].mode === 'restore';
    const ok = isRestore || (after.aaaa_count === 0 && after.a_count > 0);
    notify(host, isRestore ? 'restore' : 'fix',
      (ok ? '✅' : '⚠️') + ' ' + host + (isRestore ? ' 已「還原 DNS」' : ' 已按「一鍵修復」') + '\n' +
      (isRestore ? '還原前 → 還原後' : '修改前 → 修改後') + '（★＝有變化）\n' + diff.text +
      (isRestore ? '' : (ok ? '\n→ LINE 伺服器已只回應 IPv4' : '\n→ 備援 DNS 仍回應 IPv6，請回報縣網中心')) +
      '\n' + cfg('DASHBOARD_URL', ''));
  }

  // 2) 異常通知（排除修改前的 before 樣本，同一台節流）
  const bad = rows.filter(r => r.result === 'fail' && r.phase !== 'before' && r.phase !== 'after');
  if (!bad.length) return;
  const key = 'alert_' + host.toLowerCase();
  if (cache.get(key)) return;
  cache.put(key, '1', throttleSec);
  const r = bad[bad.length - 1];
  notify(host, 'alert',
    '❌ 車城國小 LINE 網路異常\n' +
    '電腦：' + host + '（' + (r.ip || '—') + '）\n' +
    '時間：' + Utilities.formatDate(new Date(r.ts), 'Asia/Taipei', 'MM/dd HH:mm:ss') + '\n' +
    '問題：' + r.issues + '\n' +
    'DNS：' + (r.dns_mode === 'fixed' ? '備援 ' : '自動 ') + r.dns_servers + '\n' +
    'A ' + r.a_count + '／AAAA ' + r.aaaa_count + '；TCP443 v4 ' + ms(r.tcp_v4_ms) + '／v6 ' + ms(r.tcp_v6_ms) +
    '；閘道掉包 ' + (r.gw_loss_pct === null ? '—' : r.gw_loss_pct + '%') + '\n' +
    '本批 ' + rows.length + ' 筆中異常 ' + bad.length + ' 筆\n' +
    cfg('DASHBOARD_URL', ''));
}

function notify(host, type, text) {
  const channels = [];
  const token = cfg('LINE_TOKEN', '');
  const to = cfg('LINE_TO', '').split(',').map(s => s.trim()).filter(Boolean);
  let lineOk = false;
  if (token && to.length) {
    try {
      const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text.slice(0, 4900) }] })
      });
      lineOk = res.getResponseCode() === 200;
      channels.push(lineOk ? 'LINE' : 'LINE失敗' + res.getResponseCode());
    } catch (e) { channels.push('LINE錯誤'); }
  }
  const mail = cfg('ADMIN_EMAIL', '');
  if (mail && (!lineOk || type === 'alert')) {
    try {
      MailApp.sendEmail(mail, '[' + APP_NAME + '] ' + ({ alert: '異常通知 ', restore: '還原回報 ' }[type] || '修復回報 ') + host, text);
      channels.push('Email');
    } catch (e) { channels.push('Email錯誤'); }
  }
  try {
    getSheet(SHEET_ALERT).appendRow([new Date(), host, type, channels.join('+') || '未設定通知', text]);
  } catch (e) {}
}

// ===================== 工具 =====================
function clean(v, max) { return (v === null || v === undefined) ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200); }
function toCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v; // 防試算表公式注入
  return v;
}
function ms(v) { return v === null || v === undefined ? '逾時/無' : v + 'ms'; }

// ===================== 測試 / 維護 =====================
function testNotify() {
  notify('TEST-PC', 'alert', '🔔 ' + APP_NAME + ' 通知測試\n收到這則訊息代表通知設定正確。');
}

/** 測試上傳流程（不經過 Windows 小幫手） */
function testUpload() {
  const r = handleUpload({
    action: 'upload', token: cfg('UPLOAD_TOKEN', ''), hostname: 'TEST-PC', ip: '10.0.0.99', mac: '00-00-00-00-00-00',
    session: 'test', mode: 'fix', version: VERSION,
    samples: [{ ts: new Date().toISOString(), phase: 'monitor', dns_mode: 'fixed', dns_servers: '163.24.239.2, 2001:288:8600:1::1002',
      a_count: 2, aaaa_count: 0, dns_ms: 12, v4_ip: '147.92.0.1', v6_ip: '', tcp_v4_ms: 35, tcp_v6_ms: null,
      gw_ping_ms: 1, gw_loss_pct: 0, v6_global: true }]
  });
  Logger.log(JSON.stringify(r));
}

/** 測試「修改前後比較」（模擬一鍵修復前後各 1 筆） */
function testDiff() {
  const now = new Date().toISOString();
  const common = { ip: '10.0.0.99', mac: '00-11-22-33-44-55', ip_v6: '2001:288:1::99', adapter: '乙太網路', gateway: '10.0.0.254',
                   a_count: 2, dns_ms: 10, v4_ip: '147.92.0.1', tcp_v4_ms: 35, gw_ping_ms: 1, gw_loss_pct: 0, v6_global: true };
  const r = handleUpload({ action: 'upload', token: cfg('UPLOAD_TOKEN', ''), hostname: 'TEST-PC', session: 'test-diff', mode: 'fix', version: VERSION,
    samples: [
      Object.assign({}, common, { ts: now, phase: 'before', dns_mode: 'auto', dns_servers: '163.28.6.1', aaaa_count: 2, v6_ip: '2001:b28::1', tcp_v6_ms: null }),
      Object.assign({}, common, { ts: now, phase: 'after', dns_mode: 'fixed', dns_servers: '163.24.239.2, 2001:288:8600:1::1002', aaaa_count: 0, v6_ip: '', tcp_v6_ms: null })
    ] });
  Logger.log(JSON.stringify(r));
}

/** 刪除 60 天前的監測紀錄（可設每週觸發） */
function cleanupOldLogs() {
  const sh = getSheet(SHEET_LOG);
  const last = sh.getLastRow();
  if (last < 2) return;
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
  const ts = sh.getRange(2, 1, last - 1, 1).getValues();
  let n = 0;
  while (n < ts.length && new Date(ts[n][0]).getTime() < cutoff) n++;
  if (n > 0) sh.deleteRows(2, n);
  Logger.log('已刪除 ' + n + ' 筆舊紀錄');
}
