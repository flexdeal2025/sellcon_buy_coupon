import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ingestAuthOk } from "@/lib/ingest-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

// 셀콘 정산완료 스냅샷 (PAYOUT_COMPLETED 시 셀콘이 호출).
//  · 확정 지급일(payout_date) + 실명 해시(kyc_name_hash, 평문 아님)를 봉인.
//  · 목적: 셀콘 데이터 소실 시에도 소명 가능한 최소 증거를 타워에 보존(내구성 안전판).
//  스키마: schema_stock_ingest_payout.sql (kyc_name_hash, payout_locked_at)
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request) {
  if (!ingestAuthOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }

  const source_ref = String(b.source_ref ?? "").trim();
  if (!source_ref) return NextResponse.json({ ok: false, error: "source_ref 필요" }, { status: 400 });

  const payoutDateRaw = String(b.payout_date ?? "").trim();
  const payoutDate = isDate(payoutDateRaw) ? payoutDateRaw : null;
  const kycHash = String(b.kyc_name_hash ?? "").trim();

  try {
    const sb = getServerSupabase();
    // 해당 재고가 있어야 봉인 (먼저 ingest 된 건만 대상)
    const found = await sb.from("stock_registrations").select("id").eq("source_ref", source_ref).maybeSingle();
    if (!found.data?.id) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const update: Record<string, unknown> = { payout_locked_at: new Date().toISOString() };
    if (payoutDate) update.payout_date = payoutDate;
    if (kycHash) update.kyc_name_hash = kycHash;

    const { error } = await sb.from("stock_registrations").update(update).eq("source_ref", source_ref);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, locked: true, id: String(found.data.id) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "snapshot 실패" }, { status: 500 });
  }
}
