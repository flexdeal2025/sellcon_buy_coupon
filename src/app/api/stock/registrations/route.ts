import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getVivaconSupabase } from "@/lib/supabase/vivacon";
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

    // 중복 쿠폰번호 감지: 이미 vivacon coupon_codes 에 존재하는지
    const codes = Array.from(new Set((data ?? []).map((r) => r.coupon_code).filter(Boolean)));
    const dupSet = new Set<string>();
    if (codes.length) {
      try {
        const vc = getVivaconSupabase();
        const { data: ex } = await vc.from("coupon_codes").select("coupon_code").in("coupon_code", codes);
        for (const e of ex ?? []) dupSet.add(e.coupon_code);
      } catch { /* 외주 연결 불가 시 중복검사 생략 */ }
    }

    const rows = await Promise.all(
      (data ?? []).map(async (r) => ({
        ...r,
        image_url: r.image_path ? await getSignedReadUrl(OCR_BUCKET, r.image_path) : "",
        dup: !!r.coupon_code && dupSet.has(r.coupon_code),
      })),
    );
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
