/* ============================================================
   한손 · Service Worker
   앱 파일(HTML/CSS/JS)을 기기에 저장해 오프라인에서도 열리게 합니다.
   데이터(Firebase)는 SW를 거치지 않고 직접 서버와 통신합니다.
   ============================================================ */

// ★ 업데이트 배포 시 이 버전 번호를 올려주세요 (예: v3, v4...)
var CACHE_NAME = "hansohn-v8";

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
  self.skipWaiting();
});

// ── 활성화: 이전 버전 캐시 전부 삭제 ──
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

  // Firebase·Google 요청 → 항상 네트워크 직통
  if (url.includes("firebaseapp.com") ||
      url.includes("firebase.google.com") ||
      url.includes("googleapis.com") ||
      url.includes("gstatic.com") ||
      url.includes("firestore.googleapis.com")) {
    return;
  }

  // HTML 파일 → 네트워크 우선 (항상 최신 버전), 오프라인 시 캐시 사용
  if (e.request.mode === "navigate" || url.endsWith(".html") || url.endsWith("/")) {
    e.respondWith(
      fetch(e.request).then(function (response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
        return response;
      }).catch(function () {
        return caches.match(e.request);
      })
    );
    return;
  }

  // CSS·JS·이미지 → 캐시 우선 (빠른 로딩), 없으면 네트워크 후 캐시 저장
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (response) {
        if (response && response.status === 200 && response.type === "basic") {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
        }
        return response;
      });
    })
  );
});
