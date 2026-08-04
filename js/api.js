/* DTL 공용 레이어 — Airtable API + 캐시 + 공통 유틸
 * 모든 페이지가 이 파일 하나로 Airtable에 접근한다.
 *
 * ── 프록시 전환 (SECURITY.md 참고) ──
 * proxy/cloudflare-worker.js 배포 후 AT_PROXY에 Worker URL을 넣으면
 * 토큰 없이 프록시를 통해 호출한다. 전환 후 AT_TOKEN 줄은 삭제할 것.
 */
const AT_PROXY = ''; // 예: 'https://dtl-api.<계정>.workers.dev'

// AT_PROXY가 비어 있는 동안의 폴백(직접 호출)
const AT_TOKEN = 'patzqAMF1KGaHm2dz.5153b2df955449d550f431abdd1c6ed561f1b5e2f9a3b9e4a8f6162e2bc7c100';
const AT_BASE = 'appDtlXaLReCaDeE6';

const AT = AT_PROXY ? `${AT_PROXY}/v0` : `https://api.airtable.com/v0/${AT_BASE}`;
const AT_H = AT_PROXY
  ? { 'Content-Type': 'application/json' }
  : { 'Authorization': `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' };

// Airtable 필드명은 첫 글자만 소문자화해서 쓴다 (예: 'Court' → 'court')
const COURT_NO_FIELD = 'Court Number';
const COURT_NO_KEY = 'court Number';

async function atGet(table) {
  let all = [], offset = null;
  do {
    const url = `${AT}/${encodeURIComponent(table)}${offset ? '?offset=' + offset : ''}`;
    const r = await fetch(url, { headers: AT_H });
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
  return fetched;
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

// ── PWA 서비스 워커 등록 ──
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
