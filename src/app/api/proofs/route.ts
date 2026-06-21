import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

// 증빙 목록 (서명URL + 연결된 재고 수)
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

    // 연결 수 집계
    const ids = (data ?? []).map((p) => p.id);
    const linkCount: Record<string, number> = {};
    if (ids.length) {
      const { data: links } = await sb.from("proof_registration_links").select("proof_id").in("proof_id", ids);
      for (const l of links ?? []) linkCount[l.proof_id] = (linkCount[l.proof_id] ?? 0) + 1;
    }

    const rows = await Promise.all(
      (data ?? []).map(async (p) => ({
        ...p,
        image_url: p.image_path ? await getSignedReadUrl(OCR_BUCKET, p.image_path) : "",
        linked_count: linkCount[p.id] ?? 0,
      })),
    );
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
