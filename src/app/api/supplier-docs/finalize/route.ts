import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";

export const runtime = "nodejs";
export const maxDuration = 30;

// GCS 직접 업로드(PUT) 완료 후 메타 저장.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const supplier = String(b.supplier ?? "").trim();
  const filePath = String(b.file_path ?? "").trim();
  if (!supplier || !filePath) return NextResponse.json({ ok: false, error: "supplier / file_path 필요" }, { status: 400 });
  const amountRaw = String(b.amount ?? "").replace(/[^0-9-]/g, "");
  try {
    const sb = getServerSupabase();
    const { data, error } = await sb.from("supplier_documents").insert({
      supplier,
      doc_date: b.doc_date ? String(b.doc_date) : null,
      amount: amountRaw === "" ? null : Number(amountRaw),
      memo: String(b.memo ?? "").trim(),
      file_path: filePath,
      file_name: String(b.file_name ?? "").trim(),
      content_type: String(b.content_type ?? "").trim(),
      purchase_record_id: b.purchase_record_id ? String(b.purchase_record_id) : null,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, id: data.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "저장 실패" }, { status: 500 });
  }
}
