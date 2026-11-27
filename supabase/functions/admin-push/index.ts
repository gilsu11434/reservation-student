import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import webpush from "web-push";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:gilsu8213@cau.ac.kr";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const serviceClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type ReservationRow = {
  id: string;
  start_at: string;
  end_at: string;
  effective_end_at: string | null;
  approval_status: string | null;
  status: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function getSeoulParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function formatSeoulTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
}

function getApprovalLabel(value: string | null) {
  if (value === "approved") return "승인 완료";
  if (value === "rejected") return "승인 거절";
  return "승인 대기";
}

async function requireApprovedAdmin(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";

  if (!authorization.startsWith("Bearer ")) {
    throw new Error("로그인이 필요합니다.");
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await userClient.auth.getUser();

  if (error || !data.user) {
    throw new Error("관리자 로그인을 확인하지 못했습니다.");
  }

  const { data: role, error: roleError } = await serviceClient
    .from("user_roles")
    .select("role, is_approved")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (
    roleError ||
    role?.role !== "admin" ||
    role?.is_approved !== true
  ) {
    throw new Error("승인된 관리자만 알림을 사용할 수 있습니다.");
  }

  return data.user;
}

async function getApprovedAdminSubscriptions() {
  const { data: subscriptions, error } = await serviceClient
    .from("admin_push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("enabled", true);

  if (error) throw error;
  if (!subscriptions?.length) return [] as SubscriptionRow[];

  const userIds = [...new Set(subscriptions.map((item) => item.user_id))];
  const { data: roles, error: roleError } = await serviceClient
    .from("user_roles")
    .select("user_id")
    .in("user_id", userIds)
    .eq("role", "admin")
    .eq("is_approved", true);

  if (roleError) throw roleError;
  const approvedIds = new Set((roles ?? []).map((role) => role.user_id));

  return subscriptions.filter((item) => approvedIds.has(item.user_id));
}

async function sendOnce(
  subscription: SubscriptionRow,
  eventKey: string,
  payload: Record<string, unknown>
) {
  const { error: claimError } = await serviceClient
    .from("admin_push_delivery_log")
    .insert({
      subscription_id: subscription.id,
      event_key: eventKey,
      status: "claimed"
    });

  if (claimError?.code === "23505") return false;
  if (claimError) throw claimError;

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth
        }
      },
      JSON.stringify(payload),
      { TTL: 300 }
    );

    await serviceClient
      .from("admin_push_delivery_log")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("subscription_id", subscription.id)
      .eq("event_key", eventKey);
    return true;
  } catch (error) {
    const statusCode = Number(
      (error as { statusCode?: number }).statusCode ?? 0
    );

    if (statusCode === 404 || statusCode === 410) {
      await serviceClient
        .from("admin_push_subscriptions")
        .delete()
        .eq("id", subscription.id);
    } else {
      await serviceClient
        .from("admin_push_delivery_log")
        .delete()
        .eq("subscription_id", subscription.id)
        .eq("event_key", eventKey);
    }

    throw error;
  }
}

async function sendTest(request: Request, endpoint: string) {
  const user = await requireApprovedAdmin(request);
  const { data: subscription, error } = await serviceClient
    .from("admin_push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("user_id", user.id)
    .eq("endpoint", endpoint)
    .eq("enabled", true)
    .maybeSingle();

  if (error || !subscription) {
    throw new Error("등록된 아이폰 알림 정보를 찾지 못했습니다.");
  }

  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    },
    JSON.stringify({
      title: "창의융합프로젝트실 관리자",
      body: "이 기기의 관리자 예약 알림이 팝업으로 정상 표시되었습니다.",
      tag: `admin-push-test-${Date.now()}`,
      url: "./admin.html"
    }),
    { TTL: 300 }
  );
}

