/* =============================================
   ハレタス - service-worker.js
   ============================================= */

'use strict';

/* =============================================
   ★ バージョン管理
   更新時はここだけ変更する。CACHE_NAME は自動生成される。
   例: 'haretasu-v1.0.7', 'haretasu-v2.0.0'
   ============================================= */
const SW_VERSION  = 'haretasu-v1.0.7';          // ← 更新時はここだけ変える
const CACHE_NAME  = `cache-${SW_VERSION}`;       // 'cache-haretasu-v1.0.7'
const CACHE_PREFIX = 'cache-haretasu-';          // 自分のキャッシュだけを削除対象にする

const DB_NAME     = 'haretasu_db';
const NOTIF_STORE = 'notifications';

/* キャッシュするリソース */
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

/* =============================================
   インストール：リソースをキャッシュ → 即座に待機解除
   ============================================= */
self.addEventListener('install', (event) => {
  console.log(`[SW] install: ${SW_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => {
        // 旧 SW が控えていても即座にこの SW を有効化する
        return self.skipWaiting();
      })
  );
});

/* =============================================
   アクティベート：古いキャッシュを自動削除 → 全クライアントを即制御
   ============================================= */
self.addEventListener('activate', (event) => {
  console.log(`[SW] activate: ${SW_VERSION}`);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          // 自分のアプリのキャッシュ（cache-haretasu-*）かつ今のバージョン以外を削除
          .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map(k => {
            console.log(`[SW] 古いキャッシュを削除: ${k}`);
            return caches.delete(k);
          })
      ))
      // 新しい SW がすでに開いているページも即座に制御する
      .then(() => self.clients.claim())
      .then(() => {
        // 全クライアントに「更新完了」を通知する
        return self.clients.matchAll({ type: 'window' });
      })
      .then(clientList => {
        clientList.forEach(client => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: SW_VERSION,
          });
        });
      })
  );
});

/* =============================================
   フェッチ：キャッシュファースト戦略
   ============================================= */
self.addEventListener('fetch', (event) => {
  // GET 以外（POST 等）は SW を通さない
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
            return response;
          })
          .catch(() => caches.match('./index.html'));
      })
  );
});

/* =============================================
   メッセージ受信（アプリ → SW）
   ============================================= */
self.addEventListener('message', async (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    // アプリ側から「今すぐ適用して」と要求されたとき
    case 'SKIP_WAITING':
      console.log('[SW] SKIP_WAITING 受信 → skipWaiting()');
      await self.skipWaiting();
      break;

    // 現在のバージョンを問い合わせ
    case 'GET_VERSION':
      event.source?.postMessage({
        type: 'SW_VERSION',
        version: SW_VERSION,
      });
      break;

    case 'SCHEDULE_NOTIFICATIONS':
    case 'CHECK_NOTIFICATIONS':
      await _scheduleFromDB();
      break;

    default:
      break;
  }
});

/* =============================================
   IndexedDB ヘルパー（SW 内）
   ============================================= */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(NOTIF_STORE)) {
        db.createObjectStore(NOTIF_STORE, { keyPath: 'id' });
      }
    };
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function deleteFromStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/* =============================================
   通知スケジューリング

   ⚠️ 重要な制限事項：
   PWA の Service Worker はバックグラウンドで常時起動しているわけではありません。
   Push 通知（プッシュサーバー経由）なしでは、アプリを開いていないときに
   任意のタイミングで通知を発火させることは技術的に不可能です。

   この実装では：
   - アプリが開いている間：定期的に DB 確認 → 時刻が来たら通知
   - アプリを閉じた後：Periodic Background Sync（限定的サポート）があれば動作
   - Push 通知サーバーなし：アプリ非アクティブ時の確実な通知は保証できない

   代替案：
   1. Web Push Protocol + プッシュサーバー（Webpushr など）を追加する
   2. アプリ起動時に「今日の通知を確認」し逃した通知をその場で表示する
   ============================================= */

async function _scheduleFromDB() {
  try {
    const db = await openDB();
    const notifs = await getAllFromStore(db, NOTIF_STORE);
    const now = Date.now();

    for (const n of notifs) {
      const delay = n.notifTime - now;
      if (delay < 0) {
        // 逃した通知：1 時間以内なら遅延表示
        if (delay > -3600000) {
          await _showNotification(n);
        }
        await deleteFromStore(db, NOTIF_STORE, n.id);
        continue;
      }
      if (delay <= 60000) {
        // 1 分以内：setTimeout で即時スケジュール
        setTimeout(async () => {
          await _showNotification(n);
          const db2 = await openDB();
          await deleteFromStore(db2, NOTIF_STORE, n.id);
        }, delay);
      }
    }
  } catch (err) {
    console.warn('[SW] 通知スケジュールエラー:', err);
  }
}

async function _showNotification(n) {
  try {
    await self.registration.showNotification(n.title, {
      body:    n.body,
      icon:    './icon-192.png',
      badge:   './icon-192.png',
      tag:     n.tag || n.id,
      vibrate: [200, 100, 200],
      data:    { url: './' },
      actions: [
        { action: 'open',    title: '開く' },
        { action: 'dismiss', title: '閉じる' },
      ],
    });
  } catch (err) {
    console.warn('[SW] 通知表示エラー:', err);
  }
}

/* =============================================
   通知クリック
   ============================================= */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            return;
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

/* =============================================
   Periodic Background Sync（サポート環境のみ）
   Chrome 80+ Android で利用可能。iOS Safari は非対応。
   ============================================= */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'haretasu-check-notifications') {
    event.waitUntil(_scheduleFromDB());
  }
});

/* =============================================
   Push 通知受信（将来プッシュサーバー実装時用）
   ============================================= */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'ハレタス', {
      body:    data.body || '',
      icon:    './icon-192.png',
      badge:   './icon-192.png',
      tag:     data.tag || 'haretasu-push',
      vibrate: [200, 100, 200],
      data:    { url: './' },
    })
  );
});

/* =============================================
   定期チェック（アプリがフォアグラウンドのとき）
   SW が起動中なら 5 分ごとに通知確認
   ============================================= */
setInterval(async () => {
  await _scheduleFromDB();
}, 5 * 60 * 1000);

// 起動時に即チェック
_scheduleFromDB();
