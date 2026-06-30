/**
 * 진짜 재고 계산 + 스마트스토어 재고 동기화 계획(plan) — 순수 로직.
 *
 * 진짜 재고 = 코드형(coupon_codes available) + 이미지형(GCP pending) 을 상품명으로 합산.
 * 스마트스토어 listing 재고수량과 비교해 "올림/내림/동일/매칭없음" 계획을 만든다.
 * 데이터 패칭(Supabase/GCP)은 라우트에서, 여기선 정규화·병합·비교만(테스트 가능).
 */

/** 상품명 정규화: "[비바콘]" 접두 제거 + trim. 양 시스템 표기 차이 흡수. */
export function normalizeProductName(name: string): string {
  return String(name ?? "").replace(/^\s*\[?\s*비바콘\s*\]?\s*/, "").trim();
}

export interface RealStock { code: number; image: number; total: number }

/** 코드형 카운트(상품별) + 이미지형 그룹(상품별)을 정규화 상품명으로 병합 */
export function buildRealStockMap(
  codeRows: Array<{ product: string; count: number }>,
  imageGroups: Array<{ product: string; total: number }>,
): Map<string, RealStock> {
  const m = new Map<string, RealStock>();
  const add = (rawName: string, code: number, image: number) => {
    const k = normalizeProductName(rawName);
    if (!k) return;
    const cur = m.get(k) ?? { code: 0, image: 0, total: 0 };
    cur.code += code;
    cur.image += image;
    cur.total = cur.code + cur.image;
    m.set(k, cur);
  };
  for (const r of codeRows) add(r.product, r.count, 0);
  for (const g of imageGroups) add(g.product, 0, g.total);
  return m;
}

export type StockAction = "increase" | "decrease" | "same" | "no-match";

export interface StockPlanRow {
  name: string;
  channel_product_no: number;
  smartstore: number;   // 현재 스마트스토어 재고수량(우리 DB 캐시)
  realCode: number;     // 코드형 실재고
  realImage: number;    // 이미지형 실재고(GCP)
  real: number;         // 합계
  diff: number;         // real - smartstore
  matched: boolean;     // 진짜재고에서 상품 매칭됨?
  action: StockAction;
}

/**
 * 스마트스토어 상품(판매중) × 진짜재고 → 동기화 계획.
 * ⚠️ matched=false(매칭없음)는 0으로 덮어쓰면 안 됨 — 적용 단계에서 반드시 제외.
 */
export function buildStockPlan(
  smartstoreProducts: Array<{ channel_product_no: number; name: string; stock_quantity: number; status: string }>,
  realMap: Map<string, RealStock>,
): StockPlanRow[] {
  return smartstoreProducts.map((p) => {
    const key = normalizeProductName(p.name);
    const real = realMap.get(key);
    const matched = !!real;
    const realTotal = real?.total ?? 0;
    const diff = realTotal - (p.stock_quantity ?? 0);
    const action: StockAction = !matched
      ? "no-match"
      : diff > 0 ? "increase" : diff < 0 ? "decrease" : "same";
    return {
      name: p.name,
      channel_product_no: p.channel_product_no,
      smartstore: p.stock_quantity ?? 0,
      realCode: real?.code ?? 0,
      realImage: real?.image ?? 0,
      real: realTotal,
      diff,
      matched,
      action,
    };
  });
}
