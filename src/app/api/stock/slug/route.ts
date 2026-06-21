import { NextResponse } from "next/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { slugifyProductName } from "@/lib/ocr/gemini";

export const runtime = "nodejs";

// 상품명 → 영문 슬러그 (AI)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let body: { product_name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const name = (body.product_name ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "product_name 필요" }, { status: 400 });
  try {
    const slug = await slugifyProductName(name);
    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "슬러그 생성 실패" }, { status: 500 });
  }
}
