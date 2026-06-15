import { NextResponse } from "next/server";
import { getAllProducts, getOrdersLast30Days } from "@/lib/naver/api";
import { getServerSupabase } from "@/lib/supabase/server";
import { sendTelegramDirect } from "@/lib/notify-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    return NextResponse.json({ ok: false, error: "NAVER_CLIENT_ID / SECRET 미설정" });
  }

  try {
    const supabase = getServerSupabase();
    const now = new Date().toISOString();

    // ── 1. 상품 동기화 ──────────────────────────────
    const products = await getAllProducts();

    if (products.length > 0) {
      const { error } = await supabase.from("smartstore_products").upsert(
        products.map((p) => ({
          channel_product_no: p.channelProductNo,
          origin_product_no: p.originProductNo,
          name: p.name,
          sale_price: p.salePrice,
          stock_quantity: p.stockQuantity,
          status: p.status,
          synced_at: now,
        })),
        { onConflict: "channel_product_no" },
      );
      if (error) throw new Error(`상품 upsert 실패: ${error.message}`);
    }

    // ── 2. 주문 집계 (일별·상품별) ─────────────────
    const orders = await getOrdersLast30Days();
    const salesMap = new Map<string, { qty: number; rev: number; name: string }>();

    for (const o of orders) {
      const date = (o.paymentDate ?? "").substring(0, 10);
      if (!date || !o.channelProductNo) continue;
      const key = `${date}__${o.channelProductNo}`;
      const cur = salesMap.get(key) ?? { qty: 0, rev: 0, name: o.productName };
      cur.qty += o.quantity ?? 0;
      cur.rev += (o.unitPrice ?? 0) * (o.quantity ?? 0);
      cur.name = o.productName;
      salesMap.set(key, cur);
    }

    if (salesMap.size > 0) {
      const rows = [...salesMap.entries()].map(([key, v]) => {
        const [date, no] = key.split("__");
        return {
          sale_date: date,
          channel_product_no: Number(no),
          product_name: v.name,
          total_quantity: v.qty,
          total_revenue: v.rev,
          synced_at: now,
        };
      });
      const { error } = await supabase
        .from("smartstore_daily_sales")
        .upsert(rows, { onConflict: "sale_date,channel_product_no" });
      if (error) throw new Error(`판매 집계 upsert 실패: ${error.message}`);
    }

    // ── 3. 재고 임박 알림 ──────────────────────────
    // DB 의 threshold 기준으로 판단 (기본 10개)
    const { data: thresholds } = await supabase
      .from("smartstore_products")
      .select("channel_product_no, low_stock_threshold");

    const threshMap = new Map(
      (thresholds ?? []).map((r) => [r.channel_product_no, r.low_stock_threshold ?? 10]),
    );

    const lowStock = products.filter((p) => {
      const t = threshMap.get(p.channelProductNo) ?? 10;
      return p.status === "SALE" && p.stockQuantity >= 0 && p.stockQuantity <= t;
    });

    if (lowStock.length > 0) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .substring(0, 10);
      const { data: recent } = await supabase
        .from("smartstore_daily_sales")
        .select("channel_product_no, total_quantity")
        .gte("sale_date", sevenDaysAgo);

      const qty7Map = new Map<number, number>();
      for (const r of recent ?? []) {
        qty7Map.set(r.channel_product_no, (qty7Map.get(r.channel_product_no) ?? 0) + r.total_quantity);
      }

      const lines = [
        "📦 *재고 임박 알림*",
        "",
        ...lowStock.map((p) => {
          const sold7 = qty7Map.get(p.channelProductNo) ?? 0;
          const daysLeft = sold7 > 0 ? ((p.stockQuantity / (sold7 / 7)) * 10) / 10 : null;
          return `• *${p.name}*\n  재고 ${p.stockQuantity}개${daysLeft ? ` / 예상 소진 ${daysLeft}일` : ""}`;
        }),
        "",
        "🛒 매입 검토가 필요합니다.",
      ];
      await sendTelegramDirect(lines.join("\n"));
    }

    return NextResponse.json({
      ok: true,
      synced: { products: products.length, orderRows: salesMap.size, lowStock: lowStock.length },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    console.error("[Smartstore Sync]", msg);
    await sendTelegramDirect(`🚨 *스마트스토어 동기화 오류*\n${msg}`).catch(() => {});
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
