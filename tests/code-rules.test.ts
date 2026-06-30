import { describe, it, expect } from "vitest";
import { checkCodeDigits, digitCount } from "@/lib/code-rules";

describe("checkCodeDigits — 배민상품권 10자리 규칙", () => {
  it("배민상품권 + 정확히 10자리 숫자 → 정상(null)", () => {
    expect(checkCodeDigits("배민상품권 3만원 교환권", "1234567890")).toBeNull();
  });

  it("배민상품권 + 9자리 → 오인식 경고", () => {
    const w = checkCodeDigits("배민상품권 3만원 교환권", "123456789");
    expect(w).not.toBeNull();
    expect(w?.actual).toBe(9);
    expect(w?.expected).toEqual([10]);
  });

  it("배민상품권 + 11자리 → 오인식 경고", () => {
    expect(checkCodeDigits("배달의민족 배민상품권 5만원 교환권", "12345678901")?.actual).toBe(11);
  });

  it("배민상품권 + 10자리지만 문자 섞임(numericOnly) → 경고", () => {
    // 숫자 10개지만 문자 포함 → 숫자전용 위반
    expect(checkCodeDigits("배민상품권", "12345A67890")).not.toBeNull();
  });

  it("규칙 없는 상품 → null", () => {
    expect(checkCodeDigits("스타벅스 5만원권", "12345")).toBeNull();
  });

  it("코드 미입력 → null (필수값 검증이 따로 처리)", () => {
    expect(checkCodeDigits("배민상품권", "")).toBeNull();
  });

  it("digitCount는 숫자만 센다", () => {
    expect(digitCount("12-34 56AB")).toBe(6);
  });
});
