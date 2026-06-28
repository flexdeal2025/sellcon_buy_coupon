import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 쿠폰 추적(이력 조회) — 쿠폰번호 1개로 매입→재고→판매→발송 전 과정을 한 번에 조회.
 *
 * 연결 키(실측 검증):
 *  - 매입(우리 stock_registrations).coupon_code = 쿠폰번호
 *  - 재고(vivacon coupon_codes).coupon_code = 쿠폰번호  (코드형만, 이미지형은 GCP)
 *  - 판매(vivacon gifticon_orders): 코드형 = 쿠폰코드/coupon_code_id, 이미지형 = 파일명에 임베드
 *  - 발송(vivacon dispatch_audit_log).gifticon_order_id = gifticon_orders.id
 *    (외부 개발자가 알림톡 발송 직후 별도로 찍는 권위 있는 발송 로그)
 */

// ── PII 마스킹 (CS 식별용 최소노출: 이름 첫글자+*, 전화 뒤4자리) ──
function maskName(s: string | null | undefined): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (t.length <= 1) return t;
  return t[0] + "*".repeat(Math.max(1, t.length - 1));
}
function maskPhone(s: string | null | undefined): string {
  const d = String(s ?? "").replace(/[^0-9]/g, "");
  if (!d) return "";
  if (d.length < 4) return "****";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

type AnyRow = Record<string, unknown>;

export async function GET(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  const url = new URL(req.url);
  let code = (url.searchParams.get("code") ?? "").replace(/\s+/g, "").trim();
  const order = (url.searchParams.get("order") ?? "").trim();

  if (!code && !order) {
    return NextResponse.json({ ok: false, error: "쿠폰번호(code) 또는 주문번호(order) 필요" }, { status: 400 });
  }

  try {
    const ours = getServerSupabase();
    // 한글 컬럼(상품명/쿠폰코드/구매자명 등) select는 supabase-js 타입 파서가 막아 any로 회피
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vc = getVivaconSupabase() as any;

    // 주문번호로 들어온 경우: 판매 행에서 쿠폰번호 역추적 (코드형은 쿠폰코드, 이미지형은 파일명)
    if (!code && order) {
      const { data: byOrder } = await vc
        .from("gifticon_orders")
        .select("쿠폰코드, 파일명")
        .or(`주문번호.eq.${order},parent_order_number.eq.${order}`)
        .limit(1);
      const row = (byOrder ?? [])[0] as AnyRow | undefined;
      if (row?.["쿠폰코드"]) code = String(row["쿠폰코드"]);
      else if (row?.["파일명"]) {
        // 파일명 규칙: 매입일_매입처_상품_쿠폰번호_유효기간.ext → 긴 숫자열 추출
        const m = String(row["파일명"]).match(/_(\d{8,})_/);
        if (m) code = m[1];
      }
    }

    // 1) 매입 (우리 시스템)
    const purchaseQ = code
      ? ours
          .from("stock_registrations")
          .select(
            "id, product_name, option_name, coupon_code, supplier, purchase_channel, source, source_ref, purchase_date, unit_cost, proof_type, payout_amount, seller_name_masked, batch_id, stored_as_code, published, published_ref, published_at, inspection_status, expiry_date, created_at",
          )
          .eq("coupon_code", code)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as AnyRow[] });

    // 2) 재고 코드 (vivacon — 코드형만 존재)
    const stockQ = code
      ? vc
          .from("coupon_codes")
          .select("id, 상품명, 옵션명, coupon_code, status, expiry_date, expiry_yymmdd, 매입원가, allocated_at, allocated_to, batch_id, 이슈사항, created_at")
          .eq("coupon_code", code)
      : Promise.resolve({ data: [] as AnyRow[] });

    const [purchaseRes, stockRes] = await Promise.all([purchaseQ, stockQ]);
    const purchase = (purchaseRes.data ?? []) as AnyRow[];
    const stock = (stockRes.data ?? []) as AnyRow[];

    // 3) 판매 (vivacon gifticon_orders) — 코드형: 쿠폰코드, 이미지형: 파일명 임베드
    let sale: AnyRow[] = [];
    if (code) {
      const { data: byCode } = await vc
        .from("gifticon_orders")
        .select("id, 주문번호, parent_order_number, unit_index, product_type, 상품명, 옵션명, 유효기간, 판매시간, status, 구매자명, 수령자명, 수령자_전화번호, alimtalk_sent, alimtalk_sent_at, dispatch_completed, dispatch_failed, first_accessed_at, last_accessed_at, coupon_public_url, 파일명, exchanged_at, exchanged_from, exchanged_to, exchanged_reason, created_at")
        .eq("쿠폰코드", code)
        .order("판매시간", { ascending: true });
      sale = (byCode ?? []) as AnyRow[];
      // 코드형으로 못 찾으면 이미지형으로 재시도.
      // 이미지형 판매행의 원본_파일경로 = 우리 발행 pending 경로(파일명에 쿠폰번호 임베드).
      // (파일명 컬럼은 UUID라 매칭 불가 → 원본_파일경로/전송완료_파일경로로 매칭)
      if (sale.length === 0) {
        const SALE_COLS = "id, 주문번호, parent_order_number, unit_index, product_type, 상품명, 옵션명, 유효기간, 판매시간, status, 구매자명, 수령자명, 수령자_전화번호, alimtalk_sent, alimtalk_sent_at, dispatch_completed, dispatch_failed, first_accessed_at, last_accessed_at, coupon_public_url, 파일명, exchanged_at, exchanged_from, exchanged_to, exchanged_reason, created_at";
        const { data: byPath } = await vc
          .from("gifticon_orders")
          .select(SALE_COLS)
          .or(`원본_파일경로.ilike.%${code}%,전송완료_파일경로.ilike.%${code}%`)
          .order("판매시간", { ascending: true });
        sale = (byPath ?? []) as AnyRow[];
      }
    }

    // 4) 발송 audit (vivacon dispatch_audit_log) — 알림톡 발송 직후 찍히는 권위 로그
    let dispatch: AnyRow[] = [];
    const saleIds = sale.map((s) => String(s.id)).filter(Boolean);
    if (saleIds.length) {
      const { data: aud } = await vc
        .from("dispatch_audit_log")
        .select("id, gifticon_order_id, smartstore_product_order_id, product_name, option_name, order_quantity, order_total_amount, payment_date, orderer_name, orderer_phone, recipient_name, recipient_phone, smartstore_order_status, alimtalk_sent_at, smartstore_dispatch_completed_at, ppurio_response_code, ppurio_description, record_status, created_at")
        .in("gifticon_order_id", saleIds)
        .order("created_at", { ascending: true });
      dispatch = (aud ?? []) as AnyRow[];
    }

    // 판매·발송 PII 마스킹
    const saleSafe = sale.map((s) => ({
      ...s,
      구매자명: maskName(s["구매자명"] as string),
      수령자명: maskName(s["수령자명"] as string),
      수령자_전화번호: maskPhone(s["수령자_전화번호"] as string),
    }));
    const dispatchSafe = dispatch.map((d) => ({
      ...d,
      orderer_name: maskName(d.orderer_name as string),
      orderer_phone: maskPhone(d.orderer_phone as string),
      recipient_name: maskName(d.recipient_name as string),
      recipient_phone: maskPhone(d.recipient_phone as string),
    }));

    // 형태 판정: 재고코드 존재 → 코드형 / 판매행 product_type / 매입행 stored_as_code
    const typeGuess =
      stock.length > 0 || sale.some((s) => s.product_type === "code")
        ? "code"
        : sale.some((s) => s.product_type === "image") || purchase.some((p) => p.stored_as_code === false)
          ? "image"
          : "unknown";

    return NextResponse.json({
      ok: true,
      query: { code: code || null, order: order || null, type: typeGuess },
      found: {
        purchase: purchase.length > 0,
        stock: stock.length > 0,
        sale: saleSafe.length > 0,
        dispatch: dispatchSafe.length > 0,
      },
      purchase,
      stock,
      sale: saleSafe,
      dispatch: dispatchSafe,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "추적 조회 실패" },
      { status: 500 },
    );
  }
}
