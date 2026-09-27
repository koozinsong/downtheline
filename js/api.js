/* DTL 공용 레이어 — Airtable API + 캐시 + 공통 유틸
 * 모든 페이지가 이 파일 하나로 Airtable에 접근한다.
 *
 * Airtable 토큰은 Cloudflare Worker(proxy/cloudflare-worker.js)의
 * 환경변수에만 존재한다. 이 저장소에 토큰을 다시 넣지 말 것 (SECURITY.md 참고).
 *
 * 이 파일을 수정하면 각 HTML의 <script src="js/api.js?v=N">의 N을 올려서
 * 브라우저/페이지 캐시(10분)로 인한 구버전 로드를 방지할 것.
 */
const AT_PROXY = 'https://dlt-api.koozin.workers.dev';

const AT = `${AT_PROXY}/v0`;
const AT_H = { 'Content-Type': 'application/json' };

// Airtable 필드명은 첫 글자만 소문자화해서 쓴다 (예: 'Court' → 'court')
const COURT_NO_FIELD = 'Court Number';
const COURT_NO_KEY = 'court Number';

async function atGet(table) {
  let all = [], offset = null;
  do {
    const url = `${AT}/${encodeURIComponent(table)}${offset ? '?offset=' + offset : ''}`;
    const r = await fetch(url, { headers: AT_H });
    if (r.status === 429) { const e = new Error('AIRTABLE_LIMIT'); e.limit = true; throw e; }
    const d = await r.json();
    all.push(...(d.records || []).map(rec => {
      const o = { id: rec.id, createdTime: rec.createdTime };
      Object.entries(rec.fields || {}).forEach(([k, v]) => { o[k.charAt(0).toLowerCase() + k.slice(1)] = v; });
      return o;
    }));
    offset = d.offset;
  } while (offset);
  return all;
}
async function atCreate(table, fields) {
  const r = await fetch(`${AT}/${encodeURIComponent(table)}`, { method: 'POST', headers: AT_H, body: JSON.stringify({ fields }) });
  const d = await r.json();
  return d.error ? { success: false, error: d.error.message } : { success: true, id: d.id };
}
async function atUpdate(table, id, fields) {
  const r = await fetch(`${AT}/${encodeURIComponent(table)}/${id}`, { method: 'PATCH', headers: AT_H, body: JSON.stringify({ fields }) });
  const d = await r.json();
  return d.error ? { success: false, error: d.error.message } : { success: true, id: d.id };
}
async function atDelete(table, id) {
  await fetch(`${AT}/${encodeURIComponent(table)}/${id}`, { method: 'DELETE', headers: AT_H });
  return { success: true };
}

// ── localStorage 캐시 (stale-while-revalidate) ──
const CACHE_TTL = 60 * 1000;
const CACHE_VER = 'v3';
let _skipCache = false;
const _tbl = { getPlayers: 'Players', getEvents: 'Events', getMatches: 'Matches', getSchedules: 'Schedules', getBookings: 'Booking' };
function cacheGet(k) { try { const r = localStorage.getItem('dtl_' + CACHE_VER + '_' + k); if (!r) return null; const { data, ts } = JSON.parse(r); return Date.now() - ts > CACHE_TTL ? null : data; } catch (e) { return null; } }
function cacheSet(k, d) { try { localStorage.setItem('dtl_' + CACHE_VER + '_' + k, JSON.stringify({ data: d, ts: Date.now() })); } catch (e) {} }
function cacheDrop(keys) { keys.forEach(k => localStorage.removeItem('dtl_' + CACHE_VER + '_' + k)); }
// TTL 무시하고 마지막 저장분 반환 (API 한도 초과 시 비상 폴백용)
function cacheGetStale(k) { try { const r = localStorage.getItem('dtl_' + CACHE_VER + '_' + k); if (!r) return null; return JSON.parse(r).data; } catch (e) { return null; } }
let _usingStaleData = false;
function notifyStaleData() {
  if (_usingStaleData || !document.body) return;
  _usingStaleData = true;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:999;background:#8a3f13;color:#fff;font-size:.78rem;padding:.55rem 1rem;text-align:center;font-family:inherit;';
  bar.textContent = 'Airtable 월 API 한도 초과 — 마지막으로 불러온 데이터를 표시 중입니다 (매월 1일 리셋, 저장 불가)';
  document.body.appendChild(bar);
}
// 캐시가 있으면 즉시 반환하되, 백그라운드 fetch 결과가 다르면 onFresh(data)로 알림
async function cachedFetch(action, onFresh) {
  const cached = _skipCache ? null : cacheGet(action);
  const table = _tbl[action];
  if (!table) return cached || [];
  const fetched = atGet(table).then(d => { cacheSet(action, d); return d; });
  if (cached) {
    fetched.then(d => { if (onFresh && JSON.stringify(d) !== JSON.stringify(cached)) onFresh(d); }).catch(() => {});
    return cached;
  }
  // 한도 초과(429) 등 실패 시: 만료된 캐시라도 있으면 그것으로 표시
  return fetched.catch(err => {
    const stale = cacheGetStale(action);
    if (stale) { notifyStaleData(); return stale; }
    throw err;
  });
}

