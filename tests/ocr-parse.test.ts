import { describe, it, expect } from "vitest";
import { parseJsonLoose, cleanProofProductName } from "@/lib/ocr/gemini";

describe("parseJsonLoose — Gemini 응답 느슨한 JSON 파싱", () => {
  it("순수 JSON", () => {
    expect(parseJsonLoose('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });
  it("마크다운 펜스(```json) 제거", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('```\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it("앞뒤 잡설이 있어도 첫 {…} 블록 추출", () => {
    expect(parseJsonLoose('다음은 결과입니다: {"a":1} 끝.')).toEqual({ a: 1 });
  });
  it("빈 응답은 throw (진단 가능하게)", () => {
    expect(() => parseJsonLoose("")).toThrow();
    expect(() => parseJsonLoose("   ")).toThrow();
  });
  it("JSON이 아니면 throw", () => {
    expect(() => parseJsonLoose("정말 JSON 아님")).toThrow();
  });
});

describe("cleanProofProductName — 당근 상품명 정제", () => {
  it("[판매]/팝니다/기프티콘 접두·접미사 제거", () => {
    expect(cleanProofProductName("[판매] 투썸플레이스 스트로베리 초콜릿 생크림")).toBe("투썸플레이스 스트로베리 초콜릿 생크림");
    expect(cleanProofProductName("교촌치킨 허니콤보+콜라1.25L 기프티콘 팝니다")).toBe("교촌치킨 허니콤보+콜라1.25L");
    expect(cleanProofProductName("교촌치킨 허니콤보+콜라1.25L 기프티콘")).toBe("교촌치킨 허니콤보+콜라1.25L");
  });
  it("정제 불필요하면 그대로", () => {
    expect(cleanProofProductName("맘스터치 싸이버거세트")).toBe("맘스터치 싸이버거세트");
  });
});
