import { NextResponse } from "next/server";
import {
  getVivaconSupabase,
  checkAppPasscode,
  sanitizeCouponPatch,
  COUPON_SELECT,
} from "@/lib/supabase/vivacon";

export const runtime = "nodejs";

// 단일 행 삭제 — available 상태만 허용 (allocated/exchanged 보호)
export async function DELETE(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getVivaconSupabase();
    const { data: row, error: fetchErr } = await sb
      .from("coupon_codes").select("id, status").eq("id", id).single();
    if (fetchErr || !row) return NextResponse.json({ ok: false, error: "항목 없음" }, { status: 404 });
    const status = (row as { id: string; status: string | null }).status;
    if (status !== "available") {
      return NextResponse.json({ ok: false, error: `삭제 불가 — 현재 상태: ${status} (available 건만 삭제 가능)` }, { status: 400 });
    }
    const { error } = await sb.from("coupon_codes").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}

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
