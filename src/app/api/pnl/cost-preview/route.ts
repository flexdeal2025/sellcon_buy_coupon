import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";

export const runtime = "nodejs";
export const maxDuration = 60;

// 실원가 dry-run: 구매확정 주문의 "발송된 실제 쿠폰 매입원가"를 추적해 현재 반영원가와 비교.
// 읽기 전용 — order_cost/product_cost에 쓰지 않음. 정확도 검수용.
// 추적: settlements.product_order_id → dispatch_audit_log → gifticon_orders
//       → (코드형) 쿠폰코드=stock_registrations.coupon_code / (이미지형) 원본_파일경로=published_ref → unit_cost
export async function GET(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit") ?? 500)));

    const ours = getServerSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vc = getVivaconSupabase() as any;

    // 1) 구매확정 주문 (정산 매출)
    let sq = ours.from("smartstore_settlements")
      .select("product_order_id, channel_product_no, product_name, quantity, settle_amount, decision_date")
      .eq("order_status", "PURCHASE_DECIDED").not("settle_amount", "is", null)
      .order("decision_date", { ascending: false }).limit(limit);
    if (from) sq = sq.gte("decision_date", from);
    if (to) sq = sq.lte("decision_date", to);
    const { data: orders, error: e1 } = await sq;
    if (e1) throw new Error(e1.message);
    const orderList = orders ?? [];
    const orderIds = orderList.map((o) => o.product_order_id).filter(Boolean);

    // 2) 현재 반영원가: order_cost(주문별) + product_cost(상품 기간)
    const ocMap = new Map<string, number>();
    for (let i = 0; i < orderIds.length; i += 500) {
      const { data } = await ours.from("order_cost").select("product_order_id, cost_amount").in("product_order_id", orderIds.slice(i, i + 500));
      for (const r of data ?? []) ocMap.set(r.product_order_id, Number(r.cost_amount) || 0);
    }
    const { data: pcAll } = await ours.from("product_cost").select("channel_product_no, unit_cost, effective_from, effective_to");
    const pcByChannel = new Map<number, { unit_cost: number; effective_from: string; effective_to: string | null }[]>();
    for (const c of pcAll ?? []) {
      const arr = pcByChannel.get(c.channel_product_no) ?? [];
      arr.push(c); pcByChannel.set(c.channel_product_no, arr);
    }
    const findPc = (ch: number, date: string): number | null => {
      const list = pcByChannel.get(ch); if (!list || !date) return null;
      const m = list.filter((c) => c.effective_from <= date && (!c.effective_to || date <= c.effective_to))
        .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
      return m ? Number(m.unit_cost) : null;
    };

    // 3) 우리 재고 실매입원가 맵 (coupon_code→unit_cost, published_ref→unit_cost)
    const codeCost = new Map<string, number>();
    const refCost = new Map<string, number>();
    for (let i = 0; ; i += 1000) {
      const { data } = await ours.from("stock_registrations").select("coupon_code, published_ref, unit_cost").range(i, i + 999);
      for (const r of data ?? []) {
        const uc = r.unit_cost == null ? null : Number(r.unit_cost);
        if (uc == null) continue;
        if (r.coupon_code) codeCost.set(r.coupon_code, uc);
        if (r.published_ref) refCost.set(r.published_ref, uc);
      }
      if (!data || data.length < 1000) break;
    }

    // 4) 발송로그: product_order_id → gifticon_order_id
    const orderToGid = new Map<string, string[]>();
    for (let i = 0; i < orderIds.length; i += 200) {
      const { data } = await vc.from("dispatch_audit_log")
        .select("smartstore_product_order_id, gifticon_order_id").in("smartstore_product_order_id", orderIds.slice(i, i + 200));
      for (const r of data ?? []) {
        const k = r.smartstore_product_order_id; if (!k || !r.gifticon_order_id) continue;
        const arr = orderToGid.get(k) ?? []; arr.push(r.gifticon_order_id); orderToGid.set(k, arr);
      }
    }

    // 5) gifticon_orders: id → 쿠폰코드/원본_파일경로
    const allGids = [...new Set([...orderToGid.values()].flat())];
    const gidInfo = new Map<string, { code: string | null; ref: string | null }>();
    for (let i = 0; i < allGids.length; i += 200) {
      const { data } = await vc.from("gifticon_orders").select("id, 쿠폰코드, 원본_파일경로").in("id", allGids.slice(i, i + 200));
      for (const r of data ?? []) gidInfo.set(r.id, { code: r["쿠폰코드"] ?? null, ref: r["원본_파일경로"] ?? null });
    }

    // 6) 주문별 결과 조립
    const rows = orderList.map((o) => {
      const qty = Number(o.quantity) || 1;
      const currentOrderCost = ocMap.get(o.product_order_id) ?? null;
      const currentProductCost = currentOrderCost == null ? (findPc(Number(o.channel_product_no), o.decision_date) ?? null) : null;
      const currentCost = currentOrderCost != null ? currentOrderCost
        : currentProductCost != null ? currentProductCost * qty : null;
      const currentSource = currentOrderCost != null ? "order" : currentProductCost != null ? "product" : "none";

      const gids = orderToGid.get(o.product_order_id) ?? [];
      let autoCost = 0; let coupons = 0; let known = 0;
      for (const gid of gids) {
        const info = gidInfo.get(gid); if (!info) continue;
        coupons++;
        const uc = info.code ? codeCost.get(info.code) : (info.ref ? refCost.get(info.ref) : undefined);
        if (uc != null) { autoCost += uc; known++; }
      }
      const traceable = gids.length > 0;
      const costKnown = coupons > 0 && known === coupons; // 발송쿠폰 전부 실원가 확보
      const settle = Number(o.settle_amount) || 0;
      return {
        product_order_id: o.product_order_id,
        product_name: o.product_name,
        decision_date: o.decision_date,
        quantity: qty,
        settle_amount: settle,
        current_cost: currentCost,
        current_source: currentSource,
        auto_cost: costKnown ? autoCost : null,
        auto_coupons: coupons,
        auto_known: known,
        traceable,
        cost_known: costKnown,
        diff: costKnown && currentCost != null ? currentCost - autoCost : null,
      };
    });

    // 7) 요약
    const withAuto = rows.filter((r) => r.cost_known);
    const summary = {
      total: rows.length,
      traceable: rows.filter((r) => r.traceable).length,
      autoCostKnown: withAuto.length,
      settleSum: rows.reduce((s, r) => s + r.settle_amount, 0),
      autoCostSum: withAuto.reduce((s, r) => s + (r.auto_cost ?? 0), 0),
      autoProfitSum: withAuto.reduce((s, r) => s + (r.settle_amount - (r.auto_cost ?? 0)), 0),
      currentCostSumOnAuto: withAuto.reduce((s, r) => s + (r.current_cost ?? 0), 0),
    };
    return NextResponse.json({ ok: true, from, to, summary, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "미리보기 실패" }, { status: 500 });
  }
}
