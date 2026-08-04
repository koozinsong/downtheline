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

// ── PWA 서비스 워커 등록 ──
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
