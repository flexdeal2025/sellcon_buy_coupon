import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { copyOcrToPending, uploadOcrImage } from "@/lib/gcp/storage";
import { slugifyProductName, sanitizeSlug } from "@/lib/ocr/gemini";
import { resolveOptionName } from "@/lib/option-map";

const yy = (d: string) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
const todayYY = () => { const n = new Date(); const p = (x: number) => String(x).padStart(2, "0"); return p(n.getFullYear() % 100) + p(n.getMonth() + 1) + p(n.getDate()); };

export const runtime = "nodejs";
export const maxDuration = 60;

// 셀콘 직결 이미지형 발행 시: 원본 공개 URL → OCR버킷 1회 적재 후 경로 반환(materialize).
// (수동 업로드 건은 이미 image_path가 있어 이 경로를 타지 않음)
async function materializeSourceImage(sourceUrl: string, purchYY: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  let resp: Response;
  try { resp = await fetch(sourceUrl, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
  if (!resp.ok) throw new Error(`원본 이미지 fetch 실패(${resp.status})`);
  const ct = resp.headers.get("content-type") ?? "";
  const lower = sourceUrl.toLowerCase();
  const ext = lower.includes(".png") || ct.includes("png") ? "png"
    : lower.includes(".webp") || ct.includes("webp") ? "webp" : "jpg";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const buf = Buffer.from(await resp.arrayBuffer());
  const destPath = `${purchYY}/sellcon/${crypto.randomUUID()}.${ext}`;
  await uploadOcrImage(destPath, buf, mime);
  return destPath;
}

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

      // 안전장치 2(공통): 우리 시스템에 이미 발행된 동일 쿠폰번호면 차단 (이미지형 포함)
      if (r.coupon_code) {
        const { data: dupReg } = await sb.from("stock_registrations")
          .select("id").eq("coupon_code", r.coupon_code).eq("published", true).neq("id", r.id).limit(1);
        if (dupReg && dupReg.length > 0) throw new Error("이미 발행된 동일 쿠폰번호(중복)");
      }

      let ref = "";
      if (r.stored_as_code) {
        // 코드형 → vivacon coupon_codes
        if (!r.coupon_code) throw new Error("쿠폰번호 없음");
        const vc = getVivaconSupabase();
        // 안전장치 3(코드형): 비바콘 실재고에 이미 있으면 차단
        const { data: existing } = await vc.from("coupon_codes").select("id").eq("coupon_code", r.coupon_code).limit(1);
        if (existing && existing.length > 0) throw new Error("이미 비바콘 재고에 있는 쿠폰번호(중복)");
        const yymmdd = r.expiry_date ? String(r.expiry_date).slice(2, 4) + String(r.expiry_date).slice(5, 7) + String(r.expiry_date).slice(8, 10) : null;
        // 옵션명 안전장치: 비어 있으면(이미지로 올린 뒤 코드형 전환 등) product_option_map 자동 보완 → 알림톡 발송 필수값 보장
        const optName = (r.option_name && String(r.option_name).trim()) ? String(r.option_name) : await resolveOptionName(sb, r.product_name ?? "");
        const { data: ins, error: e2 } = await vc
          .from("coupon_codes")
          .insert({
            상품명: r.product_name ?? "",
            옵션명: optName,
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
        // 셀콘 직결 이미지형: GCP 미적재면 원본 공개 URL을 OCR버킷으로 1회 가져와 image_path 확보
        if (!r.image_path && r.source_image_url) {
          const matPath = await materializeSourceImage(String(r.source_image_url), purchYY);
          await sb.from("stock_registrations").update({ image_path: matPath }).eq("id", r.id);
          r.image_path = matPath;
        }
        if (!r.image_path) throw new Error("이미지 경로 없음(원본 URL도 없음) — 검수에서 이미지 확인 필요");
        // 영문 슬러그: ① 저장값 → ② 마스터(vivacon_product_slugs) 상품명 매칭 → ③ AI → ④ item
        let slug = sanitizeSlug(String(r.product_slug ?? ""));
        if (!slug && r.product_name) {
          const pn = String(r.product_name).replace(/^\s*\[?\s*비바콘\s*\]?\s*/, "").trim();
          const { data: ms } = await sb.from("vivacon_product_slugs").select("slug").eq("product_name", pn).maybeSingle();
          if (ms?.slug) slug = sanitizeSlug(String(ms.slug));
        }
        if (!slug) {
          try { slug = await slugifyProductName(r.product_name); } catch { slug = ""; }
        }
        if (!slug) slug = "item";
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
