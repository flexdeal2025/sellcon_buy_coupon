import { NextResponse } from "next/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { slugifyProductName, sanitizeSlug } from "@/lib/ocr/gemini";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 상품명 → 영문 슬러그 (DB캐시 우선, 없으면 Gemini AI, 성공 시 DB저장)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let body: { product_name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const name = (body.product_name ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "product_name 필요" }, { status: 400 });

  const sb = getServerSupabase();

  // 1. DB 캐시 조회 (비바콘 접두사 제거 후)
  const pn = name.replace(/^\s*\[?\s*비바콘\s*\]?\s*/, "").trim();
  const { data: cached } = await sb.from("vivacon_product_slugs").select("slug").eq("product_name", pn).maybeSingle();
  if (cached?.slug) {
    return NextResponse.json({ ok: true, slug: sanitizeSlug(String(cached.slug)), source: "cache" });
  }

  // 2. Gemini AI 생성
  try {
    const slug = await slugifyProductName(name);
    // 3. 성공 시 DB에 저장 (upsert)
    if (slug && pn) {
      await sb.from("vivacon_product_slugs").upsert({ product_name: pn, slug }, { onConflict: "product_name" });
    }
    return NextResponse.json({ ok: true, slug, source: "ai" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "슬러그 생성 실패" }, { status: 500 });
  }
}
