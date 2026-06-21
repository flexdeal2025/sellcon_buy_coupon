import { NextResponse } from "next/server";
import {
  getVivaconSupabase,
  checkAppPasscode,
  sanitizeCouponPatch,
  COUPON_SELECT,
} from "@/lib/supabase/vivacon";

export const runtime = "nodejs";

// 단일 행 수정
export async function PATCH(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  let body: { id?: string; patch?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const { id, patch } = body;
  if (!id || !patch || typeof patch !== "object") {
    return NextResponse.json({ ok: false, error: "id / patch 필요" }, { status: 400 });
  }

  const { update, error: vErr } = sanitizeCouponPatch(patch);
  if (vErr) return NextResponse.json({ ok: false, error: vErr }, { status: 400 });

  try {
    const sb = getVivaconSupabase();
    const { data, error } = await sb
      .from("coupon_codes")
      .update(update!)
      .eq("id", id)
      .select(COUPON_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, row: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "수정 실패";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
