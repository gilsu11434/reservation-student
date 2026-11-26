self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      body: event.data ? event.data.text() : "새로운 예약 알림이 있습니다."
    };
  }

  const title = payload.title || "창의융합프로젝트실 관리자";
  const options = {
    body: payload.body || "새로운 예약 알림이 있습니다.",
    icon: "./icons/admin-app-icon-192.png",
    badge: "./icons/admin-app-icon-192.png",
    tag: payload.tag || "admin-reservation-notification",
    data: {
      url: payload.url || "./admin.html"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "./admin.html",
    self.registration.scope
  ).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }

    return clients.openWindow(targetUrl);
  })());
});
