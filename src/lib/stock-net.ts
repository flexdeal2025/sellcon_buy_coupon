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
