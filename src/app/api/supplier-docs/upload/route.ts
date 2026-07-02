import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { uploadOcrImage } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

// 허용 파일: 이미지 / PDF / 엑셀
const ALLOWED = /^(image\/|application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel)/;

// 공급처 증빙 업로드 → GCS(supplier-docs/) 보관 + supplier_documents 메타 저장.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "form 파싱 실패" }, { status: 400 }); }
  const file = form.get("file");
  const supplier = String(form.get("supplier") ?? "").trim();
  const docDate = String(form.get("doc_date") ?? "").trim();
  const amountRaw = String(form.get("amount") ?? "").replace(/[^0-9-]/g, "");
  const memo = String(form.get("memo") ?? "").trim();
  const purchaseRecordId = String(form.get("purchase_record_id") ?? "").trim() || null;
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "파일 필요" }, { status: 400 });
  if (!supplier) return NextResponse.json({ ok: false, error: "공급처 필요" }, { status: 400 });

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED.test(contentType)) {
    return NextResponse.json({ ok: false, error: "이미지·PDF·엑셀만 업로드 가능" }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const fname = ((file as File).name || "doc").replace(/[^\w.\-가-힣]/g, "_");
    const ext = fname.includes(".") ? fname.slice(fname.lastIndexOf(".")) : "";
    const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const safeSupplier = supplier.replace(/[^\w가-힣]/g, "_");
    const filePath = `supplier-docs/${safeSupplier}/${ts}_${crypto.randomUUID().slice(0, 8)}${ext}`;
    await uploadOcrImage(filePath, buf, contentType);

    const sb = getServerSupabase();
    const { data, error } = await sb.from("supplier_documents").insert({
      supplier,
      doc_date: docDate || null,
      amount: amountRaw === "" ? null : Number(amountRaw),
      memo,
      file_path: filePath,
      file_name: fname,
      content_type: contentType,
      purchase_record_id: purchaseRecordId,
    }).select("id").single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, id: data.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "업로드 실패" }, { status: 500 });
  }
}
