import { NextResponse } from "next/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { getServerSupabase } from "@/lib/supabase/server";
import { listPendingStock } from "@/lib/gcp/storage";

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
type RegRow = { product_name: string | null; expiry_date: string | null };

/** "2026-07-31" → "260731" */
function dateToYymmdd(d: string): string {
  const m = /^20(\d{2})-(\d{2})-(\d{2})$/.exec(d);
  return m ? m[1] + m[2] + m[3] : "000000";
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
      const gcpItems = await listPendingStock();
      items = gcpItems.map((g) => ({
        product: g.product,
        product_key: g.product,
        dates: g.dates,
        total: g.total,
      }));
    } else if (type === "code" || type === "code_done") {
      const vc = getVivaconSupabase();
      const status = type === "code" ? "available" : "exchanged";
      const { data, error } = await vc
        .from("coupon_codes")
        .select("상품명, expiry_yymmdd")
        .eq("status", status)
        .limit(10000);
      if (error) throw new Error(error.message);

      const rows = ((data ?? []) as unknown as CouponRow[]).map((c) => ({
        product: c.상품명 ?? "(상품명 없음)",
        date: c.expiry_yymmdd ?? "000000",
      }));
      items = buildMapItems(rows);
    } else if (type === "image_done") {
      const sb = getServerSupabase();
      const { data, error } = await sb
        .from("stock_registrations")
        .select("product_name, expiry_date")
        .eq("stored_as_code", false)
        .eq("published", true)
        .limit(10000);
      if (error) throw new Error(error.message);

      const rows = ((data ?? []) as RegRow[]).map((r) => ({
        product: r.product_name ?? "(상품명 없음)",
        date: r.expiry_date ? dateToYymmdd(r.expiry_date) : "000000",
      }));
      items = buildMapItems(rows);
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
