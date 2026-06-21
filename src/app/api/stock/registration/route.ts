import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { deleteOcrImage } from "@/lib/gcp/storage";

export const runtime = "nodejs";

// 스테이징 행 삭제 (미발행만) — 중지 취소/카드 삭제용. GCP 이미지도 함께 삭제.
export async function DELETE(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { data: row } = await sb.from("stock_registrations").select("image_path, published").eq("id", id).single();
    if (row?.published) return NextResponse.json({ ok: false, error: "이미 발행된 항목은 삭제 불가" }, { status: 400 });
    if (row?.image_path) await deleteOcrImage(row.image_path);
    const { error } = await sb.from("stock_registrations").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}

// 스테이징 행 검수 수정 (허용 컬럼만)
export async function PATCH(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let body: { id?: string; patch?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const { id, patch } = body;
  if (!id || !patch) return NextResponse.json({ ok: false, error: "id / patch 필요" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if ("product_name" in patch) update.product_name = String(patch.product_name ?? "").trim();
  if ("option_name" in patch) update.option_name = String(patch.option_name ?? "").trim();
  if ("product_slug" in patch) update.product_slug = String(patch.product_slug ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "").slice(0, 40);
  if ("coupon_code" in patch) update.coupon_code = String(patch.coupon_code ?? "").replace(/\s+/g, "").trim();
  if ("exchange_location" in patch) update.exchange_location = String(patch.exchange_location ?? "").trim();
  if ("supplier" in patch) update.supplier = String(patch.supplier ?? "").trim();
  if ("notes" in patch) update.notes = String(patch.notes ?? "").trim();
  if ("expiry_date" in patch) {
    const d = String(patch.expiry_date ?? "").trim();
    if (d === "") update.expiry_date = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(d)) update.expiry_date = d;
    else return NextResponse.json({ ok: false, error: "유효기간 형식 오류(YYYY-MM-DD)" }, { status: 400 });
  }
  if ("purchase_date" in patch) {
    const d = String(patch.purchase_date ?? "").trim();
    update.purchase_date = d === "" ? null : d;
  }
  if ("unit_cost" in patch) {
    const raw = String(patch.unit_cost ?? "").replace(/[^0-9-]/g, "");
    update.unit_cost = raw === "" ? null : Number(raw);
  }
  if ("stored_as_code" in patch) update.stored_as_code = !!patch.stored_as_code;
  if ("inspection_status" in patch) {
    const s = String(patch.inspection_status ?? "");
    if (!["pending", "approved", "rejected"].includes(s)) {
      return NextResponse.json({ ok: false, error: "검수상태 값 오류" }, { status: 400 });
    }
    update.inspection_status = s;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: false, error: "수정할 항목 없음" }, { status: 400 });

  try {
    const sb = getServerSupabase();
    const { data, error } = await sb.from("stock_registrations").update(update).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, row: data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "수정 실패" }, { status: 500 });
  }
}
