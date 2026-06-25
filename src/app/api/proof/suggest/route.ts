import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { suggestMatches } from "@/lib/proof-match";

export const runtime = "nodejs";
export const maxDuration = 30;

// 증빙 1건에 대한 재고 매핑 추천 (상품명 유사도 + 금액 조합, N:1 포함)
// GET ?proof_id=...&supplier=...
export async function GET(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });

  const url = new URL(req.url);
  const proofId = url.searchParams.get("proof_id");
  const supplier = url.searchParams.get("supplier");
  if (!proofId) return NextResponse.json({ ok: false, error: "proof_id 필요" }, { status: 400 });

  try {
    const sb = getServerSupabase();

    const { data: proof, error: pe } = await sb.from("purchase_proofs").select("*").eq("id", proofId).single();
    if (pe || !proof) throw new Error(pe?.message ?? "증빙 없음");

    // OCR 추출 상품명 (없으면 매핑 추천 불가 — 마이그레이션/재OCR 필요)
    const proofName: string = proof.ocr_product_name ?? "";
    if (!proofName) {
      return NextResponse.json({
        ok: true, candidates: [], recommended_ids: [], amount_matched: false,
        note: "OCR 상품명이 없습니다. 마이그레이션 적용 또는 재업로드가 필요합니다.",
      });
    }

    // 미연결 재고만 후보로
    let q = sb
      .from("stock_registrations")
      .select("id,product_name,option_name,unit_cost,coupon_code,expiry_date,created_at,purchase_date")
      .order("created_at", { ascending: true });
    if (supplier) q = q.eq("supplier", supplier);
    const { data: regs, error: re } = await q;
    if (re) throw new Error(re.message);

    const ids = (regs ?? []).map((r) => r.id);
    const linked = new Set<string>();
    if (ids.length) {
      const { data: links } = await sb
        .from("proof_registration_links")
        .select("registration_id")
        .in("registration_id", ids);
      for (const l of links ?? []) linked.add(l.registration_id);
    }
    const unmapped = (regs ?? []).filter((r) => !linked.has(r.id));

    const result = suggestMatches({
      proof_product_name: proofName,
      proof_date: proof.proof_date ?? null,
      total_amount: proof.amount ?? null,
      product_amount: proof.product_amount ?? proof.amount ?? null,
      registrations: unmapped,
    });

    return NextResponse.json({ ok: true, ...result, proof_name: proofName });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "추천 실패" }, { status: 500 });
  }
}
