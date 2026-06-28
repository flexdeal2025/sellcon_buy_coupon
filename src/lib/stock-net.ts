/**
 * 이미지형 재고 차감 로직 (순수 함수).
 * 판매중 = pending − completed (상품×유효기간별). 발송 후 completed로 복사되지만
 * pending에서 삭제되지 않는 환경을 보정해 순수 판매중 재고만 남긴다.
 */
export interface ProductDates {
  product: string;
  total: number;
  dates: Array<{ date: string; count: number }>;
}

/** 두 ProductDates 배열을 상품×유효기간별로 합산 (completed + exchanged 등 폴더 합치기용). */
export function mergeProductDates(
  a: ProductDates[],
  b: ProductDates[],
): ProductDates[] {
  const map = new Map<string, Map<string, number>>();
  for (const g of [...a, ...b]) {
    if (!map.has(g.product)) map.set(g.product, new Map());
    const dm = map.get(g.product)!;
    for (const d of g.dates) dm.set(d.date, (dm.get(d.date) ?? 0) + d.count);
  }
  return Array.from(map.entries()).map(([product, dm]) => {
    const dates = Array.from(dm.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { product, total: dates.reduce((s, d) => s + d.count, 0), dates };
  });
}

/** pending에서 completed 수만큼 (상품×유효기간별) 차감. 0 이하 클램프, 0 그룹 제거. */
export function subtractCompleted(
  pending: ProductDates[],
  completed: ProductDates[],
): ProductDates[] {
  const doneMap = new Map<string, number>(); // `${product}|${date}` → 판매완료 수
  for (const g of completed) {
    for (const d of g.dates) doneMap.set(`${g.product}|${d.date}`, d.count);
  }
  return pending
    .map((g) => {
      const dates = g.dates
        .map((d) => ({
          date: d.date,
          count: Math.max(0, d.count - (doneMap.get(`${g.product}|${d.date}`) ?? 0)),
        }))
        .filter((d) => d.count > 0);
      return { product: g.product, total: dates.reduce((s, d) => s + d.count, 0), dates };
    })
    .filter((g) => g.total > 0);
}
