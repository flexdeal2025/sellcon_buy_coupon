import { NextResponse } from "next/server";
import { getVivaconSupabase } from "@/lib/supabase/vivacon";
import { sendTelegramDirect } from "@/lib/notify-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const pad = (n: number) => String(n).padStart(2, "0");
const yymmdd = (d: Date) => pad(d.getFullYear() % 100) + pad(d.getMonth() + 1) + pad(d.getDate());

// 유효기간 임박 + 미사용(active) 쿠폰 알림 (gifticon_orders 읽기 전용)
//  - 실행 시점 기준 유효기간 minDays~maxDays(기본 7~14일) 남은 건
//  - status='active'(미사용)만 — 다음 실행에 used로 바뀐 건은 자동 제외
//  - 목적: 유효기간 임박했는데 고객이 아직 안 쓴(특히 미열람) 건 사전 식별
//  - 매일 0시 크론 호출 권장. ?notify=0 으로 조회만.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    // 외부 크론(cron-job.org) 호출 보호: CRON_SECRET 설정 시 key 일치 필수
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const key = url.searchParams.get("key") || req.headers.get("x-cron-key");
      if (key !== secret) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
    }
    const minDays = Math.max(0, Number(url.searchParams.get("minDays") ?? 7));
    const maxDays = Math.max(minDays, Number(url.searchParams.get("maxDays") ?? 14));
    const notify = url.searchParams.get("notify") !== "0";

    const now = new Date();
    const lower = yymmdd(new Date(now.getTime() + minDays * 86400_000));
    const upper = yymmdd(new Date(now.getTime() + maxDays * 86400_000));

    const sb = getVivaconSupabase();
    const sel: string = "상품명, 옵션명, 유효기간, 주문번호, first_accessed_at, coupon_public_url, 링크_url";
    // 한글 컬럼 필터는 타입 파싱 회피 위해 any 캐스팅
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb.from("gifticon_orders").select(sel).eq("status", "active").not("유효기간", "is", null);
    q = q.gte("유효기간", lower).lte("유효기간", upper).order("유효기간", { ascending: true }).limit(1000);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    type Row = { 상품명?: string; 옵션명?: string; 유효기간?: string; 주문번호?: string; first_accessed_at?: string | null; coupon_public_url?: string | null; 링크_url?: string | null };
    const rows = (data ?? []) as Row[];
    const unopened = rows.filter((r) => !r.first_accessed_at);

    // 열람 URL: coupon_public_url 우선, 없으면 {origin}/coupon/{링크_url}
    let origin = process.env.GIFTICON_PUBLIC_ORIGIN ?? "";
    if (!origin) {
      const withPub = rows.find((r) => r.coupon_public_url);
      if (withPub?.coupon_public_url) { try { origin = new URL(withPub.coupon_public_url).origin; } catch { /* ignore */ } }
    }
    const viewUrl = (r: Row) => r.coupon_public_url || (origin && r.링크_url ? `${origin}/coupon/${r.링크_url}` : (r.링크_url ?? ""));

    let sent = false;
    if (notify && rows.length > 0) {
      const fmtExp = (y: string) => (y && y.length === 6 ? `20${y.slice(0, 2)}-${y.slice(2, 4)}-${y.slice(4, 6)}` : y);
      const line = (r: Row) => {
        const head = `${!r.first_accessed_at ? "🔴미열람" : "👁열람"} ${r.상품명 ?? ""}${r.옵션명 ? ` (${r.옵션명})` : ""} [~${fmtExp(r.유효기간 ?? "")}] 주문 ${r.주문번호 ?? "-"}`;
        const u = viewUrl(r);
        // 미열람 건은 열람 URL 동봉 (이슈 사전대응용)
        return !r.first_accessed_at && u ? `${head}\n   ↳ ${u}` : head;
      };
      const lines = [
        `⏰ 유효기간 임박 미사용 쿠폰 (${minDays}~${maxDays}일 · 총 ${rows.length}건 / 미열람 ${unopened.length})`,
        "",
        ...[...rows].sort((a, b) => Number(!!a.first_accessed_at) - Number(!!b.first_accessed_at)).slice(0, 40).map(line),
      ];
      if (rows.length > 40) lines.push(`…외 ${rows.length - 40}건`);
      // 평문 발송 + 전용 봇/채팅방 (미설정 시 기본 봇·채팅방 fallback)
      const chatId = process.env.TELEGRAM_EXPIRY_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
      const token = process.env.TELEGRAM_EXPIRY_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
      await sendTelegramDirect(lines.join("\n"), { parseMode: null, chatId, token });
      sent = true;
    }

    return NextResponse.json({ ok: true, minDays, maxDays, total: rows.length, unopened: unopened.length, sent });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "알림 실패" }, { status: 500 });
  }
}
