
/* LINEAGE W Boss Push - 관리자 전용 비공개 기기 등록 */
(() => {
  "use strict";

  // 공개 VAPID 키만 브라우저에 둡니다.
  // 개인키와 CRON 비밀값은 절대 브라우저에 넣지 않습니다.
  const VAPID_PUBLIC_KEY =
    "BNQob9bYmViSiLUGvyD6341725YVJ94X6KUEljuC7D1ic4vmik6RNvyEZzqKsSG38wPhuZX9Yj_KYZ-6wYk10GA";

  let busy = false;
  let lastUserId = null;
  let button = null;
  let status = null;
  let refreshTimer = null;

  function getAppGlobals() {
    try {
      return { db: db, user: user, profile: profile };
    } catch (_) {
      return null;
    }
  }

  function base64UrlToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      output[i] = raw.charCodeAt(i);
    }

    return output;
  }

  function isAdminApp(app) {
    // 승인 여부와 본인 소유 여부는 Supabase RLS가 최종 확인합니다.
    return !!(app && app.user && app.profile);
  }

  function ensureControls() {
    // 로그인 회원 모두 개인 알림 버튼 옆에 본인 기기 등록 UI를 표시합니다.
    const app = getAppGlobals();
    if (!isAdminApp(app)) return;

    const anchorButton = document.getElementById("personalAlertBtn");
    if (!anchorButton || button) return;

    button = document.createElement("button");
    button.id = "bossPushBtn";
    button.className = "ghost";
    button.type = "button";
    button.textContent = "휴대폰 알림 확인 중";
    button.addEventListener("click", togglePush);

    anchorButton.insertAdjacentElement("afterend", button);

    status = document.createElement("div");
    status.id = "bossPushStatus";
    status.className = "sub";
    status.style.marginTop = "7px";
    status.style.display = "none";

    anchorButton.parentElement.parentElement.appendChild(status);
  }

  function showStatus(message, visible = true) {
    if (!status) return;

    status.textContent = message;
    status.style.display = visible ? "block" : "none";
  }

  function appIsVisible() {
    const appElement = document.getElementById("app");

    return !!appElement &&
      getComputedStyle(appElement).display !== "none";
  }

  async function getCurrentSubscription() {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      throw new Error("이 브라우저는 웹 푸시를 지원하지 않습니다.");
    }

    const registration = await navigator.serviceWorker.getRegistration();

    return registration
      ? await registration.pushManager.getSubscription()
      : null;
  }

  async function getDeviceRow(app, subscription) {
    const { data, error } = await app.db
      .from("push_subscriptions")
      .select("enabled")
      .eq("user_id", app.user.id)
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();

    if (error) throw error;

    return data;
  }

  async function refreshButton() {
    ensureControls();
    if (!button) return;

    const app = getAppGlobals();

    const memberSignedIn = !!(
      app &&
      app.user &&
      isAdminApp(app) &&
      appIsVisible()
    );

    // 본인 기기의 푸시 등록 상태만 노출합니다.
    button.style.display = memberSignedIn ? "inline-block" : "none";

    if (status) {
      status.style.display = memberSignedIn ? "block" : "none";
    }

    if (!memberSignedIn) {
      lastUserId = null;
      return;
    }

    if (lastUserId !== app.user.id) {
      lastUserId = app.user.id;
      showStatus("이 기기의 푸시 등록 상태를 확인하고 있습니다.");
    }

    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      button.disabled = true;
      button.textContent = "푸시 미지원 브라우저";

      showStatus("현재 브라우저에서는 휴대폰 푸시를 사용할 수 없습니다.");
      return;
    }

    try {
      const subscription = await getCurrentSubscription();

      if (!subscription) {
        button.disabled = false;
        button.textContent = "이 기기 푸시 등록하기";

        showStatus(
          Notification.permission === "denied"
            ? "브라우저 알림 권한이 차단되어 있습니다. 사이트 설정에서 알림을 허용해 주세요."
            : "이 기기를 푸시 수신 기기로 등록할 수 있습니다."
        );

        return;
      }

      const row = await getDeviceRow(app, subscription);
      const enabled = !!row?.enabled;

      button.disabled = false;
      button.textContent = enabled
        ? "이 기기 푸시 등록 해제"
        : "이 기기 푸시 등록하기";

      const settingsResult = await app.db
        .from("user_alert_settings")
        .select("push_enabled")
        .eq("user_id", app.user.id)
        .maybeSingle();

      let accountPushEnabled = null;

      if (!settingsResult.error) {
        accountPushEnabled = !!settingsResult.data?.push_enabled;
      }

      if (!enabled) {
        showStatus("기기는 등록되어 있지만 이 기기의 푸시는 꺼져 있습니다.");
      } else if (accountPushEnabled === false) {
        showStatus(
          "기기 등록은 완료됐습니다. 실제 알림을 받으려면 ‘나의 개인 알림 설정’에서 휴대폰 푸시 알림 사용을 켜고 저장하세요."
        );
      } else {
        showStatus("이 기기의 푸시 수신 등록이 켜져 있습니다.");
      }

    } catch (error) {
      button.disabled = false;
      button.textContent = "휴대폰 알림 설정";

      showStatus("푸시 상태 확인 실패: " + (error.message || error));
    }
  }

  async function togglePush() {
    if (busy) return;

    const app = getAppGlobals();

    if (
      !app ||
      !app.user ||
      !isAdminApp(app) ||
      !appIsVisible()
    ) {
      return;
    }

    busy = true;

    if (button) button.disabled = true;

    try {
      if (!("Notification" in window)) {
        throw new Error("이 브라우저는 알림 기능을 지원하지 않습니다.");
      }

      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        throw new Error("이 브라우저는 웹 푸시를 지원하지 않습니다.");
      }

      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();

        if (permission !== "granted") {
          throw new Error("브라우저 알림 권한을 허용해야 합니다.");
        }

      } else if (Notification.permission === "denied") {
        throw new Error(
          "브라우저 설정에서 이 사이트의 알림 권한을 먼저 허용해 주세요."
        );
      }

      const registration = await navigator.serviceWorker.register("./sw.js?v=20261127-4", { updateViaCache: "none" });

      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const row = await getDeviceRow(app, subscription);

        if (row?.enabled) {
          const { error } = await app.db
            .from("push_subscriptions")
            .update({
              enabled: false,
              updated_at: new Date().toISOString()
            })
            .eq("user_id", app.user.id)
            .eq("endpoint", subscription.endpoint);

          if (error) throw error;

          showStatus(
            "이 기기의 푸시 수신 등록을 해제했습니다. 다른 기기의 설정에는 영향이 없습니다."
          );

        } else {
          const { error } = await app.db
            .from("push_subscriptions")
            .upsert({
              user_id: app.user.id,
              endpoint: subscription.endpoint,
              subscription: subscription.toJSON(),
              enabled: true,
              updated_at: new Date().toISOString()
            }, {
              onConflict: "endpoint"
            });

          if (error) throw error;

          showStatus("이 기기의 푸시 수신 등록을 켰습니다.");
        }

      } else {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY)
        });

        const { error } = await app.db
          .from("push_subscriptions")
          .upsert({
            user_id: app.user.id,
            endpoint: subscription.endpoint,
            subscription: subscription.toJSON(),
            enabled: true,
            updated_at: new Date().toISOString()
          }, {
            onConflict: "endpoint"
          });

        if (error) {
          await subscription.unsubscribe().catch(() => {});
          throw error;
        }

        showStatus("이 기기의 푸시 등록이 완료됐습니다.");
      }

      await refreshButton();

    } catch (error) {
      console.error("Boss push setup error:", error);

      alert("휴대폰 알림 설정 실패: " + (error.message || error));

    } finally {
      busy = false;

      if (button) button.disabled = false;

      await refreshButton();
    }
  }

  ensureControls();
  refreshButton();

  if (!refreshTimer) {
    refreshTimer = window.setInterval(refreshButton, 5000);
  }

})();
