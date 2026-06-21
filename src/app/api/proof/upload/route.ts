import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { uploadProofImage, getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const pad = (n: number) => String(n).padStart(2, "0");

// 증빙 업로드: 이미지 → GCP proof/ + purchase_proofs 등록
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "form 파싱 실패" }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "file 필요" }, { status: 400 });
  const platform = String(form.get("platform") ?? "").trim();
  const trader = String(form.get("trader_name") ?? "").trim();
  const proofDate = String(form.get("proof_date") ?? "") || null;
  const amountRaw = String(form.get("amount") ?? "").replace(/[^0-9-]/g, "");
  const amount = amountRaw === "" ? null : Number(amountRaw);
  const memo = String(form.get("memo") ?? "").trim();

  const buf = Buffer.from(await file.arrayBuffer());
  const isPng = (file.type || "").includes("png");
  const mime = isPng ? "image/png" : "image/jpeg";
  const ext = isPng ? "png" : "jpg";
  const now = new Date();
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const destPath = `proof/${ymd}/${crypto.randomUUID()}.${ext}`;

  try {
    await uploadProofImage(destPath, buf, mime);
    const sb = getServerSupabase();
    const { data, error } = await sb
      .from("purchase_proofs")
      .insert({ platform, trader_name: trader, proof_date: proofDate, amount, image_path: destPath, memo })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const image_url = await getSignedReadUrl(OCR_BUCKET, destPath);
    return NextResponse.json({ ok: true, proof: data, image_url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "업로드 실패" }, { status: 500 });
  }
}
