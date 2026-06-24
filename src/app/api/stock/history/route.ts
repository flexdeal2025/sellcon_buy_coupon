import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// 재고 등록 이력 통합 조회 — 전 배치 대상. 등록일/매입일 범위 + 형식·발행상태 + 매입처·상품명·쿠폰번호 검색.
// 쿠폰 문제 발생 시 "언제·어느 배치로 등록됐는지" 추적용.
export async function GET(req: Request) {
  try {
    const sb = getServerSupabase();
    const u = new URL(req.url);
    const dateField = u.searchParams.get("dateField") === "purchase" ? "purchase_date" : "created_at";
    const from = u.searchParams.get("from") ?? "";
    const to = u.searchParams.get("to") ?? "";
    const storage = u.searchParams.get("storage") ?? "all";   // all | image | code
    const published = u.searchParams.get("published") ?? "all"; // all | true | false
    const supplier = (u.searchParams.get("supplier") ?? "").trim();
    const product = (u.searchParams.get("product") ?? "").trim();
    const code = (u.searchParams.get("code") ?? "").trim();
    const limit = Math.min(Number(u.searchParams.get("limit")) || 1000, 2000);

    let q = sb.from("stock_registrations")
      .select("id, created_at, purchase_date, supplier, product_name, coupon_code, expiry_date, stored_as_code, inspection_status, published, unit_cost, exchange_location, source, batch_id, product_slug")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (isDate(from)) q = q.gte(dateField, dateField === "created_at" ? `${from}T00:00:00` : from);
    if (isDate(to))   q = q.lte(dateField, dateField === "created_at" ? `${to}T23:59:59` : to);
    if (storage === "image") q = q.eq("stored_as_code", false);
    else if (storage === "code") q = q.eq("stored_as_code", true);
    if (published === "true") q = q.eq("published", true);
    else if (published === "false") q = q.eq("published", false);
    if (supplier) q = q.ilike("supplier", `%${supplier}%`);
    if (product) q = q.ilike("product_name", `%${product}%`);
    if (code) q = q.ilike("coupon_code", `%${code}%`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // 배치명 매핑 (batch_id → batch_no)
    const batchIds = Array.from(new Set((data ?? []).map((r) => r.batch_id).filter(Boolean)));
    const batchNo = new Map<string, string>();
    if (batchIds.length) {
      const { data: bs } = await sb.from("stock_batches").select("id, batch_no").in("id", batchIds);
      for (const b of bs ?? []) batchNo.set(b.id as string, (b.batch_no as string) ?? "");
    }
    const rows = (data ?? []).map((r) => ({ ...r, batch_no: batchNo.get(r.batch_id as string) ?? "" }));

    return NextResponse.json({ ok: true, rows, count: rows.length, capped: rows.length >= limit });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
