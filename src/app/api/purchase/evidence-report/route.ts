import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 적격증빙 없는 매입비중 리포트 (purchase_records, evidence_type 공란=무증빙). 읽기 전용.
export async function GET() {
  try {
    const sb = getServerSupabase();
    const rows: { purchase_date: string | null; supplier: string | null; total_price: number | null; evidence_type: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("purchase_records")
        .select("purchase_date, supplier, total_price, evidence_type")
        .order("purchase_date", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const hasEvi = (e: string | null) => !!(e && String(e).trim());
    let total = 0, noEvi = 0;
    const byMonth = new Map<string, { total: number; no: number }>();
    const bySupplier = new Map<string, { total: number; no: number }>();
    for (const r of rows) {
      const amt = Number(r.total_price || 0);
      const ym = (r.purchase_date ?? "").slice(0, 7) || "(미상)";
      const sup = r.supplier || "(미상)";
      const e = !hasEvi(r.evidence_type);
      total += amt; if (e) noEvi += amt;
      const m = byMonth.get(ym) ?? { total: 0, no: 0 }; m.total += amt; if (e) m.no += amt; byMonth.set(ym, m);
      const s = bySupplier.get(sup) ?? { total: 0, no: 0 }; s.total += amt; if (e) s.no += amt; bySupplier.set(sup, s);
    }

    const months = Array.from(byMonth.entries()).map(([ym, v]) => ({ ym, ...v })).sort((a, b) => b.ym.localeCompare(a.ym));
    const suppliers = Array.from(bySupplier.entries()).map(([s, v]) => ({ supplier: s, ...v }))
      .filter((v) => v.no > 0).sort((a, b) => b.no - a.no).slice(0, 20);

    return NextResponse.json({ ok: true, count: rows.length, total, noEvi, months, suppliers });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "리포트 실패" }, { status: 500 });
  }
}
