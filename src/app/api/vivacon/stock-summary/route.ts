import { NextResponse } from "next/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { listPendingStock, listCompletedStock, listExchangedStock } from "@/lib/gcp/storage";
import { mergeProductDates } from "@/lib/stock-net";

export const runtime = "nodejs";
export const maxDuration = 30;

type DateCount = { date: string; count: number };
type StockItem = {
  product: string;
  product_key: string;
  dates: DateCount[];
  total: number;
};

type CouponRow = { 상품명: string | null; expiry_yymmdd: string | null };

/** 영문(A-Z) → 한글(ㄱ-ㅎ) 오름차순 정렬 */
function sortByProductName(items: StockItem[]): StockItem[] {
  return [...items].sort((a, b) => {
    const aKo = /^[가-힣]/.test(a.product);
    const bKo = /^[가-힣]/.test(b.product);
    if (aKo !== bKo) return aKo ? 1 : -1;
    return a.product.localeCompare(b.product, aKo ? "ko" : "en");
  });
}

function gcpToStockItems(
  groups: Array<{ product: string; total: number; dates: DateCount[] }>,
): StockItem[] {
  return groups.map((g) => ({
    product: g.product,
    product_key: g.product.replace(/\//g, "_"),
    dates: g.dates,
    total: g.total,
  }));
}

function buildMapItems(
  rows: Array<{ product: string; date: string }>,
): StockItem[] {
  const map = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!map.has(r.product)) map.set(r.product, new Map());
    const dm = map.get(r.product)!;
    dm.set(r.date, (dm.get(r.date) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([product, dm]) => {
    const dates = Array.from(dm.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      product,
      product_key: product.replace(/\//g, "_"),
      dates,
      total: dates.reduce((s, d) => s + d.count, 0),
    };
  });
}

export async function GET(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "image";

  try {
    let items: StockItem[] = [];

    if (type === "image") {
      // pending 폴더 파일 수 그대로 집계
      const pend = await listPendingStock();
      items = sortByProductName(gcpToStockItems(pend));
    } else if (type === "image_done") {
      // completed + exchanged 폴더 합산
      const [done, exchanged] = await Promise.all([listCompletedStock(), listExchangedStock()]);
      items = sortByProductName(gcpToStockItems(mergeProductDates(done, exchanged)));
    } else if (type === "code" || type === "code_done") {
      const vc = getVivaconSupabase();
      const statuses = type === "code" ? ["available"] : ["completed", "exchanged"];
      const { data, error } = await vc
        .from("coupon_codes")
        .select("상품명, expiry_yymmdd")
        .in("status", statuses)
        .limit(10000);
      if (error) throw new Error(error.message);

      const rows = ((data ?? []) as unknown as CouponRow[]).map((c) => ({
        product: c.상품명 ?? "(상품명 없음)",
        date: c.expiry_yymmdd ?? "000000",
      }));
      items = sortByProductName(buildMapItems(rows));
    } else {
      return NextResponse.json({ ok: false, error: "type 오류" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      type,
      items,
      total_count: items.reduce((s, x) => s + x.total, 0),
      product_count: items.length,
      scanned_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 },
    );
  }
}
