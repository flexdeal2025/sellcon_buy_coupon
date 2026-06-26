import { NextResponse } from "next/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { listPendingStock, listCompletedStock } from "@/lib/gcp/storage";

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

function buildMapItems(
  rows: Array<{ product: string; date: string }>,
): StockItem[] {
  const map = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!map.has(r.product)) map.set(r.product, new Map());
    const dm = map.get(r.product)!;
    dm.set(r.date, (dm.get(r.date) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([product, dm]) => {
      const dates = Array.from(dm.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        product,
        product_key: product.replace(/\//g, "_"),
        dates,
        total: dates.reduce((s, d) => s + d.count, 0),
      };
    })
    .sort((a, b) => b.total - a.total);
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
      // 판매중 = pending − completed (상품×유효기간별 차감).
      // 발송 후 completed로 복사되지만 pending에서 삭제되지 않아, 차감해야 순수 판매중만 남는다.
      const [pend, done] = await Promise.all([listPendingStock(), listCompletedStock()]);
      const doneMap = new Map<string, number>(); // `${product}|${date}` → 판매완료 수
      for (const g of done) for (const d of g.dates) doneMap.set(`${g.product}|${d.date}`, d.count);

      items = pend
        .map((g) => {
          const dates = g.dates
            .map((d) => ({ date: d.date, count: Math.max(0, d.count - (doneMap.get(`${g.product}|${d.date}`) ?? 0)) }))
            .filter((d) => d.count > 0);
          return {
            product: g.product,
            product_key: g.product,
            dates,
            total: dates.reduce((s, d) => s + d.count, 0),
          };
        })
        .filter((g) => g.total > 0);
    } else if (type === "code" || type === "code_done") {
      const vc = getVivaconSupabase();
      // 판매완료 = allocated(고객 할당) + exchanged(교환 처리) 둘 다
      const statuses = type === "code" ? ["available"] : ["allocated", "exchanged"];
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
      items = buildMapItems(rows);
    } else if (type === "image_done") {
      // GCP completed/ 폴더 스캔 — 알림톡 발송 완료 후 uuid 파일명으로 이동된 항목
      const gcpItems = await listCompletedStock();
      items = gcpItems.map((g) => ({
        product: g.product,
        product_key: g.product,
        dates: g.dates,
        total: g.total,
      }));
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
