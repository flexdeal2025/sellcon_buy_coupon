import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 배치 목록 (최근순) — 재진입(이어서 검수)용.
// 모든 재고가 발행 완료된 배치는 제외 (재고 없는 새 배치 또는 미발행 재고 있는 배치만 반환).
export async function GET() {
  try {
    const sb = getServerSupabase();
    const { data, error } = await sb
      .from("stock_batches")
      .select("id, batch_no, storage_type, default_product_name, default_exchange_location, purchase_date, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    if (rows.length === 0) return NextResponse.json({ ok: true, rows: [] });

    const batchIds = rows.map((b) => b.id);

    // 미발행 재고가 있는 배치 ID
    const { data: unpubData } = await sb
      .from("stock_registrations")
      .select("batch_id")
      .eq("published", false)
      .in("batch_id", batchIds)
      .limit(2000);
    const unpubSet = new Set((unpubData ?? []).map((r) => r.batch_id).filter(Boolean));

    // 재고가 하나라도 있는 배치 ID (발행 여부 무관)
    const { data: anyData } = await sb
      .from("stock_registrations")
      .select("batch_id")
      .in("batch_id", batchIds)
      .limit(2000);
    const anySet = new Set((anyData ?? []).map((r) => r.batch_id).filter(Boolean));

    // 재고 없는 새 배치 OR 미발행 재고가 남아 있는 배치만 반환
    const filtered = rows.filter((b) => !anySet.has(b.id) || unpubSet.has(b.id));

    return NextResponse.json({ ok: true, rows: filtered });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
