import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";

export const runtime = "nodejs";

// 증빙 ↔ 재고 연결 (1:1 또는 N:1 — 한 증빙에 여러 재고)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  let body: { proof_id?: string; registration_ids?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const { proof_id, registration_ids } = body;
  if (!proof_id || !Array.isArray(registration_ids) || registration_ids.length === 0) {
    return NextResponse.json({ ok: false, error: "proof_id / registration_ids 필요" }, { status: 400 });
  }
  try {
    const sb = getServerSupabase();
    // registration_id UNIQUE → 기존 매핑이 있으면 교체(upsert)
    const payload = registration_ids.map((rid) => ({ proof_id, registration_id: rid }));
    const { error } = await sb.from("proof_registration_links").upsert(payload, { onConflict: "registration_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, linked: registration_ids.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "연결 실패" }, { status: 500 });
  }
}

// 연결 해제 (재고 기준)
export async function DELETE(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  const rid = new URL(req.url).searchParams.get("registration_id");
  if (!rid) return NextResponse.json({ ok: false, error: "registration_id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { error } = await sb.from("proof_registration_links").delete().eq("registration_id", rid);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "해제 실패" }, { status: 500 });
  }
}
