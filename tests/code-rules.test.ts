import { describe, it, expect } from "vitest";
import { checkCodeLength, codeLength } from "@/lib/code-rules";

describe("checkCodeLength — 배민상품권 10자리(글자 수) 규칙", () => {
  it("배민상품권 + 10자리 영문+숫자 혼합 → 정상(null)", () => {
    // 실제 배민 코드 형태: 영문+숫자 10글자 (이게 오탐나던 핵심 케이스)
    expect(checkCodeLength("배민상품권 3만원 교환권", "K9ABC1D2ET")).toBeNull();
    expect(checkCodeLength("배달의민족 배민상품권 5만원 교환권", "KA12B34C56")).toBeNull();
  });

  it("배민상품권 + 순수 10자리 숫자 → 정상(null)", () => {
    expect(checkCodeLength("배민상품권", "1234567890")).toBeNull();
  });

  it("배민상품권 + 9자리 → 오인식 경고", () => {
    const w = checkCodeLength("배민상품권 3만원 교환권", "K9ABC1D2E");
    expect(w).not.toBeNull();
    expect(w?.actual).toBe(9);
    expect(w?.expected).toEqual([10]);
  });

  it("배민상품권 + 11자리 → 오인식 경고", () => {
    expect(checkCodeLength("배민상품권", "K9ABC1D2ETX")?.actual).toBe(11);
  });

  it("공백은 제거하고 길이 판정 (OCR 잔여공백 방어)", () => {
    expect(checkCodeLength("배민상품권", "K9ABC 1D2ET")).toBeNull(); // 공백 제거 시 10
  });

  it("규칙 없는 상품 → null", () => {
    expect(checkCodeLength("스타벅스 5만원권", "ABC")).toBeNull();
  });

  it("코드 미입력 → null", () => {
    expect(checkCodeLength("배민상품권", "")).toBeNull();
  });

  it("codeLength는 공백 제거 후 글자 수", () => {
    expect(codeLength("K9 AB-12")).toBe(7);
  });
});
