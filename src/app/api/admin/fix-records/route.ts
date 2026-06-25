/**
 * 1회성 관리자 엔드포인트 — GCP 파일 이동 + DB 상품명/published_ref 교정
 * 사용 후 반드시 삭제할 것.
 * POST /api/admin/fix-records  (x-app-passcode 헤더 필요)
 */
import { NextResponse } from "next/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { getServerSupabase } from "@/lib/supabase/server";
import { Storage } from "@google-cloud/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = process.env.GCP_GIFTICON_BUCKET ?? "flexdeal-gifticon";

function buildStorage(): Storage {
  const b64 = process.env.GCP_SA_KEY_B64;
  if (!b64) throw new Error("GCP_SA_KEY_B64 미설정");
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  return new Storage({ projectId: creds.project_id, credentials: creds });
}

const FIXES = [
  {
    id: "a7603f15-fcd5-47fe-94a7-22d8500ab3ea",
    new_product_name: "올리브영 5만원권 기프트카드 올영데이(앱 등록 필수)",
    old_gcp: "pending/올리브영 기프트카드 5만원권/260731/260625_dg_item_8613543076920575169560_260731.jpg",
    new_gcp: "pending/올리브영 5만원권 기프트카드 올영데이(앱 등록 필수)/260731/260625_dg_item_8613543076920575169560_260731.jpg",
  },
  {
    id: "37fde1a8-d0f0-48d4-843a-d0612a290269",
    new_product_name: "맘스터치 싸이버거 세트",
    old_gcp: "pending/[맘스터치] 싸이버거 세트/270626/260625_dg_item_922229030072_270626.jpg",
    new_gcp: "pending/맘스터치 싸이버거 세트/270626/260625_dg_item_922229030072_270626.jpg",
  },
];

export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  const storage = buildStorage();
  const bucket = storage.bucket(BUCKET);
  const sb = getServerSupabase();
  const results = [];

  for (const fix of FIXES) {
    const log: string[] = [];
    const src = bucket.file(fix.old_gcp);
    const dst = bucket.file(fix.new_gcp);

    // GCP 파일 이동
    const [exists] = await src.exists();
    if (!exists) {
      log.push(`GCP 원본 없음 (이미 이동됐거나 경로 다름): ${fix.old_gcp}`);
    } else {
      await src.copy(dst);
      await src.delete();
      log.push(`GCP 이동 완료: ${fix.old_gcp} → ${fix.new_gcp}`);
    }

    // DB 업데이트 (GCP 이동 결과와 무관하게 상품명+ref 교정)
    const published_ref = exists ? fix.new_gcp : fix.old_gcp;
    const { error } = await sb
      .from("stock_registrations")
      .update({ product_name: fix.new_product_name, published_ref })
      .eq("id", fix.id);

    if (error) {
      log.push(`DB 업데이트 실패: ${error.message}`);
    } else {
      log.push(`DB 업데이트 완료: product_name="${fix.new_product_name}", published_ref="${published_ref}"`);
    }

    results.push({ id: fix.id.slice(0, 8), log });
  }

  return NextResponse.json({ ok: true, results });
}
