import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { uploadProofImage, getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";
import { ocrPurchaseProof, type ProofOcrResult } from "@/lib/ocr/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const pad = (n: number) => String(n).padStart(2, "0");

// 증빙 업로드: 이미지 → GCP proof/ + 당근 거래내역 OCR 자동추출 → purchase_proofs 등록
// 폼값(수동 입력)이 있으면 우선, 없으면 OCR 추출값으로 자동 채움.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "form 파싱 실패" }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "file 필요" }, { status: 400 });

  // 수동 입력값 (있으면 OCR보다 우선)
  const mPlatform = String(form.get("platform") ?? "").trim();
  const mTrader = String(form.get("trader_name") ?? "").trim();
  const mDate = String(form.get("proof_date") ?? "").trim();
  const mAmountRaw = String(form.get("amount") ?? "").replace(/[^0-9-]/g, "");
  const mAmount = mAmountRaw === "" ? null : Number(mAmountRaw);
  const memo = String(form.get("memo") ?? "").trim();
  const skipOcr = String(form.get("skip_ocr") ?? "") === "1";

  const buf = Buffer.from(await file.arrayBuffer());
  const isPng = (file.type || "").includes("png");
  const mime = isPng ? "image/png" : "image/jpeg";
  const ext = isPng ? "png" : "jpg";
  const now = new Date();
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const destPath = `proof/${ymd}/${crypto.randomUUID()}.${ext}`;

  // ── OCR 추출 (실패해도 업로드는 계속) ──────────────────────────────────────
  let ocr: ProofOcrResult | null = null;
  let ocrError: string | null = null;
  if (!skipOcr) {
    try {
      ({ result: ocr } = await ocrPurchaseProof(buf.toString("base64"), mime));
    } catch (e) {
      ocrError = e instanceof Error ? e.message : "OCR 실패";
    }
  }

  // 최종값: 수동 우선 → OCR 폴백
  const platform = mPlatform || ocr?.platform || "당근마켓";
  const trader = mTrader || ocr?.trader_name || "";
  const proofDate = mDate || ocr?.proof_date || null;
  const amount = mAmount != null ? mAmount : (ocr?.total_amount || null);
  const tradeNo = ocr?.trade_no || "";

  try {
    const sb = getServerSupabase();

    // 거래번호 중복 체크 (바로구매만 — 같은 증빙 재업로드 방지)
    if (tradeNo) {
      const { data: dup } = await sb.from("purchase_proofs").select("id").eq("trade_no", tradeNo).limit(1);
      if (dup && dup.length > 0) {
        return NextResponse.json(
          { ok: false, error: `이미 등록된 거래번호(${tradeNo}) — 중복 증빙`, duplicate: true },
          { status: 409 },
        );
      }
    }

    await uploadProofImage(destPath, buf, mime);

    // 기본 컬럼만으로 insert (마이그레이션 전에도 동작)
    const { data, error } = await sb
      .from("purchase_proofs")
      .insert({ platform, trader_name: trader, proof_date: proofDate, amount, image_path: destPath, memo })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // OCR 부가 컬럼 저장 (마이그레이션 미적용 시 무시) — 매핑 추천에 사용
    if (ocr) {
      try {
        await sb.from("purchase_proofs").update({
          trade_type: ocr.trade_type,
          ocr_product_name: ocr.product_name,
          product_amount: ocr.product_amount || null,
          trade_no: tradeNo || null,
          ocr_confidence: ocr.confidence,
        }).eq("id", data.id);
      } catch { /* 부가 컬럼 미생성 — 무시 */ }
    }

    const image_url = await getSignedReadUrl(OCR_BUCKET, destPath);
    return NextResponse.json({ ok: true, proof: data, image_url, ocr, ocr_error: ocrError });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "업로드 실패" }, { status: 500 });
  }
}
