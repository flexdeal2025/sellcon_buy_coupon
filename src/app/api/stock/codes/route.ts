import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";

export const runtime = "nodejs";
export const maxDuration = 30;

// 코드형 텍스트 일괄등록 (이미지 OCR 없이) → stock_registrations (stored_as_code=true)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  let body: {
    batch_id?: string; codes?: string[];
    product_name?: string; option_name?: string; expiry_date?: string;
    supplier?: string; unit_cost?: string | number; product_slug?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }

  const { batch_id } = body;
  const codes = (body.codes ?? []).map((c) => String(c).trim()).filter(Boolean);
  if (!batch_id || codes.length === 0) return NextResponse.json({ ok: false, error: "batch_id / codes 필요" }, { status: 400 });
  if (codes.length > 1000) return NextResponse.json({ ok: false, error: "한 번에 1000개까지" }, { status: 400 });

  const expiry = String(body.expiry_date ?? "").trim();
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return NextResponse.json({ ok: false, error: "유효기간 형식 오류(YYYY-MM-DD)" }, { status: 400 });
  const costRaw = String(body.unit_cost ?? "").replace(/[^0-9-]/g, "");

  const base = {
    batch_id,
    image_path: "",
    product_name: String(body.product_name ?? "").trim(),
    option_name: String(body.option_name ?? "").trim(),
    expiry_date: expiry || null,
    exchange_location: "",
    supplier: String(body.supplier ?? "").trim(),
    unit_cost: costRaw === "" ? null : Number(costRaw),
    ocr_confidence: null,
    extraction_quality: "",
    inspection_status: "pending",
    stored_as_code: true,
    product_slug: String(body.product_slug ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "").slice(0, 40),
  };
  const rows = codes.map((coupon_code) => ({ ...base, coupon_code }));

  try {
    const sb = getServerSupabase();
    const { data, error } = await sb.from("stock_registrations").insert(rows).select("id");
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, inserted: (data ?? []).length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "등록 실패" }, { status: 500 });
  }
}
