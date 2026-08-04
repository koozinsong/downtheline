/**
 * DTL Airtable 프록시 — Cloudflare Worker
 *
 * 목적: Airtable Personal Access Token을 브라우저에 노출하지 않고
 *       정적 페이지(GitHub Pages)에서 Airtable을 쓰기 위한 중계 서버.
 *
 * 배포 방법 (Cloudflare 대시보드, 5분 소요):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. 이 파일 내용을 통째로 붙여넣고 Deploy
 *   3. Worker → Settings → Variables and Secrets 에서 추가:
 *        AIRTABLE_TOKEN  = (새로 발급한 Airtable PAT)  ← 반드시 "Secret" 타입
 *        AIRTABLE_BASE   = appDtlXaLReCaDeE6
 *        ALLOWED_ORIGINS = https://koozinsong.github.io
 *          (여러 개면 쉼표로 구분. 로컬 테스트를 허용하려면
 *           https://koozinsong.github.io,http://localhost:8000 처럼 추가)
 *   4. 배포된 Worker URL(예: https://dtl-api.<계정>.workers.dev)을
 *      js/api.js 의 AT_PROXY 상수에 넣으면 전 페이지가 프록시를 사용.
 *
 * 요청 형식은 Airtable REST와 동일하게 미러링:
 *   GET    /v0/:table?offset=...   (목록 조회, 페이지네이션)
 *   POST   /v0/:table              (레코드 생성)
 *   PATCH  /v0/:table/:id          (레코드 수정)
 *   DELETE /v0/:table/:id          (레코드 삭제)
 */

const ALLOWED_TABLES = new Set(['Players', 'Events', 'Matches', 'Schedules', 'Booking']);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

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

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      return json({ error: 'method not allowed' }, 405, corsHeaders);
    }

    // 경로: /v0/<table>[/<recordId>]
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v0' || parts.length < 2 || parts.length > 3) {
      return json({ error: 'not found' }, 404, corsHeaders);
    }
    const table = decodeURIComponent(parts[1]);
    const recordId = parts[2] || '';

    if (!ALLOWED_TABLES.has(table)) {
      return json({ error: `table not allowed: ${table}` }, 403, corsHeaders);
    }
    if (recordId && !/^rec[A-Za-z0-9]+$/.test(recordId)) {
      return json({ error: 'invalid record id' }, 400, corsHeaders);
    }

    const upstream = new URL(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE}/${encodeURIComponent(table)}` +
      (recordId ? `/${recordId}` : '')
    );
    // 페이지네이션 offset만 전달 (filterByFormula 등 임의 쿼리는 차단)
    const offset = url.searchParams.get('offset');
    if (offset) upstream.searchParams.set('offset', offset);

    const init = {
      method: request.method,
      headers: {
        'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    if (request.method === 'POST' || request.method === 'PATCH') {
      init.body = await request.text();
    }

    const res = await fetch(upstream, init);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
