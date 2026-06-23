/**
 * 서버(Route Handler / Cron) 전용 텔레그램 직접 발송.
 * 클라이언트에서는 /api/notify 경유 sendTelegram() 을 사용하세요.
 */
export interface TelegramResult { ok: boolean; skipped?: boolean; description?: string }

export async function sendTelegramDirect(
  text: string,
  opts?: { parseMode?: "Markdown" | "HTML" | null; chatId?: string; token?: string },
): Promise<TelegramResult> {
  const token = opts?.token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = opts?.chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.info("[Telegram-Server] 환경변수 미설정, 건너뜀");
    return { ok: false, skipped: true, description: `미설정(token:${!!token}, chatId:${!!chatId})` };
  }
  // parseMode 미지정 시 Markdown(기존 호환). null 이면 평문(특수문자·URL 안전).
  const parseMode = opts && "parseMode" in opts ? opts.parseMode : "Markdown";
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        disable_web_page_preview: true,
      }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) console.warn("[Telegram-Server] 발송 실패:", data.description);
    return { ok: data.ok, description: data.description };
  } catch (e) {
    console.warn("[Telegram-Server] 요청 오류:", e);
    return { ok: false, description: e instanceof Error ? e.message : "요청 오류" };
  }
}
