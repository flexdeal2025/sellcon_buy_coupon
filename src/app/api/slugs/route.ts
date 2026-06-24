import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { slugifyProductName, sanitizeSlug } from "@/lib/ocr/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// [비바콘] 접두어 제거 (마스터 상품명 정규화)
const strip = (n: string) => (n ?? "").replace(/^\s*\[?\s*비바콘\s*\]?\s*/, "").trim();

// GET: 마스터 상품명 + 영문명(슬러그) 목록
export async function GET() {
  try {
    const sb = getServerSupabase();
    const [{ data: prods }, { data: slugs }] = await Promise.all([
      sb.from("smartstore_products").select("name").limit(5000),
      sb.from("vivacon_product_slugs").select("product_name, slug").limit(10000),
    ]);
    const slugMap = new Map<string, string>();
    for (const s of slugs ?? []) slugMap.set(s.product_name, (s.slug as string) ?? "");
    // 마스터 상품명(스마트스토어) + 사전에만 있는 상품명 합집합
    const names = new Set<string>();
    for (const p of prods ?? []) { const n = strip(p.name as string); if (n) names.add(n); }
    for (const s of slugs ?? []) { const n = (s.product_name as string) ?? ""; if (n) names.add(n); }
    const rows = Array.from(names).sort().map((n) => ({ product_name: n, slug: slugMap.get(n) ?? "" }));
    const missing = rows.filter((r) => !r.slug).length;
    return NextResponse.json({ ok: true, rows, total: rows.length, missing });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}

// POST: 영문명 AI 생성 후 저장. body { names: string[] } (보통 미입력 상품명들)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  let body: { names?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const names = Array.from(new Set((body.names ?? []).map((n) => strip(String(n))).filter(Boolean)));
  if (names.length === 0) return NextResponse.json({ ok: false, error: "names 필요" }, { status: 400 });
  if (names.length > 100) return NextResponse.json({ ok: false, error: "한 번에 100개까지" }, { status: 400 });

  const sb = getServerSupabase();
  const results: { product_name: string; slug: string }[] = [];
  const errors: string[] = [];
  for (const name of names) {
    try {
      const slug = await slugifyProductName(name);
      await sb.from("vivacon_product_slugs").upsert(
        { product_name: name, slug, updated_at: new Date().toISOString() },
        { onConflict: "product_name" },
      );
      results.push({ product_name: name, slug });
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : "생성 실패"}`);
    }
  }
  return NextResponse.json({ ok: true, generated: results, errors });
}

// PATCH: 영문명 수동 저장. body { product_name, slug }
export async function PATCH(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  let body: { product_name?: string; slug?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const product_name = strip(String(body.product_name ?? ""));
  if (!product_name) return NextResponse.json({ ok: false, error: "product_name 필요" }, { status: 400 });
  const slug = sanitizeSlug(String(body.slug ?? ""));
  try {
    const sb = getServerSupabase();
    await sb.from("vivacon_product_slugs").upsert(
      { product_name, slug, updated_at: new Date().toISOString() },
      { onConflict: "product_name" },
    );
    return NextResponse.json({ ok: true, product_name, slug });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "저장 실패" }, { status: 500 });
  }
}
