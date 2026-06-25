import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 매핑 대상 재고 목록 (stock_registrations) + 각 건의 증빙 연결 상태
// 필터: batch_id / supplier / mapped(true|false)
export async function GET(req: Request) {
  try {
    const sb = getServerSupabase();
    const url = new URL(req.url);
    const batchId = url.searchParams.get("batch_id");
    const supplier = url.searchParams.get("supplier");
    const mapped = url.searchParams.get("mapped"); // "true" | "false"

    let q = sb
      .from("stock_registrations")
      .select("id,product_name,option_name,coupon_code,expiry_date,supplier,purchase_date,created_at,stored_as_code,published,source")
      .order("created_at", { ascending: true });
    if (batchId) q = q.eq("batch_id", batchId);
    if (supplier) q = q.eq("supplier", supplier);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // 연결 상태
    const ids = (data ?? []).map((r) => r.id);
    const linkMap: Record<string, string> = {};
    if (ids.length) {
      const { data: links } = await sb.from("proof_registration_links").select("registration_id, proof_id").in("registration_id", ids);
      for (const l of links ?? []) linkMap[l.registration_id] = l.proof_id;
    }
    let rows = (data ?? []).map((r) => ({ ...r, proof_id: linkMap[r.id] ?? null }));
    if (mapped === "true") rows = rows.filter((r) => r.proof_id);
    if (mapped === "false") rows = rows.filter((r) => !r.proof_id);

    return NextResponse.json({ ok: true, rows, total: data?.length ?? 0, mappedCount: Object.keys(linkMap).length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
