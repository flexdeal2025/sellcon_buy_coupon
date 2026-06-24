import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

// 재고 1건의 실제 쿠폰 확인 — 이미지형은 이미지(서명 URL), 코드형은 코드.
// image_path(GCP OCR버킷) 우선 → 셀콘 원본 공개 URL 폴백. 둘 다 없으면 이미지 없음(코드형).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { data: r, error } = await sb.from("stock_registrations")
      .select("coupon_code, product_name, option_name, expiry_date, supplier, stored_as_code, image_path, source_image_url, published, published_ref")
      .eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    let url = "";
    if (r.image_path) { try { url = await getSignedReadUrl(OCR_BUCKET, String(r.image_path)); } catch { /* 만료·삭제 무시 */ } }
    if (!url && r.source_image_url) url = String(r.source_image_url);

    return NextResponse.json({
      ok: true,
      url,
      coupon_code: r.coupon_code ?? "",
      product_name: r.product_name ?? "",
      option_name: r.option_name ?? "",
      expiry_date: r.expiry_date ?? null,
      supplier: r.supplier ?? "",
      stored_as_code: !!r.stored_as_code,
      published: !!r.published,
      published_ref: r.published_ref ?? "",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
