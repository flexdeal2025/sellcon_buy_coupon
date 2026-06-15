"use client";

/**
 * 클라이언트에서 /api/notify 를 호출하는 헬퍼.
 * 알림 실패가 핵심 흐름(저장)을 막지 않도록 에러를 삼킵니다.
 */
export async function sendTelegram(payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; skipped?: boolean; error?: string; reason?: string };
    if (!data.ok) {
      if (data.skipped) {
        console.info("[Telegram] 알림 건너뜀 —", data.reason ?? "환경변수 미설정");
      } else {
        console.warn("[Telegram] 알림 발송 실패 —", data.error ?? "알 수 없는 오류");
      }
    }
  } catch (e) {
    console.warn("[Telegram] /api/notify 요청 실패:", e);
  }
}