// ── 공통 유틸 ──
function pad(n) { return String(n).padStart(2, '0'); }
function todayKST() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).split(' ')[0]; }
function nextSundayKST() {
  const [y, m, d] = todayKST().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (day === 0 ? 0 : 7 - day));
  return dt.toISOString().split('T')[0];
}
function parseTimeRange(t) {
  const m = String(t || '').match(/(\d{1,2}):?\d*\s*[-~]\s*(\d{1,2})/);
  return m ? { start: +m[1], end: +m[2] } : null;
}
function displayCourtNo(no) {
  if (no === undefined || no === null || no === '') return '';
  return /^\d+$/.test(String(no)) ? String(no) + '번' : String(no);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 정기(기본) 예약 규칙 — booking 캘린더와 index 히어로가 공유 ──
// 규칙이 바뀌면 여기 한 곳만 수정
const DEFAULT_BOOKING_RULES = [
  { court: '세곡', from: '', to: '2026-07-01', start: 6, end: 8, extra: { [COURT_NO_KEY]: '1' } },
  { court: '아차산', from: '2026-07-12', to: '', start: 6, end: 10, extra: {} },
];

// 해당 날짜(일요일)에 실제 예약이 덮지 않는 정기 예약을 가상 항목으로 생성
function defaultBookingsFor(date, real) {
  const [y, m, d] = date.split('-').map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) return [];
  const covers = (court, from, to) => real.some(b => {
    const r = b.range || parseTimeRange(b.time);
    return b.court === court && r && r.start < to && r.end > from;
  });
  return DEFAULT_BOOKING_RULES
    .filter(rule => (!rule.from || date >= rule.from) && (!rule.to || date < rule.to))
    .filter(rule => !covers(rule.court, rule.start, rule.end))
    .map(rule => ({
      _default: true, court: rule.court, status: '기본',
      time: `${pad(rule.start)}:00-${pad(rule.end)}:00`,
      range: { start: rule.start, end: rule.end },
      ...rule.extra,
    }));
}

// 정기 예약을 끄기 위해 넣은 취소 레코드(메모 없음)인지 판별 — 목록/캘린더 표시에서 숨김
// 메모가 있는 취소(예: '미확보')는 정보성이므로 계속 표시한다
function isDefaultCancel(b) {
  if (b.status !== '취소' || String(b.memo || '').trim()) return false;
  const r = b.range || parseTimeRange(b.time);
  if (!r) return false;
  const date = String(b.date || '').substring(0, 10);
  return DEFAULT_BOOKING_RULES.some(rule =>
    b.court === rule.court &&
    (!rule.from || date >= rule.from) && (!rule.to || date < rule.to) &&
    r.start === rule.start && r.end === rule.end);
}

// ── 수동 새로고침 (설치형 웹앱에는 브라우저 새로고침 UI가 없음) ──
// 로컬 데이터 캐시(dtl_*)를 비우고 페이지를 다시 불러온다
function hardRefresh() {
  try { Object.keys(localStorage).filter(k => k.startsWith('dtl_')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  location.reload();
}

// ── PWA 안전 확인창/알림 ──
// 설치형 웹앱(iOS 홈 화면 등)에서는 confirm()/alert()가 동작하지 않으므로 자체 UI 사용
function uiConfirm(message) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,32,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
    ov.innerHTML = `<div style="background:#fff;border-radius:16px;padding:1.3rem 1.4rem;max-width:340px;width:100%;box-shadow:0 24px 60px rgba(16,24,32,.28);">
      <div style="font-size:.92rem;color:#101820;line-height:1.65;white-space:pre-line;">${escapeHtml(message)}</div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1.15rem;">
        <button data-r="0" style="font-size:.78rem;font-weight:700;padding:.5rem 1.1rem;border-radius:999px;border:1px solid rgba(16,24,32,.15);background:#fff;cursor:pointer;">취소</button>
        <button data-r="1" style="font-size:.78rem;font-weight:700;padding:.5rem 1.1rem;border-radius:999px;border:none;background:#101820;color:#fff;cursor:pointer;">확인</button>
      </div></div>`;
    ov.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) { ov.remove(); resolve(b.dataset.r === '1'); }
      else if (e.target === ov) { ov.remove(); resolve(false); }
    });
    document.body.appendChild(ov);
  });
}
function uiAlert(message) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:1.4rem;left:50%;transform:translateX(-50%);z-index:9999;background:#101820;color:#fff;font-size:.82rem;padding:.6rem 1.1rem;border-radius:999px;max-width:88vw;box-shadow:0 10px 30px rgba(16,24,32,.3);white-space:pre-line;text-align:center;';
  t.textContent = String(message);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
window.alert = uiAlert; // 기존 alert 호출 전부 PWA 안전 알림으로

// ── PWA 서비스 워커 등록 ──
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
