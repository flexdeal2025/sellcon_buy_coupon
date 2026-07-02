import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { getSignedReadUrl, deleteOcrImage, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

// 공급처 증빙 목록 (공급처·기간 필터) + 열람 서명URL
export async function GET(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const supplier = url.searchParams.get("supplier") || "";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";

    const sb = getServerSupabase();
    let q = sb.from("supplier_documents").select("*").order("doc_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
    if (supplier) q = q.eq("supplier", supplier);
    if (from) q = q.gte("doc_date", from);
    if (to) q = q.lte("doc_date", to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = await Promise.all((data ?? []).map(async (r) => ({
      ...r,
      url: r.file_path ? await getSignedReadUrl(OCR_BUCKET, r.file_path, 60) : "",
    })));
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}

// 공급처 증빙 삭제 (GCS 파일 + 메타)
export async function DELETE(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { data: row } = await sb.from("supplier_documents").select("file_path").eq("id", id).single();
    if (row?.file_path) await deleteOcrImage(row.file_path);
    const { error } = await sb.from("supplier_documents").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}
