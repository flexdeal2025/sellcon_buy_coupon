import { describe, it, expect } from "vitest";
import { calcTotal, calcUnit, round2, reconcile } from "@/lib/calc";

describe("calc — 단가/총액 계산기", () => {
  it("calcTotal: 수량×단가", () => {
    expect(calcTotal(10, 9000)).toBe(90000);
    expect(calcTotal(3, 33.33)).toBe(99.99);
  });

  it("calcTotal: 0 입력은 0 반환(나눗셈/곱셈 보호)", () => {
    expect(calcTotal(0, 9000)).toBe(0);
    expect(calcTotal(10, 0)).toBe(0);
  });

  it("calcUnit: 총액÷수량 (소수점 2자리 반올림)", () => {
    expect(calcUnit(10, 90000)).toBe(9000);
    expect(calcUnit(3, 100)).toBe(33.33);
  });

  it("calcUnit: 0 입력 보호", () => {
    expect(calcUnit(0, 90000)).toBe(0);
    expect(calcUnit(10, 0)).toBe(0);
  });

  it("round2: 부동소수 오차 보정", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("reconcile(unit): 단가 기준 → 총액 재계산", () => {
    expect(reconcile(10, 9000, 0, "unit")).toEqual({ unitPrice: 9000, totalPrice: 90000 });
  });

  it("reconcile(total): 총액 기준 → 단가 재계산", () => {
    expect(reconcile(10, 0, 90000, "total")).toEqual({ unitPrice: 9000, totalPrice: 90000 });
  });
});
