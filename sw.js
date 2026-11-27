
/* LINEAGE W Boss Push Service Worker */

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

  // 보스 이름이 있으면 알림 제목에 표시
  const bossName = payload.bossName || payload.boss_name || "";

  const title = bossName
    ? `${bossName} 보스 알림`
    : (payload.title || "LINEAGE W 보스 알림");

  const options = {
    body: payload.body || "보스 출현 알림입니다.",
    tag: payload.tag || "lineagew-boss",
    renotify: true,
    data: {
      url: payload.url || "https://jangdongkyun.github.io/lineagew-boss-timer/"
    }
  };

  // 알림마다 고유 ID를 부여해 3분 뒤 해당 알림만 닫을 수 있게 한다.
  const notificationId = (self.crypto && self.crypto.randomUUID)
    ? self.crypto.randomUUID()
    : String(Date.now()) + "-" + Math.random().toString(36).slice(2);

  options.data.notificationId = notificationId;

  // 알림 표시 후 서비스 워커를 유지하며 3분 뒤 해당 알림을 자동으로 닫는다.
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);

    await new Promise(resolve => setTimeout(resolve, 3 * 60 * 1000));

    const notifications = await self.registration.getNotifications();
    for (const notification of notifications) {
      if (notification.data?.notificationId === notificationId) {
        notification.close();
      }
    }
  })());
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
