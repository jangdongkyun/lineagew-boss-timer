
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
    // 별도 버튼을 만들지 않고 개인 메뉴의 푸시 ON/OFF 버튼 하나를 사용합니다.
    const app = getAppGlobals();
    if (!isAdminApp(app)) return;

    button = document.getElementById("pushMasterBtn");
    if (!button) return;

    if (!status) {
      status = document.getElementById("bossPushStatus");
      if (!status) {
        status = document.createElement("div");
        status.id = "bossPushStatus";
        status.className = "sub";
        status.style.marginTop = "7px";
        status.style.display = "none";
        button.parentElement.parentElement.appendChild(status);
      }
    }
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
      button.textContent = "푸시 OFF";
      button.classList.remove("is-on");
      button.classList.add("is-off");

      showStatus("현재 브라우저에서는 휴대폰 푸시를 사용할 수 없습니다.");
      return;
    }

    try {
      const subscription = await getCurrentSubscription();

      if (!subscription) {
        button.disabled = false;
        button.textContent = "푸시 OFF";
        button.classList.remove("is-on");
        button.classList.add("is-off");

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
      button.textContent = enabled ? "푸시 ON" : "푸시 OFF";
      button.classList.toggle("is-on",enabled);
      button.classList.toggle("is-off",!enabled);

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
      button.textContent = "푸시 OFF";
      button.classList.remove("is-on");
      button.classList.add("is-off");

      showStatus("푸시 상태 확인 실패: " + (error.message || error));
    }
  }

  async function togglePush(desiredEnabled) {
    if (busy) return false;

    const app = getAppGlobals();
    if (!app || !app.user || !isAdminApp(app) || !appIsVisible()) {
      return false;
    }

    busy = true;
    if (button) button.disabled = true;

    try {
      if (desiredEnabled === false) {
        const subscription = await getCurrentSubscription();

        if (subscription) {
          const { error } = await app.db
            .from("push_subscriptions")
            .update({
              enabled: false,
              updated_at: new Date().toISOString()
            })
            .eq("user_id", app.user.id)
            .eq("endpoint", subscription.endpoint);

          if (error) throw error;

          // 서버 수신을 끄고 이 브라우저의 Push 구독도 해제합니다.
          await subscription.unsubscribe().catch(unsubscribeError => {
            console.warn("브라우저 푸시 구독 해제 확인:", unsubscribeError);
            return false;
          });
        }

        showStatus("이 기기의 푸시 수신을 껐습니다.");
      } else {
        if (!("Notification" in window)) {
          throw new Error("이 브라우저는 알림 기능을 지원하지 않습니다.");
        }
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          throw new Error("이 브라우저는 웹 푸시를 지원하지 않습니다.");
        }

        if (Notification.permission === "default") {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            throw new Error("브라우저 알림 권한을 허용해야 합니다.");
          }
        } else if (Notification.permission === "denied") {
          throw new Error("브라우저 설정에서 이 사이트의 알림 권한을 먼저 허용해 주세요.");
        }

        const registration = await navigator.serviceWorker.register(
          "./sw.js?v=20261127-4",
          { updateViaCache: "none" }
        );
        await navigator.serviceWorker.ready;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY)
          });
        }

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

        showStatus("이 기기의 푸시 수신 등록을 켰습니다.");
      }

      await refreshButton();
      return true;

    } catch (error) {
      console.error("Boss push setup error:", error);
      alert("휴대폰 알림 설정 실패: " + (error.message || error));
      return false;

    } finally {
      busy = false;
      if (button) button.disabled = false;
      await refreshButton();
    }
  }

  // index.html의 단일 푸시 버튼에서 호출하는 공용 동작입니다.
  window.bossPushToggleDevice = togglePush;
  window.bossPushRefresh = refreshButton;

  ensureControls();
  refreshButton();

  if (!refreshTimer) {
    refreshTimer = window.setInterval(refreshButton, 5000);
  }

})();
