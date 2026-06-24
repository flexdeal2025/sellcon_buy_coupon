import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { resolveOptionName } from "@/lib/option-map";

export const runtime = "nodejs";

// 선택한 스테이징 행들의 옵션명을 상품명 기준으로 자동 채움.
// 기본은 '빈 옵션명'만 채움(수기 입력값 보존). overwrite=true 면 선택 전부 재설정.
// product_option_map 매칭 → 미매칭 시 DEFAULT_OPTION. 미발행 행만 대상.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let body: { ids?: string[]; overwrite?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const ids = (body.ids ?? []).filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "ids 필요" }, { status: 400 });
  const overwrite = !!body.overwrite;

  try {
    const sb = getServerSupabase();
    const { data, error } = await sb
      .from("stock_registrations")
      .select("id, product_name, option_name, published")
      .in("id", ids);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; product_name: string | null; option_name: string | null; published: boolean }[];

    const cache = new Map<string, string>(); // 동일 상품명 재조회 방지
    const updated: { id: string; option_name: string }[] = [];
    for (const r of rows) {
      if (r.published) continue;
      if (!overwrite && (r.option_name ?? "").trim()) continue;
      const product = (r.product_name ?? "").trim();
      if (!product) continue;
      let opt = cache.get(product);
      if (opt === undefined) { opt = await resolveOptionName(sb, product); cache.set(product, opt); }
      const { error: ue } = await sb.from("stock_registrations").update({ option_name: opt }).eq("id", r.id);
      if (!ue) updated.push({ id: r.id, option_name: opt });
    }
    return NextResponse.json({ ok: true, count: updated.length, updated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "자동채움 실패" }, { status: 500 });
  }
}
