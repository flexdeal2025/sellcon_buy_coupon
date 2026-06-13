"use client";

/**
 * 클라이언트에서 /api/notify 를 호출하는 헬퍼.
 * 알림 실패가 핵심 흐름(저장)을 막지 않도록 에러를 삼킵니다.
 */
export async function sendTelegram(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* 알림 실패는 무시 */
  }
}
