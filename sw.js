/* LINEAGE W Boss Push Service Worker */
self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: "LINEAGE W 보스 알림", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "LINEAGE W 보스 알림";
  const options = {
    body: payload.body || "보스 출현 알림입니다.",
    tag: payload.tag || "lineagew-boss",
    renotify: true,
    data: {
      url: payload.url || "https://jangdongkyun.github.io/lineagew-boss-timer/"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ||
    "https://jangdongkyun.github.io/lineagew-boss-timer/";

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(targetUrl);
  })());
});

self.addEventListener("notificationclose", () => {});
