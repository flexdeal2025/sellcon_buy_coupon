import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { uploadOcrImage, getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";
import { ocrGifticon } from "@/lib/ocr/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

function quality(conf: number): string {
  if (conf >= 90) return "high";
  if (conf >= 70) return "medium";
  return "low";
}

// 이미지 1장 업로드 → GCP 저장 → OCR → 스테이징(stock_registrations) 등록
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
  const storageType = String(form.get("storage_type") ?? "image");
  const defProduct = String(form.get("default_product_name") ?? "").trim();
  const defExchange = String(form.get("default_exchange_location") ?? "").trim();
  const defSupplier = String(form.get("default_supplier") ?? "").trim();
  const purchaseDate = String(form.get("purchase_date") ?? "") || null;
  const unitCostRaw = String(form.get("unit_cost") ?? "").replace(/[^0-9-]/g, "");
  const unitCost = unitCostRaw === "" ? null : Number(unitCostRaw);

  const buf = Buffer.from(await file.arrayBuffer());
  const isPng = (file.type || "").includes("png") || (("name" in file) && String((file as File).name).toLowerCase().endsWith(".png"));
  const mime = isPng ? "image/png" : "image/jpeg";
  const ext = isPng ? "png" : "jpg";
  const ymd = batchNo.split("_")[0]; // YYYYMMDD
  const destPath = `${ymd}/${batchNo}/${crypto.randomUUID()}.${ext}`;

  try {
    // 1) GCP 업로드
    await uploadOcrImage(destPath, buf, mime);

    // 2) OCR (실패해도 빈값으로 등록 — 검수에서 수동 입력)
    let ocr = { product_name: "", coupon_code: "", expiry_date: "", exchange_location: "", confidence: 0 };
    let raw: unknown = null;
    try {
      const r = await ocrGifticon(buf.toString("base64"), mime);
      ocr = r.result; raw = r.raw;
    } catch (e) {
      raw = { ocr_error: e instanceof Error ? e.message : "ocr failed" };
    }

    // 3) 스테이징 등록
    const sb = getServerSupabase();
    const { data, error } = await sb
      .from("stock_registrations")
      .insert({
        batch_id: batchId,
        image_path: destPath,
        product_name: ocr.product_name || defProduct,
        option_name: "",
        coupon_code: ocr.coupon_code,
        expiry_date: ocr.expiry_date || null,
        exchange_location: ocr.exchange_location || defExchange,
        supplier: defSupplier,
        purchase_date: purchaseDate,
        unit_cost: unitCost,
        ocr_confidence: ocr.confidence,
        extraction_quality: quality(ocr.confidence),
        ocr_raw: raw,
        inspection_status: "pending",
        stored_as_code: storageType === "code",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const image_url = await getSignedReadUrl(OCR_BUCKET, destPath);
    return NextResponse.json({ ok: true, row: data, image_url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "처리 실패" }, { status: 500 });
  }
}
