/* LINEAGE W Boss Push Service Worker
 * 푸시 알림은 사용자가 직접 닫을 때까지 유지합니다.
 */
self.addEventListener("push", event => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {
      title: "LINEAGE W 보스 알림",
      body: event.data ? event.data.text() : ""
    };
  }

  const bossName = payload.bossName || payload.boss_name || "";
  const title = bossName
    ? `${bossName} 보스 알림`
    : (payload.title || "LINEAGE W 보스 알림");

  const iconUrl = new URL("assets/pwa-icon-512.png", self.registration.scope).href;
  const options = {
    body: payload.body || "보스 출현 알림입니다.",
    tag: payload.tag || "lineagew-boss",
    renotify: true,
    requireInteraction: true,
    vibrate: [250, 100, 250],
    icon: iconUrl,
    badge: iconUrl,
    data: {
      url: payload.url || "https://jangdongkyun.github.io/lineagew-boss-timer/"
    }
  };

  // 자동 닫힘 타이머를 두지 않습니다. 사용자가 직접 알림을 닫습니다.
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  const targetUrl = event.notification.data?.url ||
    "https://jangdongkyun.github.io/lineagew-boss-timer/";

  event.waitUntil((async () => {
    const windows = await clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();

        if ("navigate" in client) {
          await client.navigate(targetUrl);
        }

        return;
      }
    }

    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});

self.addEventListener("notificationclose", () => {});
