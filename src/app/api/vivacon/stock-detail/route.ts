import { NextResponse } from "next/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { listPendingFiles, listCompletedFiles, getSignedReadUrl, GIFTICON_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "image";
  const product = url.searchParams.get("product") ?? "";
  const date = url.searchParams.get("date") ?? "";

  if (!product || !date) {
    return NextResponse.json({ ok: false, error: "product / date 필요" }, { status: 400 });
  }

  try {
    if (type === "image") {
      const gcpFiles = await listPendingFiles(product, date);
      // 서명 URL 일괄 생성 (60분)
      const items = await Promise.all(
        gcpFiles.map(async (f) => ({
          name: f.name,
          path: f.path,
          time_created: f.timeCreated,
          signed_url: await getSignedReadUrl(GIFTICON_BUCKET, f.path, 60),
        })),
      );
      return NextResponse.json({ ok: true, type, items });
    }

    if (type === "code" || type === "code_done") {
      const vc = getVivaconSupabase();
      const status = type === "code" ? "available" : "exchanged";
      const { data, error } = await vc
        .from("coupon_codes")
        .select("id, 상품명, 옵션명, coupon_code, expiry_date, status, 매입원가")
        .eq("status", status)
        .eq("expiry_yymmdd", date)
        .ilike("상품명", product)
        .order("expiry_date", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, type, items: data ?? [] });
    }

    if (type === "image_done") {
      // GCP completed/ 폴더에서 파일 목록 조회 + 서명 URL (60분)
      const gcpFiles = await listCompletedFiles(product, date);
      const items = await Promise.all(
        gcpFiles.map(async (f) => ({
          name: f.name,
          path: f.path,
          time_created: f.timeCreated,
          signed_url: await getSignedReadUrl(GIFTICON_BUCKET, f.path, 60),
        })),
      );
      return NextResponse.json({ ok: true, type, items });
    }

    return NextResponse.json({ ok: false, error: "type 오류" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 },
    );
  }
}
