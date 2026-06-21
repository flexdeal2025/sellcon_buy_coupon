import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

// 스테이징 등록 목록 (batch_id / status / published 필터) + 이미지 서명URL
export async function GET(req: Request) {
  try {
    const sb = getServerSupabase();
    const url = new URL(req.url);
    const batchId = url.searchParams.get("batch_id");
    const status = url.searchParams.get("status");
    const published = url.searchParams.get("published");

    let q = sb.from("stock_registrations").select("*").order("created_at", { ascending: true });
    if (batchId) q = q.eq("batch_id", batchId);
    if (status) q = q.eq("inspection_status", status);
    if (published === "true") q = q.eq("published", true);
    if (published === "false") q = q.eq("published", false);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = await Promise.all(
      (data ?? []).map(async (r) => ({
        ...r,
        image_url: r.image_path ? await getSignedReadUrl(OCR_BUCKET, r.image_path) : "",
      })),
    );
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
