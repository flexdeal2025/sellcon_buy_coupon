import { NextResponse } from "next/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { getSignedUploadUrl, setBucketCors, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED = /^(image\/|application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|application\/octet-stream)/;

// 브라우저 직접 PUT 허용을 위해 버킷 CORS 자동 보장 (인스턴스당 1회, best-effort).
let corsEnsured = false;
async function ensureCors() {
  if (corsEnsured) return;
  try {
    await setBucketCors(OCR_BUCKET, [
      "https://sellcon-buy-coupon.vercel.app",
      "http://localhost:3000",
    ]);
    corsEnsured = true;
  } catch (e) {
    console.warn("버킷 CORS 자동설정 실패(SA 권한 부족 가능 — 수동 gsutil 필요):", e instanceof Error ? e.message : e);
  }
}

// 대용량 증빙(13MB+ PDF 등) 브라우저→GCS 직접 업로드용 서명 URL 발급.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  let body: { supplier?: string; file_name?: string; content_type?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const supplier = String(body.supplier ?? "").trim();
  const contentType = String(body.content_type ?? "application/octet-stream");
  const fileName = String(body.file_name ?? "doc");
  if (!supplier) return NextResponse.json({ ok: false, error: "공급처 필요" }, { status: 400 });
  if (!ALLOWED.test(contentType)) return NextResponse.json({ ok: false, error: "이미지·PDF·엑셀만 업로드 가능" }, { status: 400 });
  try {
    await ensureCors();
    const safeSupplier = supplier.replace(/[^\w가-힣]/g, "_");
    const safeName = fileName.replace(/[^\w.\-가-힣]/g, "_");
    const ext = safeName.includes(".") ? safeName.slice(safeName.lastIndexOf(".")) : "";
    const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const filePath = `supplier-docs/${safeSupplier}/${ts}_${crypto.randomUUID().slice(0, 8)}${ext}`;
    const uploadUrl = await getSignedUploadUrl(OCR_BUCKET, filePath, contentType);
    return NextResponse.json({ ok: true, uploadUrl, filePath });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "서명 실패" }, { status: 500 });
  }
}
