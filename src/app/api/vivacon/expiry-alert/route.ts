import { NextResponse } from "next/server";
import { getVivaconSupabase } from "@/lib/supabase/vivacon";
import { sendTelegramDirect } from "@/lib/notify-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 쿠폰재고(available) 유효기간 임박 집계 + 텔레그램 발송 (coupon_codes 읽기 전용)
// ?days=14 (기본), ?notify=0 으로 발송 생략(조회만). 크론/수동 호출용.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = Math.max(1, Math.min(180, Number(url.searchParams.get("days") ?? 14)));
    const notify = url.searchParams.get("notify") !== "0";

    const today = new Date();
    const threshold = new Date(today.getTime() + days * 86400_000);
    const todayStr = fmt(today);
    const thrStr = fmt(threshold);

    const sb = getVivaconSupabase();
    const sel: string = "상품명, 옵션명, expiry_date"; // 한글 컬럼 — 리터럴 타입 파싱 회피
    const { data, error } = await sb
      .from("coupon_codes")
      .select(sel)
      .eq("status", "available")
      .not("expiry_date", "is", null)
      .lte("expiry_date", thrStr)
      .order("expiry_date", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { 상품명?: string; 옵션명?: string; expiry_date?: string }[];
    // 상품명+유효기간별 집계
    const agg = new Map<string, { name: string; expiry: string; cnt: number; expired: boolean }>();
    for (const r of rows) {
      const name = (r.상품명 ?? "") + (r.옵션명 ? ` (${r.옵션명})` : "");
      const expiry = String(r.expiry_date ?? "");
      const key = `${name}__${expiry}`;
      const cur = agg.get(key) ?? { name, expiry, cnt: 0, expired: expiry < todayStr };
      cur.cnt++;
      agg.set(key, cur);
    }
    const groups = Array.from(agg.values()).sort((a, b) => a.expiry.localeCompare(b.expiry));

    let sent = false;
    if (notify && rows.length > 0) {
      const lines = [
        `⏰ *쿠폰재고 유효기간 임박* (${days}일 이내 · 총 ${rows.length}장)`,
        "",
        ...groups.slice(0, 40).map((g) => `• ${g.expired ? "🔴만료 " : ""}${g.name} [~${g.expiry}] ${g.cnt}장`),
      ];
      if (groups.length > 40) lines.push(`…외 ${groups.length - 40}종`);
      await sendTelegramDirect(lines.join("\n"));
      sent = true;
    }

    return NextResponse.json({ ok: true, days, total: rows.length, groups: groups.length, sent });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "알림 실패" }, { status: 500 });
  }
}
