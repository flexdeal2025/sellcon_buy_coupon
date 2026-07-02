import { NextResponse } from "next/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { setBucketCors, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

// 1회성: 브라우저 직접 업로드(PUT)를 위해 GCS 버킷 CORS 설정.
// 배포 후 관리자가 1번 호출하면 됨. 요청 origin + 로컬을 허용.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  try {
    const reqOrigin = req.headers.get("origin") || "";
    const origins = Array.from(new Set([
      reqOrigin,
      "https://sellcon-buy-coupon.vercel.app",
      "http://localhost:3000",
    ].filter(Boolean)));
    await setBucketCors(OCR_BUCKET, origins);
    return NextResponse.json({ ok: true, bucket: OCR_BUCKET, origins });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "CORS 설정 실패" }, { status: 500 });
  }
}
