/* DTL 서비스 워커 — 정적 자산 캐시 + 오프라인 폴백
 * 데이터(Airtable)는 크로스 오리진이라 캐시하지 않음 (항상 네트워크)
 */
const CACHE = 'dtl-v1';
const ASSETS = [
  './',
  'index.html',
  'booking.html',
  'ranking.html',
  'results.html',
  'schedule.html',
  'social.html',
  'travel.html',
  'js/api.js',
  'manifest.json',
  'favicon.svg',
  'apple-touch-icon.svg',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 같은 오리진 GET만 처리: 네트워크 우선, 실패 시 캐시 폴백 (항상 최신 페이지 + 오프라인 대비)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
