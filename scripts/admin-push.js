import { supabase } from "./config.js";

const panel = document.getElementById("admin-push-panel");
const status = document.getElementById("admin-push-status");
const iphoneEnableButton = document.getElementById(
  "admin-push-enable-iphone"
);
const pcEnableButton = document.getElementById("admin-push-enable-pc");
const testButton = document.getElementById("admin-push-test");
const disableButton = document.getElementById("admin-push-disable");

let serviceWorkerRegistration = null;
let activeSubscription = null;
let initialized = false;
let busy = false;
let subscriptionEnabled = false;

function isIOS() {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

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

function setBusy(nextBusy) {
  refreshButtons(nextBusy);
}

function refreshButtons(nextBusy = busy) {
  busy = nextBusy;
  const ios = isIOS();

  iphoneEnableButton.disabled = busy || subscriptionEnabled || !ios;
  pcEnableButton.disabled = busy || subscriptionEnabled || ios;
  iphoneEnableButton.textContent =
    subscriptionEnabled && ios
      ? "아이폰 알림 사용 중"
      : "아이폰 알림 켜기";
  pcEnableButton.textContent =
    subscriptionEnabled && !ios
      ? "PC 알림 사용 중"
      : "PC 알림 켜기";
  testButton.hidden = !subscriptionEnabled;
  disableButton.hidden = !subscriptionEnabled;
  testButton.disabled = busy;
  disableButton.disabled = busy;
}

function updateButtons(enabled) {
  subscriptionEnabled = enabled;
  refreshButtons(false);
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
    let serverMessage = "";

    try {
      if (error.context instanceof Response) {
        const body = await error.context.clone().json();
        serverMessage = body?.error ?? "";
      }
    } catch {
      serverMessage = "";
    }

    if (serverMessage) {
      throw new Error(serverMessage);
    }

    const rawMessage = String(error.message ?? "");

    if (
      rawMessage.includes("Failed to send a request") ||
      error.name === "FunctionsFetchError"
    ) {
      throw new Error(
        "알림 서버에 연결하지 못했습니다. admin-push Edge Function을 최신 파일로 다시 배포한 뒤 새로고침해 주세요."
      );
    }

    throw new Error(rawMessage || "알림 서버에 연결하지 못했습니다.");
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

async function enablePush(target) {
  setBusy(true);

  try {
    if (target === "iphone" && !isIOS()) {
      throw new Error(
        "아이폰 알림은 아이폰에서 관리자 페이지를 열어 등록해 주세요."
      );
    }

    if (target === "pc" && isIOS()) {
      throw new Error(
        "PC 알림은 알림을 받을 PC의 Chrome 또는 Edge에서 관리자 페이지를 열어 등록해 주세요."
      );
    }

    if (target === "iphone" && !isStandalone()) {
      throw new Error(
        "아이폰 Safari의 공유 버튼에서 ‘홈 화면에 추가’한 뒤, 홈 화면 아이콘으로 관리자 페이지를 실행해 주세요."
      );
    }

    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;

    if (permission !== "granted") {
      throw new Error(
        isIOS()
          ? "아이폰 알림 권한이 허용되지 않았습니다. 설정 → 알림 → 창의융합실 관리에서 알림을 허용해 주세요."
          : "PC 알림 권한이 허용되지 않았습니다. Chrome 또는 Edge의 사이트 알림 설정에서 허용해 주세요."
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
    setStatus(
      isIOS()
        ? "이 아이폰에서 관리자 예약 알림을 사용 중입니다."
        : "이 PC에서 관리자 예약 알림을 사용 중입니다."
    );
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
    setStatus(
      isIOS()
        ? "이 아이폰의 관리자 예약 알림이 꺼졌습니다."
        : "이 PC의 관리자 예약 알림이 꺼졌습니다."
    );
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
      throw new Error("먼저 현재 기기의 관리자 예약 알림을 켜 주세요.");
    }

    await invokePushFunction("test", {
      endpoint: activeSubscription.endpoint
    });
    setStatus(
      isIOS()
        ? "시험 알림을 전송했습니다. 아이폰 알림센터를 확인해 주세요."
        : "시험 알림을 전송했습니다. Windows 알림센터를 확인해 주세요."
    );
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
  iphoneEnableButton.addEventListener("click", () => {
    enablePush("iphone");
  });
  pcEnableButton.addEventListener("click", () => {
    enablePush("pc");
  });
  testButton.addEventListener("click", sendTestPush);
  disableButton.addEventListener("click", disablePush);

  if (!isPushSupported()) {
    updateButtons(false);
    iphoneEnableButton.disabled = true;
    pcEnableButton.disabled = true;
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
      setStatus(
        isIOS()
          ? "이 아이폰에서 관리자 예약 알림을 사용 중입니다."
          : "이 PC에서 관리자 예약 알림을 사용 중입니다."
      );
    } else if (Notification.permission === "denied") {
      setStatus(
        isIOS()
          ? "알림이 차단되어 있습니다. 설정 → 알림 → 창의융합실 관리에서 허용해 주세요."
          : "알림이 차단되어 있습니다. Chrome 또는 Edge의 사이트 알림 설정에서 허용해 주세요.",
        true
      );
    } else if (isIOS() && !isStandalone()) {
      setStatus(
        "아이폰에서는 관리자 페이지를 홈 화면에 추가한 뒤 아이콘으로 실행해 주세요."
      );
    } else if (isIOS()) {
      setStatus("‘아이폰 알림 켜기’를 눌러 관리자 예약 알림을 등록해 주세요.");
    } else {
      setStatus("‘PC 알림 켜기’를 눌러 이 PC의 관리자 예약 알림을 등록해 주세요.");
    }
  } catch (error) {
    updateButtons(false);
    setStatus(`알림 준비 오류: ${error.message}`, true);
  }
}
