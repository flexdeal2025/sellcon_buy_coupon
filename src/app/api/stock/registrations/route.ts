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

    // 중복 쿠폰번호 감지 (이미지형/코드형 통합)
    //  - vivacon coupon_codes 에 존재  OR  우리 시스템에 이미 발행된 동일 쿠폰
    //  - 추가: 스테이징(미발행) 끼리 중복 — 같은 코드가 검수 중에 2건 이상(같은/다른 배치)
    const codes = Array.from(new Set((data ?? []).map((r) => r.coupon_code).filter(Boolean)));
    const dupSet = new Set<string>();      // coupon_codes(코드형 실재고)
    const pubSet = new Set<string>();      // 우리 stock_registrations 발행이력(이미지형 포함)
    const stagingSet = new Set<string>();  // 미발행 스테이징끼리 중복(2건 이상)
    if (codes.length) {
      try {
        const vc = getVivaconSupabase();
        const { data: ex } = await vc.from("coupon_codes").select("coupon_code").in("coupon_code", codes);
        for (const e of ex ?? []) dupSet.add(e.coupon_code);
      } catch { /* 외주 연결 불가 시 생략 */ }
      const { data: pub } = await sb.from("stock_registrations").select("coupon_code").eq("published", true).in("coupon_code", codes);
      for (const p of pub ?? []) pubSet.add(p.coupon_code);
      // 미발행 등록 중 같은 코드가 2건 이상이면 스테이징 중복(발행 전에도 즉시 경고)
      const { data: stg } = await sb.from("stock_registrations").select("coupon_code").eq("published", false).in("coupon_code", codes);
      const stgCnt = new Map<string, number>();
      for (const s of stg ?? []) if (s.coupon_code) stgCnt.set(s.coupon_code, (stgCnt.get(s.coupon_code) ?? 0) + 1);
      for (const [c, n] of stgCnt) if (n > 1) stagingSet.add(c);
    }
    // 중복 사유 (배지 툴팁용)
    const dupReason = (code: string): string =>
      dupSet.has(code) ? "비바콘 실재고에 이미 존재하는 쿠폰번호"
      : pubSet.has(code) ? "이미 발행된 동일 쿠폰번호"
      : stagingSet.has(code) ? "검수 중 중복 업로드 (같은 쿠폰번호 2건 이상)"
      : "";

    // product_slug 미입력 행 → 마스터 영문명(vivacon_product_slugs)으로 보충(표시용; 발행 시 확정)
    const strip = (n: string) => String(n ?? "").replace(/^\s*\[?\s*비바콘\s*\]?\s*/, "").trim();
    const needPn = Array.from(new Set((data ?? []).filter((r) => !r.product_slug && r.product_name).map((r) => strip(r.product_name))));
    const masterSlug = new Map<string, string>();
    if (needPn.length) {
      const { data: ms } = await sb.from("vivacon_product_slugs").select("product_name, slug").in("product_name", needPn);
      for (const m of ms ?? []) masterSlug.set(m.product_name, (m.slug as string) ?? "");
    }

    const rows = await Promise.all(
      (data ?? []).map(async (r) => ({
        ...r,
        // image_path(GCP) 우선, 없으면 셀콘 원본 공개 URL 폴백(이미지형 직결 건은 GCP 미적재 상태)
        image_url: r.image_path ? await getSignedReadUrl(OCR_BUCKET, r.image_path) : (r.source_image_url || ""),
        // 영문명 미입력 시 마스터 영문명으로 채워 표시
        product_slug: r.product_slug || masterSlug.get(strip(r.product_name)) || "",
        // 미발행 건이 이미 어딘가에 있으면(실재고·발행이력·스테이징) 중복
        dup: !!r.coupon_code && !r.published && (dupSet.has(r.coupon_code) || pubSet.has(r.coupon_code) || stagingSet.has(r.coupon_code)),
        dup_reason: !r.published && r.coupon_code ? dupReason(r.coupon_code) : "",
      })),
    );
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
