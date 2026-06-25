import { describe, it, expect } from "vitest";
import { nameSimilarity, extractWon, normalizeName, suggestMatches } from "@/lib/proof-match";

describe("extractWon — 금액권 추출", () => {
  it("만원/천원/원 표기를 원 단위 정수로", () => {
    expect(extractWon("투썸 5만원권")).toBe(50000);
    expect(extractWon("3천원권")).toBe(3000);
    expect(extractWon("스타벅스 5만")).toBe(50000);
    expect(extractWon("50000원")).toBe(50000);
  });
  it("금액 없으면 null", () => {
    expect(extractWon("밀리의서재 1개월 구독권")).toBeNull();
    expect(extractWon("교촌치킨 허니콤보")).toBeNull();
  });
});

describe("normalizeName — 정규화(노이즈 제거)", () => {
  it("거래 접미사·공백·특수문자 제거", () => {
    expect(normalizeName("[판매] 맘스터치 싸이버거 세트")).toBe("맘스터치싸이버거세트");
    expect(normalizeName("교촌치킨 허니콤보+콜라1.25L 기프티콘 팝니다")).toBe("교촌치킨허니콤보콜라125l");
  });
});

describe("nameSimilarity — 증빙↔재고 상품명 유사도", () => {
  it("브랜드 접두 축약 + 금액권 일치 → 강한 매칭", () => {
    // 투썸플레이스↔투썸, 5만원권 동일, '잔액관리형'·'기프티콘' 노이즈
    expect(nameSimilarity("투썸플레이스 5만원권 잔액관리형", "투썸 5만원권 기프티콘")).toBeGreaterThan(0.8);
  });
  it("금액권이 다르면(3만↔5만) 강한 감점 → 미매칭", () => {
    expect(nameSimilarity("투썸플레이스 3만원권 잔액관리형", "투썸 5만원권 기프티콘")).toBeLessThan(0.45);
  });
  it("띄어쓰기 차이는 동일 취급", () => {
    expect(nameSimilarity("맘스터치 싸이버거 세트", "맘스터치 싸이버거세트")).toBe(1);
  });
  it("포함관계 보정(접미사 차이)", () => {
    expect(nameSimilarity("교촌치킨 허니콤보+콜라1.25L", "교촌치킨 허니콤보+콜라1.25L 기프티콘 팝니다")).toBeGreaterThan(0.45);
  });
  it("다른 브랜드는 낮은 점수", () => {
    expect(nameSimilarity("스타벅스 아메리카노 T", "투썸 5만원권")).toBeLessThan(0.45);
  });
});

describe("suggestMatches — 추천 묶음(1:1 / N:1 / 금액)", () => {
  const reg = (id: string, name: string, cost: number | null) => ({
    id, product_name: name, unit_cost: cost,
  });

  it("최고 유사도 단건이 금액과 맞으면 1:1 확정", () => {
    const r = suggestMatches({
      proof_product_name: "투썸 5만원권",
      total_amount: 47000,
      registrations: [reg("a", "투썸플레이스 5만원권 잔액관리형", 47000), reg("b", "교촌치킨 허니콤보", 20000)],
    });
    expect(r.recommended_ids).toEqual(["a"]);
    expect(r.amount_matched).toBe(true);
  });

  it("동일 상품 여러 건의 합이 금액과 맞으면 N:1 묶음", () => {
    const r = suggestMatches({
      proof_product_name: "교촌치킨 허니콤보+콜라",
      total_amount: 40000,
      registrations: [
        reg("a", "교촌치킨 허니콤보+콜라1.25L", 20000),
        reg("b", "교촌치킨 허니콤보+콜라1.25L", 20000),
      ],
    });
    expect(r.recommended_ids.length).toBe(2);
    expect(r.amount_matched).toBe(true);
  });

  it("유사 재고 없으면 빈 추천", () => {
    const r = suggestMatches({
      proof_product_name: "밀리의서재 1개월",
      total_amount: 9000,
      registrations: [reg("a", "스타벅스 아메리카노", 4500)],
    });
    expect(r.recommended_ids).toEqual([]);
  });
});
