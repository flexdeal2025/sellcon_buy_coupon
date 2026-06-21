import { NextResponse } from "next/server";
import {
  getVivaconSupabase,
  checkAppPasscode,
  sanitizeCouponPatch,
} from "@/lib/supabase/vivacon";

export const runtime = "nodejs";
export const maxDuration = 30;

// 다중 행 일괄 수정 (선택한 id들에 동일 patch 적용)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  let body: { ids?: string[]; patch?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const { ids, patch } = body;
  if (!Array.isArray(ids) || ids.length === 0 || !patch || typeof patch !== "object") {
    return NextResponse.json({ ok: false, error: "ids / patch 필요" }, { status: 400 });
  }
  if (ids.length > 2000) {
    return NextResponse.json({ ok: false, error: "한 번에 2000건까지" }, { status: 400 });
  }

  const { update, error: vErr } = sanitizeCouponPatch(patch);
  if (vErr) return NextResponse.json({ ok: false, error: vErr }, { status: 400 });

  try {
    const sb = getVivaconSupabase();
    const { data, error } = await sb
      .from("coupon_codes")
      .update(update!)
      .in("id", ids)
      .select("id");
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, count: (data ?? []).length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "일괄 수정 실패";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
