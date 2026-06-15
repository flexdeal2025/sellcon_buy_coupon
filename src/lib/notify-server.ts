/**
 * 서버(Route Handler / Cron) 전용 텔레그램 직접 발송.
 * 클라이언트에서는 /api/notify 경유 sendTelegram() 을 사용하세요.
 */
export async function sendTelegramDirect(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.info("[Telegram-Server] 환경변수 미설정, 건너뜀");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) console.warn("[Telegram-Server] 발송 실패:", data.description);
  } catch (e) {
    console.warn("[Telegram-Server] 요청 오류:", e);
  }
}
