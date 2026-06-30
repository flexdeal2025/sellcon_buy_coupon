import { describe, it, expect } from "vitest";
import { normalizeProductName, buildRealStockMap, buildStockPlan } from "@/lib/real-stock";

describe("normalizeProductName", () => {
  it("[비바콘] 접두 제거 + trim", () => {
    expect(normalizeProductName("[비바콘] 스타벅스 5만원권")).toBe("스타벅스 5만원권");
    expect(normalizeProductName("비바콘 CU 1만원권")).toBe("CU 1만원권");
    expect(normalizeProductName("  교촌치킨  ")).toBe("교촌치킨");
  });
});

describe("buildRealStockMap — 코드형+이미지형 병합", () => {
  it("같은 상품의 코드+이미지 합산", () => {
    const m = buildRealStockMap(
      [{ product: "스타벅스 5만원권", count: 3 }],
      [{ product: "[비바콘] 스타벅스 5만원권", total: 2 }],
    );
    expect(m.get("스타벅스 5만원권")).toEqual({ code: 3, image: 2, total: 5 });
  });
  it("코드형만/이미지형만", () => {
    const m = buildRealStockMap([{ product: "A", count: 4 }], [{ product: "B", total: 7 }]);
    expect(m.get("A")).toEqual({ code: 4, image: 0, total: 4 });
    expect(m.get("B")).toEqual({ code: 0, image: 7, total: 7 });
  });
});

describe("buildStockPlan — 동기화 계획", () => {
  const real = buildRealStockMap(
    [{ product: "스타벅스 5만원권", count: 10 }],
    [{ product: "투썸 케이크", total: 3 }],
  );
  const ss = [
    { channel_product_no: 1, name: "[비바콘] 스타벅스 5만원권", stock_quantity: 4, status: "SALE" }, // 4 → 10 올림
    { channel_product_no: 2, name: "투썸 케이크", stock_quantity: 3, status: "SALE" },              // 3 = 3 동일
    { channel_product_no: 3, name: "[비바콘] 교촌치킨", stock_quantity: 5, status: "SALE" },          // 매칭없음
    { channel_product_no: 4, name: "투썸 케이크", stock_quantity: 9, status: "SALE" },              // 9 → 3 내림
  ];
  const plan = buildStockPlan(ss, real);

  it("올림 판정", () => {
    const r = plan.find((p) => p.channel_product_no === 1)!;
    expect(r.action).toBe("increase");
    expect(r.real).toBe(10); expect(r.diff).toBe(6);
  });
  it("동일 판정", () => {
    expect(plan.find((p) => p.channel_product_no === 2)!.action).toBe("same");
  });
  it("매칭없음은 no-match (0 덮어쓰기 금지 대상)", () => {
    const r = plan.find((p) => p.channel_product_no === 3)!;
    expect(r.action).toBe("no-match");
    expect(r.matched).toBe(false);
  });
  it("내림 판정", () => {
    const r = plan.find((p) => p.channel_product_no === 4)!;
    expect(r.action).toBe("decrease");
    expect(r.diff).toBe(-6);
  });
});
