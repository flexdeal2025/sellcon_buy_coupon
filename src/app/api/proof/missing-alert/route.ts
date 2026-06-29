import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { sendTelegramDirect, type TelegramResult } from "@/lib/notify-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 개인거래(증빙 수기 매칭 필요) 매입처. 카드매입처(복지몰/롯데온/일상카페)는 카드자료로 별도 처리,
// 셀콘은 시스템 자체 증빙이라 제외.
const P2P_SUPPLIERS = ["당근마켓", "중고나라", "번개장터"];

// timestamptz(UTC) → KST 날짜(YYYY-MM-DD)
function kstDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 증빙 누락 알림(매일 0시 크론) — 최근 N일 당근/중고나라 매입 중 증빙 미매칭 건을
// 매입일×매입처로 집계해 수집봇으로 통지. ?notify=0 조회만, ?always=1 누락 0건도 발송.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    // 외부 크론(cron-job.org) 호출 보호: CRON_SECRET 설정 시 key 일치 필수
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const key = url.searchParams.get("key") || req.headers.get("x-cron-key");
      if (key !== secret) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
    }
    const days = Math.max(1, Number(url.searchParams.get("days") ?? 30));
    const notify = url.searchParams.get("notify") !== "0";
    const always = url.searchParams.get("always") === "1";

    const sb = getServerSupabase();
    // 최근 days일 경계(KST 날짜 문자열)
    const sinceDate = new Date(Date.now() - days * 86400_000 + 9 * 3600 * 1000).toISOString().slice(0, 10);

    // 1) 개인거래 매입 전체 조회
    const { data: regs, error: e1 } = await sb
      .from("stock_registrations")
      .select("id, supplier, purchase_date, created_at, source")
      .in("supplier", P2P_SUPPLIERS);
    if (e1) throw new Error(e1.message);

    // 2) 최근 days일 매입(매입일 없으면 등록일 KST) & 비-셀콘만 후보
    const candidates = (regs ?? []).filter((r) => {
      if (r.source === "sellcon") return false;
      const d = r.purchase_date || kstDate(r.created_at);
      return d && d >= sinceDate;
    });

    // 3) 증빙 링크 여부 (후보 id 한정 조회 — 1000행 제한 회피)
    const ids = candidates.map((r) => r.id);
    const linked = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const { data: links } = await sb
        .from("proof_registration_links")
        .select("registration_id")
        .in("registration_id", ids.slice(i, i + 1000));
      for (const l of links ?? []) linked.add(l.registration_id);
    }

    const unmatched = candidates.filter((r) => !linked.has(r.id));

    // 4) 매입일 × 매입처 그룹 집계 (최근일 먼저)
    const grp = new Map<string, { date: string; supplier: string; count: number }>();
    for (const r of unmatched) {
      const date = r.purchase_date || kstDate(r.created_at);
      const supplier = r.supplier || "(미상)";
      const key = `${date}|${supplier}`;
      const cur = grp.get(key) ?? { date, supplier, count: 0 };
      cur.count++;
      grp.set(key, cur);
    }
    const groups = Array.from(grp.values()).sort(
      (a, b) => b.date.localeCompare(a.date) || a.supplier.localeCompare(b.supplier),
    );
    const total = unmatched.length;
    const dateCount = new Set(unmatched.map((r) => r.purchase_date || kstDate(r.created_at))).size;

    let sent = false;
    let telegram: TelegramResult | null = null;
    if (notify && (total > 0 || always)) {
      const mmdd = (d: string) => (d.length === 10 ? d.slice(5) : d);
      let body: string;
      if (total === 0) {
        body = `✅ 증빙 누락 없음 (최근 ${days}일 · 당근/중고나라)\n모든 개인거래 매입에 증빙이 매칭되어 있습니다.`;
      } else {
        const CAP = 40;
        const lines = groups.slice(0, CAP).map((g) => `• ${mmdd(g.date)} ${g.supplier} ${g.count}건`);
        if (groups.length > CAP) lines.push(`…외 ${groups.length - CAP}개 일자 더`);
        body = [
          `📋 증빙 누락 알림 (최근 ${days}일 · 당근/중고나라)`,
          `미매칭 매입 ${total}건 · ${dateCount}개 일자`,
          "",
          ...lines,
          "",
          `→ 증빙매핑 화면에서 ${total}개를 매칭해주세요.`,
        ].join("\n");
      }
      // 수집봇(매입 메시지를 받는 봇)으로 발송 — 미설정 시 알림봇으로 폴백
      telegram = await sendTelegramDirect(body, {
        parseMode: null,
        token: process.env.TELEGRAM_INGEST_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_INGEST_CHAT_ID || process.env.TELEGRAM_CHAT_ID,
      });
      sent = telegram.ok;
    }

    return NextResponse.json({
      ok: true,
      days,
      total,
      dateCount,
      groups,
      sent,
      telegram,
      scanned_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "알림 실패" },
      { status: 500 },
    );
  }
}
