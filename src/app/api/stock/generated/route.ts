import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { uploadOcrImage, getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// 기프티콘 이미지 변환: 브라우저가 생성한 쿠폰 이미지(상품명·코드·유효기간 기지) → GCP 적재 + 스테이징(이미지형).
// OCR 불필요(메타데이터를 이미 알고 있음). 검수 화면에서 승인 → 발행.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "form 파싱 실패" }, { status: 400 }); }

  const file = form.get("file");
  const batchId = String(form.get("batch_id") ?? "");
  const batchNo = String(form.get("batch_no") ?? "");
  if (!(file instanceof Blob) || !batchId || !batchNo) {
    return NextResponse.json({ ok: false, error: "file / batch_id / batch_no 필요" }, { status: 400 });
  }
  const productName = String(form.get("product_name") ?? "").trim();
  const couponCode = String(form.get("coupon_code") ?? "").replace(/\s+/g, "").trim();
  const optionName = String(form.get("option_name") ?? "").trim();
  const expiryRaw = String(form.get("expiry_date") ?? "").trim();
  const expiry = isDate(expiryRaw) ? expiryRaw : null;
  const supplier = String(form.get("supplier") ?? "").trim();
  const purchaseDate = String(form.get("purchase_date") ?? "") || null;
  const unitCostRaw = String(form.get("unit_cost") ?? "").replace(/[^0-9-]/g, "");
  const productSlug = String(form.get("product_slug") ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "").slice(0, 40);

  const buf = Buffer.from(await file.arrayBuffer());
  const ymd = batchNo.split("-").slice(1, 2)[0] || batchNo.split("_")[0] || "gen"; // SC/TG/GEN-YYMMDD… 안전 폴백
  const destPath = `${ymd}/${batchNo}/${crypto.randomUUID()}.png`;

  try {
    await uploadOcrImage(destPath, buf, "image/png");
    const sb = getServerSupabase();
    const { data, error } = await sb.from("stock_registrations").insert({
      batch_id: batchId,
      image_path: destPath,
      product_name: productName,
      option_name: optionName,
      coupon_code: couponCode,
      expiry_date: expiry,
      exchange_location: "",
      supplier,
      purchase_date: purchaseDate,
      unit_cost: unitCostRaw === "" ? null : Number(unitCostRaw),
      ocr_confidence: 100,
      extraction_quality: "high",
      inspection_status: "pending",
      stored_as_code: false,          // 이미지형(생성 쿠폰 이미지) → 발행 시 GCP 발송폴더
      product_slug: productSlug,
    }).select().single();
    if (error) throw new Error(error.message);

    const image_url = await getSignedReadUrl(OCR_BUCKET, destPath);
    return NextResponse.json({ ok: true, row: data, image_url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "등록 실패" }, { status: 500 });
  }
}
