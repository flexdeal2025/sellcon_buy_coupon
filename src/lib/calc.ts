/**
 * 양방향 단가-총액 계산기.
 * 어느 두 값이 입력되었는지에 따라 나머지 한 값을 계산합니다.
 */

export type CalcSource = "unit" | "total"; // 마지막으로 사용자가 직접 수정한 필드

/** 수량 × 단가 = 총액 */
export function calcTotal(quantity: number, unitPrice: number): number {
  if (!quantity || !unitPrice) return 0;
  return round2(quantity * unitPrice);
}

/** 총액 ÷ 수량 = 단가 (소수점 2자리) */
export function calcUnit(quantity: number, totalPrice: number): number {
  if (!quantity || !totalPrice) return 0;
  return round2(totalPrice / quantity);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 수량/단가/총액 중 변경된 소스에 따라 일관된 세트를 반환.
 * - source === "unit"  : 단가가 기준 → 총액 재계산
 * - source === "total" : 총액이 기준 → 단가 재계산
 */
export function reconcile(
  quantity: number,
  unitPrice: number,
  totalPrice: number,
  source: CalcSource,
): { unitPrice: number; totalPrice: number } {
  if (source === "unit") {
    return { unitPrice, totalPrice: calcTotal(quantity, unitPrice) };
  }
  return { unitPrice: calcUnit(quantity, totalPrice), totalPrice };
}
