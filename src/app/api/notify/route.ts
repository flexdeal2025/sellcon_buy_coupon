import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface NotifyPayload {
  type?: "new_purchase" | "status_change" | "custom";
  text?: string; // custom 메시지 직접 전달 시
  // 구조화 메시지용 필드
  supplier?: string;
  product_name?: string;
  ordered_quantity?: number;
  status?: string;
  worker?: string;
  sequences?: string; // "#21~#35"
  total_price?: number;
  note?: string;
}

function buildMessage(p: NotifyPayload): string {
  if (p.text) return p.text;

  if (p.type === "new_purchase") {
    const lines = [
      "🆕 *신규 매입 등록*",
      `🏬 매입처: ${esc(p.supplier)}`,
      `🎁 상품: ${esc(p.product_name)}`,
      p.ordered_quantity ? `📦 주문수량: ${p.ordered_quantity.toLocaleString()}개` : "",
      p.sequences ? `📱 회선: ${esc(p.sequences)}` : "",
      p.total_price
        ? `💰 총 매입액: ₩${Math.round(p.total_price).toLocaleString()}`
        : "",
      p.worker ? `🙋 작업자: ${esc(p.worker)}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  if (p.type === "status_change") {
    const emoji = p.status === "이슈발생" ? "🚨" : p.status === "완료" ? "✅" : "🔄";
    const lines = [
      `${emoji} *상태 변경: ${esc(p.status)}*`,
      `🏬 매입처: ${esc(p.supplier)}`,
      `🎁 상품: ${esc(p.product_name)}`,
      p.worker ? `🙋 변경자: ${esc(p.worker)}` : "",
      p.note ? `📝 ${esc(p.note)}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  return "📢 알림";
}

// Telegram MarkdownV2 특수문자 이스케이프는 복잡하므로 일반 Markdown 모드 사용.
// Markdown(legacy) 모드에서 문제되는 최소한의 문자만 정리.
function esc(s?: string | null): string {
  return (s ?? "").replace(/[_*`[\]]/g, " ").trim();
}

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  let payload: NotifyPayload;
  try {
    payload = (await req.json()) as NotifyPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (!token || !chatId) {
    // 환경변수 미설정 시: 앱 흐름을 막지 않도록 200 + skipped 반환
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정",
    });
  }

  const message = buildMessage(payload);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return NextResponse.json(
        { ok: false, error: data.description ?? "telegram error" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
