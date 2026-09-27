/**
 * DTL 데이터 프록시 v2 — GitHub 저장소 백엔드 (Airtable 대체)
 *
 * 데이터는 GitHub 저장소의 data/<Table>.json 에 저장된다 (기본: data 브랜치).
 * 응답 형식은 Airtable REST와 동일하게 유지 → 사이트 코드(js/api.js) 무변경.
 *
 * 배포 방법:
 *   1. Cloudflare 대시보드 → dlt-api Worker → Edit code → 이 파일로 전체 교체 → Deploy
 *   2. Settings → Variables and Secrets:
 *        GH_TOKEN  = GitHub Fine-grained PAT (Secret 타입!)
 *                    · 대상: koozinsong/downtheline 저장소만
 *                    · 권한: Contents → Read and write (그 외 전부 No access)
 *        GH_REPO   = koozinsong/downtheline   (Text)
 *        GH_BRANCH = data                     (Text)
 *        ALLOWED_ORIGINS = https://koozinsong.github.io  (기존 유지)
 *      (기존 AIRTABLE_* 변수는 삭제해도 됨)
 *
 * API (기존과 동일):
 *   GET    /v0/:table          → { records: [{id, createdTime, fields}] }
 *   POST   /v0/:table          → 생성된 레코드
 *   PATCH  /v0/:table/:id      → 수정된 레코드 (fields는 부분 병합, null이면 필드 삭제)
 *   DELETE /v0/:table/:id      → { deleted: true, id }
 */

const ALLOWED_TABLES = new Set(['Players', 'Events', 'Matches', 'Schedules', 'Booking']);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const FRESH_MS = 60 * 1000; // GET 엣지 캐시 신선 기간 (쓰기 시 즉시 갱신되므로 짧게 유지할 필요 없음)

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const corsOrigin = allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] || '');
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200, extra = {}) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...extra, ...corsHeaders } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (!ALLOWED_METHODS.has(request.method)) return json({ error: 'method not allowed' }, 405);

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v0' || parts.length < 2 || parts.length > 3) return json({ error: 'not found' }, 404);
    const table = decodeURIComponent(parts[1]);
    const recordId = parts[2] || '';
    if (!ALLOWED_TABLES.has(table)) return json({ error: `table not allowed: ${table}` }, 403);

    const cache = caches.default;
    const cacheKey = new Request(`https://dtl-cache.internal/${env.GH_BRANCH || 'data'}/${table}`, { method: 'GET' });

    // ── 읽기 ──
    if (request.method === 'GET') {
      const hit = await cache.match(cacheKey);
      const age = hit ? Date.now() - Number(hit.headers.get('X-Fetched-At') || 0) : Infinity;
      if (hit && age < FRESH_MS) {
        return json(JSON.parse(await hit.text()), 200, { 'X-DTL-Cache': 'fresh' });
      }
      try {
        const { records } = await readTable(env, table);
        await putCache(cache, cacheKey, { records });
        return json({ records }, 200, { 'X-DTL-Cache': 'miss' });
      } catch (e) {
        if (hit) return json(JSON.parse(await hit.text()), 200, { 'X-DTL-Cache': 'stale' });
        return json({ error: { type: 'READ_FAILED', message: String(e.message || e) } }, 502);
      }
    }

    // ── 쓰기 (read-modify-write, 충돌 시 재시도) ──
    let body = null;
    if (request.method === 'POST' || request.method === 'PATCH') {
      try { body = await request.json(); } catch (e) { return json({ error: { type: 'BAD_JSON', message: 'invalid body' } }, 400); }
      if (!body || typeof body.fields !== 'object') return json({ error: { type: 'BAD_BODY', message: 'fields required' } }, 400);
    }
    if ((request.method === 'PATCH' || request.method === 'DELETE') && !recordId)
      return json({ error: { type: 'NO_ID', message: 'record id required' } }, 400);

    for (let attempt = 0; attempt < 4; attempt++) {
      let sha, records;
      try { ({ sha, records } = await readTable(env, table)); }
      catch (e) { return json({ error: { type: 'READ_FAILED', message: String(e.message || e) } }, 502); }

      let result;
      if (request.method === 'POST') {
        const rec = { id: genId(), createdTime: new Date().toISOString(), fields: cleanFields(body.fields) };
        records.push(rec);
        result = rec;
      } else if (request.method === 'PATCH') {
        const rec = records.find(r => r.id === recordId);
        if (!rec) return json({ error: { type: 'NOT_FOUND', message: `record ${recordId} not found` } }, 404);
        for (const [k, v] of Object.entries(body.fields)) {
          if (v === null || v === '') delete rec.fields[k];
          else rec.fields[k] = v;
        }
        result = rec;
      } else { // DELETE
        const idx = records.findIndex(r => r.id === recordId);
        if (idx === -1) return json({ error: { type: 'NOT_FOUND', message: `record ${recordId} not found` } }, 404);
        records.splice(idx, 1);
        result = { deleted: true, id: recordId };
      }

      const ok = await writeTable(env, table, records, sha, `${request.method} ${table}${recordId ? ' ' + recordId : ''}`);
      if (ok) {
        await putCache(cache, cacheKey, { records }); // 쓰기 직후 캐시를 최신으로 교체
        return json(result);
      }
      // sha 충돌 → 재시도
    }
    return json({ error: { type: 'CONFLICT', message: 'write conflict, try again' } }, 409);
  },
};

// ── GitHub Contents API ──
function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'dtl-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function readTable(env, table) {
  const u = `https://api.github.com/repos/${env.GH_REPO}/contents/data/${table}.json?ref=${env.GH_BRANCH || 'data'}`;
  const r = await fetch(u, { headers: ghHeaders(env) });
  if (r.status === 404) return { sha: null, records: [] }; // 파일 없으면 빈 테이블
  if (!r.ok) throw new Error(`github read ${r.status}`);
  const d = await r.json();
  const text = b64DecodeUtf8(d.content || '');
  const parsed = text.trim() ? JSON.parse(text) : { records: [] };
  return { sha: d.sha, records: parsed.records || [] };
}

async function writeTable(env, table, records, sha, message) {
  const u = `https://api.github.com/repos/${env.GH_REPO}/contents/data/${table}.json`;
  const payload = {
    message: `data: ${message}`,
    content: b64EncodeUtf8(JSON.stringify({ records }, null, 1)),
    branch: env.GH_BRANCH || 'data',
  };
  if (sha) payload.sha = sha;
  const r = await fetch(u, { method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (r.status === 409 || r.status === 422) return false; // 충돌 → 호출부에서 재시도
  if (!r.ok) throw new Error(`github write ${r.status}`);
  return true;
}

async function putCache(cache, cacheKey, obj) {
  await cache.put(cacheKey, new Response(JSON.stringify(obj), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800', 'X-Fetched-At': String(Date.now()) },
  }));
}

function genId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(14);
  crypto.getRandomValues(buf);
  return 'rec' + Array.from(buf, b => chars[b % chars.length]).join('');
}

function cleanFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === '' || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64DecodeUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
