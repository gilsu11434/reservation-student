import { supabase } from "./config.js";

const panel = document.getElementById("admin-push-panel");
const status = document.getElementById("admin-push-status");
const enableButton = document.getElementById("admin-push-enable");
const testButton = document.getElementById("admin-push-test");
const disableButton = document.getElementById("admin-push-disable");

let serviceWorkerRegistration = null;
let activeSubscription = null;
let initialized = false;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isPushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function setBusy(busy) {
  enableButton.disabled = busy;
  testButton.disabled = busy;
  disableButton.disabled = busy;
}

function updateButtons(enabled) {
  enableButton.hidden = enabled;
  testButton.hidden = !enabled;
  disableButton.hidden = !enabled;
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const raw = window.atob(base64);

  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function invokePushFunction(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke("admin-push", {
    body: { action, ...extra }
  });

  if (error) {
    throw new Error(error.message || "알림 서버에 연결하지 못했습니다.");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data ?? {};
}

async function isSubscriptionRegistered(subscription) {
  const { data, error } = await supabase.rpc(
    "admin_push_subscription_enabled",
    { p_endpoint: subscription.endpoint }
  );

  if (error) {
    throw error;
  }

  return data === true;
}

async function enablePush() {
  setBusy(true);

  try {
    if (!isStandalone()) {
      throw new Error(
        "아이폰 Safari의 공유 버튼에서 ‘홈 화면에 추가’한 뒤, 홈 화면 아이콘으로 관리자 페이지를 실행해 주세요."
      );
    }

    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;

    if (permission !== "granted") {
      throw new Error(
        "아이폰 알림 권한이 허용되지 않았습니다. 설정 → 알림 → 창의융합실 관리에서 알림을 허용해 주세요."
      );
    }

    const { publicKey } = await invokePushFunction("config");

    if (!publicKey) {
      throw new Error("푸시 공개키가 설정되지 않았습니다.");
    }

    activeSubscription =
      await serviceWorkerRegistration.pushManager.getSubscription() ||
      await serviceWorkerRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

    const subscriptionData = activeSubscription.toJSON();
    const { error } = await supabase.rpc(
      "admin_register_push_subscription",
      {
        p_endpoint: subscriptionData.endpoint,
        p_p256dh: subscriptionData.keys?.p256dh,
        p_auth: subscriptionData.keys?.auth,
        p_user_agent: navigator.userAgent
      }
    );

    if (error) {
      throw error;
    }

    updateButtons(true);
    setStatus("이 아이폰에서 관리자 예약 알림을 사용 중입니다.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function disablePush() {
  setBusy(true);

  try {
    activeSubscription =
      activeSubscription ||
      await serviceWorkerRegistration.pushManager.getSubscription();

    if (activeSubscription) {
      const { error } = await supabase.rpc(
        "admin_unregister_push_subscription",
        { p_endpoint: activeSubscription.endpoint }
      );

      if (error) {
        throw error;
      }

      await activeSubscription.unsubscribe();
    }

    activeSubscription = null;
    updateButtons(false);
    setStatus("이 아이폰의 관리자 예약 알림이 꺼졌습니다.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function sendTestPush() {
  setBusy(true);

  try {
    activeSubscription =
      activeSubscription ||
      await serviceWorkerRegistration.pushManager.getSubscription();

    if (!activeSubscription) {
      throw new Error("먼저 아이폰 알림을 켜 주세요.");
    }

    await invokePushFunction("test", {
      endpoint: activeSubscription.endpoint
    });
    setStatus("시험 알림을 전송했습니다. 아이폰 알림센터를 확인해 주세요.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

export async function initializeAdminPush() {
  if (initialized || !panel) {
    return;
  }

  initialized = true;
  panel.hidden = false;
  enableButton.addEventListener("click", enablePush);
  testButton.addEventListener("click", sendTestPush);
  disableButton.addEventListener("click", disablePush);

  if (!isPushSupported()) {
    updateButtons(false);
    enableButton.disabled = true;
    setStatus(
      "이 기기 또는 브라우저에서는 웹 푸시 알림을 지원하지 않습니다.",
      true
    );
    return;
  }

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register(
      "./service-worker.js",
      { scope: "./" }
    );
    await navigator.serviceWorker.ready;
    activeSubscription =
      await serviceWorkerRegistration.pushManager.getSubscription();

    const registered = activeSubscription
      ? await isSubscriptionRegistered(activeSubscription)
      : false;

    updateButtons(registered);

    if (registered) {
      setStatus("이 아이폰에서 관리자 예약 알림을 사용 중입니다.");
    } else if (Notification.permission === "denied") {
      setStatus(
        "알림이 차단되어 있습니다. 설정 → 알림 → 창의융합실 관리에서 허용해 주세요.",
        true
      );
    } else if (!isStandalone()) {
      setStatus(
        "아이폰에서는 관리자 페이지를 홈 화면에 추가한 뒤 아이콘으로 실행해 주세요."
      );
    } else {
      setStatus("‘아이폰 알림 켜기’를 눌러 관리자 예약 알림을 등록해 주세요.");
    }
  } catch (error) {
    updateButtons(false);
    setStatus(`알림 준비 오류: ${error.message}`, true);
  }
}