async function sendDailySummary(
  subscriptions: SubscriptionRow[],
  dateKey: string
) {
  const from = new Date(`${dateKey}T00:00:00+09:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const { data, error } = await serviceClient
    .from("reservations")
    .select("id, start_at, end_at, effective_end_at, approval_status, status")
    .gte("start_at", from.toISOString())
    .lt("start_at", to.toISOString())
    .neq("status", "cancelled")
    .order("start_at", { ascending: true });

  if (error) throw error;
  const reservations = (data ?? []) as ReservationRow[];
  const body = reservations.length === 0
    ? "오늘은 등록된 예약이 없습니다."
    : `오늘 예약 ${reservations.length}건: ` + reservations
      .map((reservation) => {
        const endAt = reservation.effective_end_at || reservation.end_at;
        return `${formatSeoulTime(reservation.start_at)}–${formatSeoulTime(endAt)} ${getApprovalLabel(reservation.approval_status)}`;
      })
      .join(" / ");

  await Promise.allSettled(
    subscriptions.map((subscription) => sendOnce(
      subscription,
      `daily:${dateKey}`,
      {
        title: "오늘의 창의융합실 예약 현황",
        body,
        tag: `admin-daily-${dateKey}`,
        url: "./admin.html"
      }
    ))
  );
}

async function sendTenMinuteReminders(
  subscriptions: SubscriptionRow[],
  now: Date
) {
  const from = new Date(now.getTime() + 9 * 60 * 1000);
  const to = new Date(now.getTime() + 11 * 60 * 1000);
  const { data, error } = await serviceClient
    .from("reservations")
    .select("id, start_at, end_at, effective_end_at, approval_status, status")
    .gte("start_at", from.toISOString())
    .lt("start_at", to.toISOString())
    .neq("status", "cancelled")
    .order("start_at", { ascending: true });

  if (error) throw error;

  for (const reservation of (data ?? []) as ReservationRow[]) {
    const endAt = reservation.effective_end_at || reservation.end_at;
    const body =
      `${formatSeoulTime(reservation.start_at)}–${formatSeoulTime(endAt)} 예약이 ` +
      `10분 후 시작됩니다. (${getApprovalLabel(reservation.approval_status)})`;

    await Promise.allSettled(
      subscriptions.map((subscription) => sendOnce(
        subscription,
        `reminder10:${reservation.id}:${reservation.start_at}`,
        {
          title: "예약 시작 10분 전",
          body,
          tag: `admin-reminder-${reservation.id}`,
          url: "./admin.html"
        }
      ))
    );
  }
}

async function runScheduledPushes() {
  const now = new Date();
  const seoul = getSeoulParts(now);
  const subscriptions = await getApprovedAdminSubscriptions();

  if (subscriptions.length === 0) {
    return { sent: 0, message: "활성화된 관리자 아이폰이 없습니다." };
  }

  if (seoul.hour === 9 && seoul.minute < 5) {
    await sendDailySummary(subscriptions, seoul.dateKey);
  }

  await sendTenMinuteReminders(subscriptions, now);
  return { sent: subscriptions.length };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "POST 요청만 허용됩니다." }, 405);
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !VAPID_PUBLIC_KEY ||
    !VAPID_PRIVATE_KEY
  ) {
    return jsonResponse({ error: "관리자 푸시 서버 환경변수가 설정되지 않았습니다." }, 503);
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  try {
    const body = await request.json();

    if (body.action === "scheduled") {
      if (!CRON_SECRET || request.headers.get("x-cron-secret") !== CRON_SECRET) {
        return jsonResponse({ error: "예약 알림 작업 권한이 없습니다." }, 401);
      }

      return jsonResponse(await runScheduledPushes());
    }

    if (body.action === "config") {
      await requireApprovedAdmin(request);
      return jsonResponse({ publicKey: VAPID_PUBLIC_KEY });
    }

    if (body.action === "test") {
      await sendTest(request, String(body.endpoint ?? ""));
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "알림 요청 종류가 올바르지 않습니다." }, 400);
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      400
    );
  }
});
