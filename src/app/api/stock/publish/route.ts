import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { copyOcrToPending } from "@/lib/gcp/storage";
import { slugifyProductName, sanitizeSlug } from "@/lib/ocr/gemini";

const yy = (d: string) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
const todayYY = () => { const n = new Date(); const p = (x: number) => String(x).padStart(2, "0"); return p(n.getFullYear() % 100) + p(n.getMonth() + 1) + p(n.getDate()); };

export const runtime = "nodejs";
export const maxDuration = 60;

// 발행: 스테이징 → 실데이터
//  - 코드형: vivacon coupon_codes INSERT
//  - 이미지형: GCP OCR버킷 → 기프티콘버킷 pending/ 복사 (발송 대상)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let body: { ids?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ ok: false, error: "ids 필요" }, { status: 400 });

  const sb = getServerSupabase();
  const { data: rows, error } = await sb.from("stock_registrations").select("*").in("id", ids);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // 매입처 → 영문매입처명 매핑 (파일명용)
  const vendorEn = new Map<string, string>();
  {
    const { data: vendors } = await sb.from("purchase_vendors").select("name, name_en");
    for (const v of vendors ?? []) vendorEn.set(v.name, v.name_en || "");
  }

  let published = 0;
  const errors: string[] = [];

  for (const r of rows ?? []) {
    if (r.published) continue;
    try {
      // 안전장치 1: 승인된 건만 발행 (UI 우회 직접호출 방어)
      if (r.inspection_status !== "approved") throw new Error("미승인 건은 발행 불가");
      let ref = "";
      if (r.stored_as_code) {
        // 코드형 → vivacon coupon_codes
        if (!r.coupon_code) throw new Error("쿠폰번호 없음");
        const vc = getVivaconSupabase();
        // 안전장치 2: 이미 존재하는 쿠폰번호면 중복 발행 차단
        const { data: existing } = await vc.from("coupon_codes").select("id").eq("coupon_code", r.coupon_code).limit(1);
        if (existing && existing.length > 0) throw new Error("이미 비바콘 재고에 있는 쿠폰번호(중복)");
        const yymmdd = r.expiry_date ? String(r.expiry_date).slice(2, 4) + String(r.expiry_date).slice(5, 7) + String(r.expiry_date).slice(8, 10) : null;
        const { data: ins, error: e2 } = await vc
          .from("coupon_codes")
          .insert({
            상품명: r.product_name ?? "",
            옵션명: r.option_name ?? "",
            coupon_code: r.coupon_code,
            expiry_date: r.expiry_date ?? null,
            expiry_yymmdd: yymmdd,
            status: "available",
            매입원가: r.unit_cost ?? null,
          })
          .select("id")
          .single();
        if (e2) throw new Error(e2.message);
        ref = `COUPON:${ins.id}`;
      } else {
        // 이미지형 → GCP pending 복사 (폴더 구조 유지, 파일명만 규칙 적용)
        if (!r.expiry_date) throw new Error("유효기간 없음(이미지형 발행 필수)");
        if (!r.product_name) throw new Error("상품명 없음");
        if (!r.coupon_code) throw new Error("쿠폰번호 없음(파일명 규칙 필수)");
        const expYY = yy(String(r.expiry_date));
        const purchYY = r.purchase_date ? yy(String(r.purchase_date)) : todayYY();
        // 영문 슬러그: 저장값 우선, 없으면 AI 생성
        let slug = sanitizeSlug(String(r.product_slug ?? ""));
        if (!slug) {
          try { slug = await slugifyProductName(r.product_name); } catch { slug = "item"; }
          if (!slug) slug = "item";
        }
        const ext = (String(r.image_path).split(".").pop() ?? "jpg").toLowerCase();
        // 영문매입처명 (마스터에서, 없으면 매입처명 슬러그화)
        const vEn = sanitizeSlug(vendorEn.get(r.supplier ?? "") || String(r.supplier ?? "")) || "etc";
        // 파일명 규칙: 매입일자_영문매입처명_영문상품명_쿠폰번호_유효기간.확장자
        const fileName = `${purchYY}_${vEn}_${slug}_${r.coupon_code}_${expYY}.${ext}`;
        const safeProduct = String(r.product_name).replace(/\//g, "_");
        ref = await copyOcrToPending(r.image_path, safeProduct, expYY, fileName);
      }

      await sb.from("stock_registrations").update({
        published: true,
        published_ref: ref,
        published_at: new Date().toISOString(),
        inspection_status: "approved",
      }).eq("id", r.id);
      published++;
    } catch (e) {
      errors.push(`${r.id.slice(0, 8)}: ${e instanceof Error ? e.message : "발행 실패"}`);
    }
  }

  return NextResponse.json({ ok: true, published, errors });
}
