import { NextResponse } from "next/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { listPendingStock } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

type CouponRow = { 상품명: string | null; expiry_date: string | null };

export async function GET(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  try {
    // 1. GCP GIFTICON_BUCKET pending/ 스캔
    const gcpItems = await listPendingStock();

    // 2. 비바콘 coupon_codes available 집계
    const vc = getVivaconSupabase();
    const { data, error } = await vc
      .from("coupon_codes")
      .select("상품명, expiry_date")
      .eq("status", "available")
      .limit(5000);
    if (error) throw new Error(error.message);
    const coupons = (data ?? []) as unknown as CouponRow[];

    // 3. 코드형: 상품명 기준으로 집계. key = 상품명.replace(/\//g, '_') (GCP 폴더명 정규화와 동일)
    const codeMap = new Map<
      string,
      { display: string; count: number; earliest_expiry: string | null }
    >();
    for (const c of coupons) {
      const rawName = c.상품명 ?? "";
      const key = rawName.replace(/\//g, "_");
      const cur = codeMap.get(key) ?? { display: rawName, count: 0, earliest_expiry: null };
      cur.count++;
      if (c.expiry_date) {
        if (!cur.earliest_expiry || c.expiry_date < cur.earliest_expiry) {
          cur.earliest_expiry = c.expiry_date;
        }
      }
      codeMap.set(key, cur);
    }

    // 4. GCP + 코드형 병합: product_key 기준으로 합집합
    const allKeys = new Set([
      ...gcpItems.map((g) => g.product),
      ...Array.from(codeMap.keys()),
    ]);

    const items = Array.from(allKeys)
      .map((key) => {
        const gcp = gcpItems.find((g) => g.product === key);
        const code = codeMap.get(key);
        const image_count = gcp?.count ?? 0;
        const code_count = code?.count ?? 0;
        // 상품명 표시: 코드형 원본(/ 포함) 우선, 없으면 GCP 폴더명
        const product = code?.display || key;
        return {
          product,
          product_key: key,
          image_count,
          image_dates: gcp?.dates ?? [],
          code_count,
          code_earliest_expiry: code?.earliest_expiry ?? null,
          total: image_count + code_count,
        };
      })
      .sort((a, b) => b.total - a.total || a.product.localeCompare(b.product));

    const image_total = items.reduce((s, x) => s + x.image_count, 0);
    const code_total = items.reduce((s, x) => s + x.code_count, 0);

    return NextResponse.json({
      ok: true,
      items,
      image_total,
      code_total,
      scanned_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 },
    );
  }
}
