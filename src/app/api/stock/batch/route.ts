import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { deleteOcrImage } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const pad = (n: number) => String(n).padStart(2, "0");

// 업로드 배치 생성 (batch_no = YYYYMMDD_NN 자동)
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let body: {
    storage_type?: string;
    default_product_name?: string;
    default_exchange_location?: string;
    purchase_date?: string;
    created_by?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }

  const storage_type = body.storage_type === "code" ? "code" : "image";
  try {
    const sb = getServerSupabase();
    const now = new Date();
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const { count } = await sb
      .from("stock_batches")
      .select("id", { count: "exact", head: true })
      .like("batch_no", `${ymd}_%`);
    const batch_no = `${ymd}_${pad((count ?? 0) + 1)}`;

    const { data, error } = await sb
      .from("stock_batches")
      .insert({
        batch_no,
        storage_type,
        default_product_name: (body.default_product_name ?? "").trim(),
        default_exchange_location: (body.default_exchange_location ?? "").trim(),
        purchase_date: body.purchase_date || null,
        created_by: (body.created_by ?? "").trim(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, batch: data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "배치 생성 실패" }, { status: 500 });
  }
}

// 배치 삭제 — 발행분이 있으면 거부(보호). 미발행 배치는 GCP 이미지 정리 후 삭제(stock_registrations는 ON DELETE CASCADE).
export async function DELETE(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { data: regs, error: e1 } = await sb.from("stock_registrations")
      .select("id, image_path, published").eq("batch_id", id);
    if (e1) throw new Error(e1.message);

    const publishedCount = (regs ?? []).filter((r) => r.published).length;
    if (publishedCount > 0) {
      return NextResponse.json({ ok: false, error: `발행된 ${publishedCount}건이 있어 배치를 삭제할 수 없습니다(발행분 보호). 발행 전 항목만 가능합니다.` }, { status: 400 });
    }
    // GCP 이미지 정리(best-effort) — DB cascade는 GCP를 건드리지 않음
    for (const r of regs ?? []) {
      if (r.image_path) { try { await deleteOcrImage(String(r.image_path)); } catch { /* 무시 */ } }
    }
    const { error: e2 } = await sb.from("stock_batches").delete().eq("id", id);
    if (e2) throw new Error(e2.message);
    return NextResponse.json({ ok: true, deleted: (regs ?? []).length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "배치 삭제 실패" }, { status: 500 });
  }
}
