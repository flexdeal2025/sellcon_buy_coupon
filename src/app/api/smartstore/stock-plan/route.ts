import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getVivaconSupabase, checkAppPasscode } from "@/lib/supabase/vivacon";
import { listPendingStock } from "@/lib/gcp/storage";
import { buildRealStockMap, buildStockPlan } from "@/lib/real-stock";

export const runtime = "nodejs";
export const maxDuration = 60;

// 스마트스토어 재고 동기화 미리보기(dry-run) — 실제 쓰기 없음.
// 진짜 재고(coupon_codes available + GCP pending) vs 스마트스토어 캐시 재고 비교 계획.
export async function GET(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  try {
    const ours = getServerSupabase();
    // 한글 컬럼(상품명) select 타입파서 회피
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vc = getVivaconSupabase() as any;

    // 1) 코드형 실재고: coupon_codes available 상품별 카운트
    const codeMap = new Map<string, number>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await vc
        .from("coupon_codes").select("상품명").eq("status", "available").range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const n = String(r["상품명"] ?? "");
        if (n) codeMap.set(n, (codeMap.get(n) ?? 0) + 1);
      }
      if (!data || data.length < 1000) break;
    }
    const codeRows = [...codeMap.entries()].map(([product, count]) => ({ product, count }));

    // 2) 이미지형 실재고: GCP pending 폴더 집계
    const imageGroups = (await listPendingStock()).map((g) => ({ product: g.product, total: g.total }));

    // 3) 스마트스토어 상품 (판매중만)
    const { data: ssp, error: e3 } = await ours
      .from("smartstore_products").select("channel_product_no, name, stock_quantity, status").limit(3000);
    if (e3) throw new Error(e3.message);
    const saleProducts = (ssp ?? []).filter((p) => p.status === "SALE");

    const realMap = buildRealStockMap(codeRows, imageGroups);
    const plan = buildStockPlan(saleProducts, realMap);

    const summary = {
      total: plan.length,
      increase: plan.filter((r) => r.action === "increase").length,
      decrease: plan.filter((r) => r.action === "decrease").length,
      same: plan.filter((r) => r.action === "same").length,
      noMatch: plan.filter((r) => r.action === "no-match").length,
    };
    // 차이 큰 순(변경 필요한 것 먼저)
    plan.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    return NextResponse.json({ ok: true, summary, plan, scanned_at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "계획 생성 실패" },
      { status: 500 },
    );
  }
}
