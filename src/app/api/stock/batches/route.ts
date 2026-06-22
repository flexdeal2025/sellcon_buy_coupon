import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 배치 목록 (최근순) — 재진입(이어서 검수)용
export async function GET() {
  try {
    const sb = getServerSupabase();
    const { data, error } = await sb
      .from("stock_batches")
      .select("id, batch_no, storage_type, default_product_name, default_exchange_location, purchase_date, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
