import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { uploadOcrImage, getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

// 편집본 이미지로 재고 이미지 교체 — 원본은 original_image_path 로 보존(최초 1회).
// 미발행 건만. 발행은 image_path(편집본)를 사용하므로 별도 변경 불필요.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "form 파싱 실패" }, { status: 400 }); }
  const id = String(form.get("id") ?? "");
  const file = form.get("file");
  if (!id || !(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "id / file 필요" }, { status: 400 });
  }
  try {
    const sb = getServerSupabase();
    const { data: row, error } = await sb
      .from("stock_registrations")
      .select("image_path, original_image_path, published")
      .eq("id", id).single();
    if (error || !row) return NextResponse.json({ ok: false, error: "항목 없음" }, { status: 404 });
    if (row.published) return NextResponse.json({ ok: false, error: "이미 발행된 항목은 편집 불가" }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const isPng = (file.type || "").includes("png");
    const ext = isPng ? "png" : "jpg";
    const mime = isPng ? "image/png" : "image/jpeg";
    // 편집본 경로: 원본 디렉터리 유지 + 새 파일명
    const dir = row.image_path && row.image_path.includes("/")
      ? row.image_path.slice(0, row.image_path.lastIndexOf("/"))
      : `edited/${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    const destPath = `${dir}/edited_${crypto.randomUUID()}.${ext}`;
    await uploadOcrImage(destPath, buf, mime);

    // 필수: 현재 이미지를 편집본으로 교체
    const { error: upErr } = await sb.from("stock_registrations").update({ image_path: destPath }).eq("id", id);
    if (upErr) throw new Error(upErr.message);

    // 원본 보존: 최초 1회만(이미 있으면 유지). 컬럼 미생성 시 조용히 스킵.
    const original = (row as { original_image_path?: string }).original_image_path || row.image_path || "";
    let originalSaved = false;
    if (original) {
      const { error: oErr } = await sb.from("stock_registrations")
        .update({ original_image_path: original }).eq("id", id);
      if (oErr) console.warn("original_image_path 저장 실패(마이그레이션 필요?):", oErr.message);
      else originalSaved = true;
    }

    const image_url = await getSignedReadUrl(OCR_BUCKET, destPath);
    return NextResponse.json({ ok: true, image_path: destPath, original_saved: originalSaved, image_url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "편집본 저장 실패" },
      { status: 500 },
    );
  }
}
