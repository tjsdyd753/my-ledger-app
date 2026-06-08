/* ============================================================
   한손 · Service Worker
   앱 파일(HTML/CSS/JS)을 기기에 저장해 오프라인에서도 열리게 합니다.
   데이터(Firebase)는 SW를 거치지 않고 직접 서버와 통신합니다.
   ============================================================ */

var CACHE_NAME = "hansohn-v1";

// 캐시할 파일 목록 (앱 껍데기)
var STATIC_FILES = [
  "/my-ledger-app/",
  "/my-ledger-app/index.html",
  "/my-ledger-app/style.css",
  "/my-ledger-app/app.js",
  "/my-ledger-app/favicon.svg",
  "/my-ledger-app/icons/icon-192.png",
  "/my-ledger-app/icons/icon-512.png"
];

// ── 설치: 정적 파일을 캐시에 저장 ──
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_FILES);
    })
  );
  self.skipWaiting();   // 새 SW를 즉시 활성화
});

// ── 활성화: 오래된 캐시 정리 ──
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── 요청 처리 ──
self.addEventListener("fetch", function (e) {
  var url = e.request.url;

  // Firebase·Google 관련 요청은 항상 네트워크 직통 (캐시 안 함)
  if (url.includes("firebaseapp.com") ||
      url.includes("firebase.google.com") ||
      url.includes("googleapis.com") ||
      url.includes("gstatic.com") ||
      url.includes("googleapis") ||
      url.includes("firestore.googleapis.com")) {
    return;
  }

  // 정적 파일: 캐시 우선 → 없으면 네트워크
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (response) {
        // 유효한 응답이면 캐시에도 저장
        if (response && response.status === 200 && response.type === "basic") {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      });
    })
  );
});
