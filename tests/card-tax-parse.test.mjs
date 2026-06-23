import { describe, it, expect } from "vitest";
import {
  parseAmount, parseDate, mapCategory, detectCompany,
  findFirst, AMT_COLS, EXCLUDE_AMT, DATE_COLS,
} from "../scripts/lib/card-tax-parse.mjs";

describe("card-tax — 금액 파싱", () => {
  it("콤마·'원'·공백 제거 후 정수", () => {
    expect(parseAmount("1,234원")).toBe(1234);
    expect(parseAmount(" 12,000 ")).toBe(12000);
    expect(parseAmount(50000)).toBe(50000);
  });
  it("음수·환불액 처리", () => {
    expect(parseAmount("-9,900")).toBe(-9900);
  });
  it("빈값·하이픈만·미인식 → 0", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount("-")).toBe(0);
    expect(parseAmount("없음")).toBe(0);
  });
});

describe("card-tax — 날짜 파싱", () => {
  it("Date 객체 → YYYY-MM-DD (로컬 기준)", () => {
    expect(parseDate(new Date(2024, 2, 5))).toBe("2024-03-05");
  });
  it("문자열 다양한 구분자", () => {
    expect(parseDate("2024.03.05")).toBe("2024-03-05");
    expect(parseDate("2024-3-5")).toBe("2024-03-05");
    expect(parseDate("2024/12/31")).toBe("2024-12-31");
  });
  it("MM/DD/YY 형식 → 2000년대로 보정", () => {
    expect(parseDate("3/5/24")).toBe("2024-03-05");
  });
  it("인식 불가 → null (합계행·푸터 제외에 사용)", () => {
    expect(parseDate("합계")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe("card-tax — 카드사 라벨 탐지", () => {
  it("부분 매칭", () => {
    expect(detectCompany("국민카드_2024")).toBe("국민카드");
    expect(detectCompany("삼성")).toBe("삼성카드");
  });
  it("'비씨바로'가 '비씨'보다 먼저 매칭(우선순위)", () => {
    expect(detectCompany("비씨바로카드내역")).toBe("비씨바로카드");
    expect(detectCompany("비씨카드")).toBe("비씨카드");
  });
});

describe("card-tax — 비용구분 정규화", () => {
  it("부분문자열 → 정식 라벨", () => {
    expect(mapCategory("(주)비에스유통")).toBe("비에스유통");
    expect(mapCategory("연인터내셔날")).toBe("연인터내셔널");
    expect(mapCategory("내역삭제요청")).toBe("내역 삭제");
  });
  it("매칭 없으면 trim 후 원본", () => {
    expect(mapCategory(" 기타 ")).toBe("기타");
    expect(mapCategory("")).toBe("");
  });
});

// ── 회귀 방지: 2026-06-24 '금액=0' 버그 ──────────────────────────────
// 면세·간이과세 가맹점은 매출금액(가맹점 신고액)이 0일 수 있어,
// 승인/이용금액(실제 결제액)을 매출금액보다 먼저 골라야 한다.
describe("card-tax — 금액 컬럼 우선순위 (0원 버그 회귀방지)", () => {
  it("승인금액이 매출금액보다 우선 선택된다", () => {
    const headers = ["매출일자", "가맹점명", "매출금액", "승인금액"];
    const i = findFirst(headers, AMT_COLS, EXCLUDE_AMT);
    expect(headers[i]).toBe("승인금액");
  });
  it("이용금액이 매출금액보다 우선", () => {
    const headers = ["거래일", "이용금액", "매출금액"];
    const i = findFirst(headers, AMT_COLS, EXCLUDE_AMT);
    expect(headers[i]).toBe("이용금액");
  });
  it("승인/이용금액이 없으면 매출금액으로 폴백", () => {
    const headers = ["매출일자", "가맹점명", "매출금액"];
    const i = findFirst(headers, AMT_COLS, EXCLUDE_AMT);
    expect(headers[i]).toBe("매출금액");
  });
  it("부가세·공급가액 컬럼은 금액으로 선택되지 않는다", () => {
    // '부가세'만 있고 실제 결제액 컬럼이 없으면 -1 (잘못 잡느니 미선택)
    const headers = ["매출일자", "공급가액", "부가세"];
    const i = findFirst(headers, AMT_COLS, EXCLUDE_AMT);
    expect(i).toBe(-1);
  });
  it("공급가액과 매출금액이 함께 있으면 매출금액 선택(공급가액 회피)", () => {
    const headers = ["거래일", "공급가액", "매출금액", "부가세"];
    const i = findFirst(headers, AMT_COLS, EXCLUDE_AMT);
    expect(headers[i]).toBe("매출금액");
  });
});

describe("card-tax — 날짜 컬럼 우선순위", () => {
  it("이용일 > 매출일자 > 매입일자 순", () => {
    expect(findFirst(["매입일자", "매출일자", "이용일"], DATE_COLS) === 2).toBe(true);
    const h2 = ["매입일자", "매출일자"];
    expect(h2[findFirst(h2, DATE_COLS)]).toBe("매출일자");
  });
  it("실제 거래일(매출일자)을 청구일(매입일자)보다 우선", () => {
    const headers = ["매입일자", "매출일자"];
    expect(headers[findFirst(headers, DATE_COLS)]).toBe("매출일자");
  });
});
