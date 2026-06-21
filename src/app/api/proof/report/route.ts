import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 증빙 누락 리포트: 매입처 × 매입일별 재고 총건 / 증빙연결 / 미연결 집계
export async function GET() {
  try {
    const sb = getServerSupabase();
    const [{ data: regs, error: e1 }, { data: links, error: e2 }] = await Promise.all([
      sb.from("stock_registrations").select("id, supplier, purchase_date"),
      sb.from("proof_registration_links").select("registration_id"),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const linked = new Set((links ?? []).map((l) => l.registration_id));
    const map = new Map<string, { supplier: string; purchase_date: string; total: number; mapped: number }>();
    for (const r of regs ?? []) {
      const supplier = r.supplier || "(미지정)";
      const date = r.purchase_date || "(미지정)";
      const key = `${supplier}__${date}`;
      const cur = map.get(key) ?? { supplier, purchase_date: date, total: 0, mapped: 0 };
      cur.total++;
      if (linked.has(r.id)) cur.mapped++;
      map.set(key, cur);
    }
    const rows = Array.from(map.values())
      .map((r) => ({ ...r, missing: r.total - r.mapped }))
      .sort((a, b) => (b.purchase_date.localeCompare(a.purchase_date)) || a.supplier.localeCompare(b.supplier));

    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "리포트 실패" }, { status: 500 });
  }
}
