import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { getSignedReadUrl, deleteOcrImage, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

// 증빙 목록 (서명URL + 연결된 재고 수/매입원가 합계)
export async function GET(req: Request) {
  try {
    const sb = getServerSupabase();
    const url = new URL(req.url);
    const platform = url.searchParams.get("platform");
    const date = url.searchParams.get("date"); // proof_date 정확일치

    let q = sb.from("purchase_proofs").select("*").order("created_at", { ascending: false });
    if (platform) q = q.eq("platform", platform);
    if (date) q = q.eq("proof_date", date);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // 연결 집계 (건수 + 연결 재고 매입원가 합계)
    const ids = (data ?? []).map((p) => p.id);
    const linkCount: Record<string, number> = {};
    const linkCost: Record<string, number> = {};
    if (ids.length) {
      const { data: links } = await sb.from("proof_registration_links").select("proof_id, registration_id").in("proof_id", ids);
      const regIds = (links ?? []).map((l) => l.registration_id);
      const costById: Record<string, number> = {};
      if (regIds.length) {
        const { data: regs } = await sb.from("stock_registrations").select("id, unit_cost").in("id", regIds);
        for (const r of regs ?? []) costById[r.id] = r.unit_cost ?? 0;
      }
      for (const l of links ?? []) {
        linkCount[l.proof_id] = (linkCount[l.proof_id] ?? 0) + 1;
        linkCost[l.proof_id] = (linkCost[l.proof_id] ?? 0) + (costById[l.registration_id] ?? 0);
      }
    }

    const rows = await Promise.all(
      (data ?? []).map(async (p) => ({
        ...p,
        image_url: p.image_path ? await getSignedReadUrl(OCR_BUCKET, p.image_path) : "",
        linked_count: linkCount[p.id] ?? 0,
        linked_cost: linkCost[p.id] ?? 0,
      })),
    );
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}

// 증빙 삭제 (GCP 이미지 + 행, 연결은 CASCADE)
export async function DELETE(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { data: row } = await sb.from("purchase_proofs").select("image_path").eq("id", id).single();
    if (row?.image_path) await deleteOcrImage(row.image_path);
    const { error } = await sb.from("purchase_proofs").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}
