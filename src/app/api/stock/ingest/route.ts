import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { deleteOcrImage } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

// 셀콘(A경로) → 컨트롤타워 재고 직결.
//  · POST   /api/stock/ingest                    : 판매동의완료 시 재고 1건 푸시 → stock_registrations(pending)
//  · DELETE /api/stock/ingest?source_ref=...      : 동의 후 취소/반려 시 미발행분 철회
// 계약: 셀콘_Phase1_구현완료_전달.md / 설계서_셀콘_재고직결.md
// 8초 내 응답을 위해 이미지 GCP 적재는 하지 않고 원본 공개 URL만 보존(발행/후속에서 materialize).

const pad = (n: number) => String(n).padStart(2, "0");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// 금액 정제: 빈값/미인식 → null (0은 유효값으로 보존)
function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 매입일(없으면 오늘) → YYMMDD. 셀콘 배치는 일 단위 SC-YYMMDD.
function ymdOf(purchaseDate: string | null): string {
  if (purchaseDate && isDate(purchaseDate)) return purchaseDate.replaceAll("-", "").slice(2);
  const n = new Date();
  return `${pad(n.getFullYear() % 100)}${pad(n.getMonth() + 1)}${pad(n.getDate())}`;
}

// Authorization: Bearer <STOCK_INGEST_KEY>. 키 미설정이면 거부(연동 비활성=잠금).
function authOk(req: Request): boolean {
  const key = process.env.STOCK_INGEST_KEY;
  if (!key) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return !!m && m[1] === key;
}

// 셀콘 일배치(SC-YYMMDD) 확보. 동시성 시 재조회로 수렴.
async function ensureSellconBatch(
  sb: ReturnType<typeof getServerSupabase>,
  ymd: string,
): Promise<{ id: string; batch_no: string }> {
  const batch_no = `SC-${ymd}`;
  const { data: existing } = await sb.from("stock_batches").select("id").eq("batch_no", batch_no).maybeSingle();
  if (existing?.id) return { id: existing.id as string, batch_no };
  const { data: nb, error } = await sb.from("stock_batches")
    .insert({ batch_no, storage_type: "code", default_exchange_location: "셀콘", created_by: "sellcon" })
    .select("id").single();
  if (error) {
    const { data: again } = await sb.from("stock_batches").select("id").eq("batch_no", batch_no).maybeSingle();
    if (again?.id) return { id: again.id as string, batch_no };
    throw new Error(error.message);
  }
  return { id: nb.id as string, batch_no };
}

export async function POST(req: Request) {
  if (!authOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }

  const source_ref = String(b.source_ref ?? "").trim();
  if (!source_ref) return NextResponse.json({ ok: false, error: "source_ref 필요" }, { status: 400 });

  const sb = getServerSupabase();

  // 멱등: 이미 있으면 기존 id 반환(신규 생성 안 함)
  const dup = await sb.from("stock_registrations").select("id, batch_id").eq("source_ref", source_ref).maybeSingle();
  if (dup.data?.id) {
    let batch_no = "";
    if (dup.data.batch_id) {
      const bt = await sb.from("stock_batches").select("batch_no").eq("id", dup.data.batch_id).maybeSingle();
      batch_no = (bt.data?.batch_no as string) ?? "";
    }
    return NextResponse.json({ ok: true, id: String(dup.data.id), batch_no, deduped: true });
  }

  // 필드 정제
  const couponCode = b.coupon_code == null ? "" : String(b.coupon_code).replace(/\s+/g, "").trim();
  const storedAsCode = b.stored_as_code === true || (b.stored_as_code == null && couponCode !== "");
  const expiryRaw = b.expiry_date == null ? "" : String(b.expiry_date).trim();
  const expiry = isDate(expiryRaw) ? expiryRaw : null;
  const pdRaw = String(b.purchase_date ?? "").trim();
  const purchaseDate = isDate(pdRaw) ? pdRaw : null;
  const imageUrl = String(b.image_url ?? "").trim();

  try {
    const { id: batchId, batch_no } = await ensureSellconBatch(sb, ymdOf(purchaseDate));

    const insert = await sb.from("stock_registrations").insert({
      batch_id: batchId,
      image_path: "",                 // GCP materialize는 발행/후속 단계(8초 응답 보장)
      product_name: String(b.product_name ?? "").trim(),
      option_name: String(b.option_name ?? "").trim(),
      coupon_code: couponCode,
      expiry_date: expiry,
      exchange_location: "",
      supplier: String(b.supplier ?? "셀콘").trim(),
      purchase_date: purchaseDate,
      unit_cost: toInt(b.unit_cost),
      inspection_status: "pending",   // 자동 적재는 검수대기까지만 (실판매 발행은 관리자 수동)
      stored_as_code: storedAsCode,
      // 출처·증빙
      source: "sellcon",
      source_ref,
      purchase_channel: String(b.purchase_channel ?? "sellcon_auto").trim(),
      proof_type: String(b.proof_type ?? "").trim(),
      payout_uuid: String(b.payout_uuid ?? "").trim(),
      payout_amount: toInt(b.payout_amount),
      bonus_amount: toInt(b.bonus_amount) ?? 0,
      seller_ref: String(b.seller_ref ?? "").trim(),
      seller_name_masked: String(b.seller_name_masked ?? "").trim(),
      source_image_url: imageUrl,
    }).select("id").single();

    if (insert.error) {
      // 동시성(유니크 위반 등): 멱등 재조회로 수렴
      const race = await sb.from("stock_registrations").select("id").eq("source_ref", source_ref).maybeSingle();
      if (race.data?.id) return NextResponse.json({ ok: true, id: String(race.data.id), batch_no, deduped: true });
      throw new Error(insert.error.message);
    }
    return NextResponse.json({ ok: true, id: String(insert.data.id), batch_no, deduped: false });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "ingest 실패" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!authOk(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const source_ref = new URL(req.url).searchParams.get("source_ref");
  if (!source_ref) return NextResponse.json({ ok: false, error: "source_ref 필요" }, { status: 400 });

  try {
    const sb = getServerSupabase();
    const row = await sb.from("stock_registrations").select("id, published, image_path").eq("source_ref", source_ref).maybeSingle();
    if (!row.data?.id) return NextResponse.json({ ok: true, withdrawn: false, reason: "not_found" });
    if (row.data.published) return NextResponse.json({ ok: true, withdrawn: false, reason: "published" });

    if (row.data.image_path) { try { await deleteOcrImage(String(row.data.image_path)); } catch { /* best-effort */ } }
    const del = await sb.from("stock_registrations").delete().eq("id", row.data.id);
    if (del.error) throw new Error(del.error.message);
    return NextResponse.json({ ok: true, withdrawn: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "withdraw 실패" }, { status: 500 });
  }
}
