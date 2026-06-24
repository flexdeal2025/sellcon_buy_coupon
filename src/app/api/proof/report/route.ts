import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// timestamptz(UTC) → KST 날짜(YYYY-MM-DD). 서버(UTC) 기준 slice 대신 KST 기준으로 그룹핑.
function kstDate(iso: string | null): string {
  if (!iso) return "(미지정)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "(미지정)";
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 증빙 누락 리포트: 매입처 × 매입일별 재고 총건 / 증빙연결 / 미연결 집계
export async function GET() {
  try {
    const sb = getServerSupabase();
    const [{ data: regs, error: e1 }, { data: links, error: e2 }] = await Promise.all([
      sb.from("stock_registrations").select("id, supplier, created_at, unit_cost"),
      sb.from("proof_registration_links").select("registration_id"),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const linked = new Set((links ?? []).map((l) => l.registration_id));
    // 등록일(created_at) 기준 집계 — 증빙 화면 날짜필터(등록일)와 동일 기준
    // 금액은 입력된 매입원가(unit_cost) 기준. missingAmt = 증빙 미연결 매입액(소명 리스크 금액)
    interface Agg { supplier: string; date: string; total: number; mapped: number; totalAmt: number; missingAmt: number }
    const map = new Map<string, Agg>();
    for (const r of regs ?? []) {
      const supplier = r.supplier || "(미지정)";
      const date = kstDate(r.created_at);
      const cost = Number(r.unit_cost) || 0;
      const key = `${supplier}__${date}`;
      const cur = map.get(key) ?? { supplier, date, total: 0, mapped: 0, totalAmt: 0, missingAmt: 0 };
      cur.total++;
      cur.totalAmt += cost;
      if (linked.has(r.id)) cur.mapped++;
      else cur.missingAmt += cost;
      map.set(key, cur);
    }
    const rows = Array.from(map.values())
      .map((r) => ({ ...r, missing: r.total - r.mapped }))
      .sort((a, b) => (b.date.localeCompare(a.date)) || a.supplier.localeCompare(b.supplier));

    // 총 미연결 매입액(증빙 없는 매입 합계) — 소명 리스크 가시화
    const missingAmtTotal = rows.reduce((s, r) => s + r.missingAmt, 0);
    const missingCntTotal = rows.reduce((s, r) => s + r.missing, 0);

    return NextResponse.json({ ok: true, rows, missingAmtTotal, missingCntTotal });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "리포트 실패" }, { status: 500 });
  }
}
