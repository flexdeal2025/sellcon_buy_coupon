import { describe, it, expect } from "vitest";
import { sanitizeCouponPatch, COUPON_STATUSES } from "@/lib/supabase/vivacon";

describe("sanitizeCouponPatch — 비바콘 쿠폰 수정 정제", () => {
  it("허용 컬럼만 통과 (그 외 무시)", () => {
    const { update } = sanitizeCouponPatch({ 상품명: "스타벅스 3만", 해킹시도: "x" });
    expect(update).toEqual({ 상품명: "스타벅스 3만" });
    expect(update).not.toHaveProperty("해킹시도");
  });

  it("매입원가: 숫자만 추출", () => {
    const { update } = sanitizeCouponPatch({ 매입원가: "27,000원" });
    expect(update?.매입원가).toBe(27000);
  });

  it("매입원가: 빈값 → null", () => {
    const { update } = sanitizeCouponPatch({ 매입원가: "" });
    expect(update?.매입원가).toBeNull();
  });

  it("status: 허용값만 통과", () => {
    const ok = sanitizeCouponPatch({ status: "available" });
    expect(ok.update?.status).toBe("available");
    for (const s of COUPON_STATUSES) {
      expect(sanitizeCouponPatch({ status: s }).update?.status).toBe(s);
    }
  });

  it("status: 잘못된 값 → error", () => {
    const bad = sanitizeCouponPatch({ status: "팔림" });
    expect(bad.error).toBeTruthy();
    expect(bad.update).toBeUndefined();
  });

  it("expiry_date: YYYY-MM-DD → expiry_yymmdd 동기화", () => {
    const { update } = sanitizeCouponPatch({ expiry_date: "2026-12-31" });
    expect(update?.expiry_date).toBe("2026-12-31");
    expect(update?.expiry_yymmdd).toBe("261231");
  });

  it("expiry_date: 빈값 → 둘 다 null", () => {
    const { update } = sanitizeCouponPatch({ expiry_date: "" });
    expect(update?.expiry_date).toBeNull();
    expect(update?.expiry_yymmdd).toBeNull();
  });

  it("expiry_date: 형식 오류 → error", () => {
    const bad = sanitizeCouponPatch({ expiry_date: "2026.12.31" });
    expect(bad.error).toBeTruthy();
  });

  it("수정 항목이 하나도 없으면 error", () => {
    const empty = sanitizeCouponPatch({ 알수없는필드: 1 });
    expect(empty.error).toBeTruthy();
  });
});
