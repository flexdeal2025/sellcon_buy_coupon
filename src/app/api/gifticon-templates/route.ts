import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { uploadOcrImage, deleteOcrImage } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET: 저장된 템플릿 목록 (메타 + 좌표). 이미지는 /asset 으로 별도 로드(CORS 안전).
export async function GET() {
  try {
    const sb = getServerSupabase();
    const { data, error } = await sb.from("gifticon_templates")
      .select("id, name, coords, name_autofit, product_path, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r) => ({
      id: r.id, name: r.name, coords: r.coords, name_autofit: r.name_autofit,
      has_product: !!r.product_path,
    }));
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}

// POST: 템플릿 저장 (multipart). name, template(file), product(file 선택), coords(json), name_autofit
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "form 파싱 실패" }, { status: 400 }); }

  const name = String(form.get("name") ?? "").trim();
  const template = form.get("template");
  if (!name || !(template instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "name / template 이미지 필요" }, { status: 400 });
  }
  let coords: unknown = {};
  try { coords = JSON.parse(String(form.get("coords") ?? "{}")); } catch { coords = {}; }
  const nameAutofit = String(form.get("name_autofit") ?? "true") !== "false";

  try {
    const id = crypto.randomUUID();
    const tBuf = Buffer.from(await template.arrayBuffer());
    const templatePath = `gifticon_templates/${id}_template.png`;
    await uploadOcrImage(templatePath, tBuf, "image/png");

    let productPath = "";
    const product = form.get("product");
    if (product instanceof Blob) {
      const pBuf = Buffer.from(await product.arrayBuffer());
      productPath = `gifticon_templates/${id}_product.png`;
      await uploadOcrImage(productPath, pBuf, "image/png");
    }

    const sb = getServerSupabase();
    const { error } = await sb.from("gifticon_templates").insert({
      id, name, template_path: templatePath, product_path: productPath, coords, name_autofit: nameAutofit,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, id, name });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "저장 실패" }, { status: 500 });
  }
}

// DELETE ?id= : 템플릿 삭제(GCP 이미지 포함)
export async function DELETE(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { data: row } = await sb.from("gifticon_templates").select("template_path, product_path").eq("id", id).maybeSingle();
    if (row?.template_path) { try { await deleteOcrImage(String(row.template_path)); } catch { /* ignore */ } }
    if (row?.product_path) { try { await deleteOcrImage(String(row.product_path)); } catch { /* ignore */ } }
    const { error } = await sb.from("gifticon_templates").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}
