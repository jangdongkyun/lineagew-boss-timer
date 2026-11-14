/* LINEAGE W Boss Push - 관리자 전용 휴대폰 푸시 */
(() => {
  "use strict";

  // 공개 VAPID 키만 브라우저에 둡니다. 개인키/CRON 비밀값은 절대 넣지 않습니다.
  const VAPID_PUBLIC_KEY =
    "BNQob9bYmViSiLUGvyD6341725YVJ94X6KUEljuC7D1ic4vmik6RNvyEZzqKsSG38wPhuZX9Yj_KYZ-6wYk10GA";

  let busy = false;
  let lastUserId = null;
  let button = null;
  let status = null;

  function getAppGlobals() {
    try {
      return {
        db: db,
        user: user,
        profile: profile,
        isAdmin: typeof isAdmin === "function" ? isAdmin() : false
      };
    } catch (_) {
      return null;
    }
  }

  function base64UrlToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  function ensureControls() {
    const soundButton = document.getElementById("soundBtn");
    if (!soundButton) return;

    if (!button) {
      button = document.createElement("button");
      button.id = "bossPushBtn";
      button.className = "ghost";
      button.type = "button";
      button.textContent = "휴대폰 알림 확인 중";
      button.addEventListener("click", togglePush);
      soundButton.insertAdjacentElement("afterend", button);

      status = document.createElement("div");
      status.id = "bossPushStatus";
      status.className = "sub";
      status.style.marginTop = "7px";
      status.style.display = "none";
      soundButton.parentElement.parentElement.appendChild(status);
    }
  }

  function showStatus(text, visible = true) {
    if (!status) return;
    status.textContent = text;
    status.style.display = visible ? "block" : "none";
  }

  async function getCurrentSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("이 브라우저는 웹 푸시를 지원하지 않습니다.");
    }
    // 상태 확인만 할 때는 서비스 워커를 반복 등록하거나 네트워크 요청하지 않습니다.
    const registration = await navigator.serviceWorker.getRegistration();
    return registration ? await registration.pushManager.getSubscription() : null;
  }

  async function refreshButton() {
    ensureControls();
    if (!button) return;

    const app = getAppGlobals();
    const appVisible = document.getElementById("app")?.style.display !== "none";
    const admin = !!(app && app.user && app.profile && app.isAdmin && appVisible);

    // 관리자 계정이 아니면 버튼과 상태 문구를 모두 숨깁니다.
    button.style.display = admin ? "inline-block" : "none";
    if (status) status.style.display = admin ? "block" : "none";
    if (!admin) {
      lastUserId = null;
      return;
    }

    if (lastUserId !== app.user.id) {
      lastUserId = app.user.id;
      showStatus("이 기기의 푸시 등록 상태를 확인하고 있습니다.");
    }

    if (!("Notification" in window)) {
      button.disabled = true;
      button.textContent = "푸시 미지원 브라우저";
      showStatus("현재 브라우저에서는 휴대폰 푸시를 사용할 수 없습니다.");
      return;
    }

    try {
      const subscription = await getCurrentSubscription();
      if (!subscription) {
        button.disabled = false;
        button.textContent = "휴대폰 알림 켜기";
        showStatus(Notification.permission === "denied"
          ? "브라우저 알림 권한이 차단되어 있습니다. 브라우저 사이트 설정에서 알림을 허용해 주세요."
          : "이 관리자 기기에서 휴대폰 알림을 켤 수 있습니다.");
        return;
      }

      const { data, error } = await app.db
        .from("push_subscriptions")
        .select("enabled")
        .eq("user_id", app.user.id)
        .eq("endpoint", subscription.endpoint)
        .maybeSingle();

      if (error) throw error;

      const enabled = !!data?.enabled;
      button.disabled = false;
      button.textContent = enabled ? "휴대폰 알림 끄기" : "휴대폰 알림 켜기";
      showStatus(enabled
        ? "이 관리자 기기의 휴대폰 푸시 알림이 켜져 있습니다."
        : "기기는 등록되어 있지만 푸시 알림은 꺼져 있습니다.");
    } catch (error) {
      button.disabled = false;
      button.textContent = "휴대폰 알림 설정";
      showStatus("푸시 상태 확인 실패: " + (error.message || error));
    }
  }

  async function togglePush() {
    if (busy) return;
    const app = getAppGlobals();
    if (!app || !app.user || !app.profile || !app.isAdmin) {
      alert("관리자 계정에서만 사용할 수 있습니다.");
      return;
    }

    busy = true;
    if (button) button.disabled = true;

    try {
      if (!("Notification" in window)) {
        throw new Error("이 브라우저는 알림 기능을 지원하지 않습니다.");
      }

      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          throw new Error("브라우저 알림 권한을 허용해야 합니다.");
        }
      } else if (Notification.permission === "denied") {
        throw new Error("브라우저 설정에서 이 사이트의 알림 권한을 먼저 허용해 주세요.");
      }

      const registration = await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const { data } = await app.db
          .from("push_subscriptions")
          .select("enabled")
          .eq("user_id", app.user.id)
          .eq("endpoint", subscription.endpoint)
          .maybeSingle();

        if (data?.enabled) {
          const { error } = await app.db
            .from("push_subscriptions")
            .update({
              enabled: false,
              updated_at: new Date().toISOString()
            })
            .eq("user_id", app.user.id)
            .eq("endpoint", subscription.endpoint);
          if (error) throw error;
          showStatus("이 관리자 기기의 휴대폰 푸시 알림을 껐습니다.");
        } else {
          const { error } = await app.db
            .from("push_subscriptions")
            .upsert({
              user_id: app.user.id,
              endpoint: subscription.endpoint,
              subscription: subscription.toJSON(),
              enabled: true,
              updated_at: new Date().toISOString()
            }, { onConflict: "endpoint" });
          if (error) throw error;
          showStatus("이 관리자 기기의 휴대폰 푸시 알림을 켰습니다.");
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
          }, { onConflict: "endpoint" });
        if (error) {
          await subscription.unsubscribe().catch(() => {});
          throw error;
        }
        showStatus("이 관리자 기기의 푸시 등록이 완료됐습니다.");
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

  // 기존 index.html은 수정 범위를 최소화하기 위해 별도 파일에서 관리자 상태를 감시합니다.
  ensureControls();
  refreshButton();
  window.setInterval(refreshButton, 5000);
})();
