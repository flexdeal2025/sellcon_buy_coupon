import { describe, it, expect } from "vitest";
import { detectCompany, parseDate, parseAmount, parseSheetRecords } from "@/lib/card-tax-parse";

describe("card-tax-parse 기본", () => {
  it("detectCompany 부분매칭(구체 우선)", () => {
    expect(detectCompany("2026 현대카드 내역")).toBe("현대카드");
    expect(detectCompany("비씨바로")).toBe("비씨바로카드");
    expect(detectCompany("비씨")).toBe("비씨카드");
  });
  it("parseDate 다양한 형식", () => {
    expect(parseDate("2026.01.05")).toBe("2026-01-05");
    expect(parseDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(parseDate("합계")).toBeNull();
  });
  it("parseAmount 콤마/원 제거", () => {
    expect(parseAmount("12,000원")).toBe(12000);
    expect(parseAmount("")).toBe(0);
  });
});

describe("parseSheetRecords — 내용기반 row_hash(증분 업로드 안전)", () => {
  const sheet = [
    ["매출일자", "가맹점명", "승인금액", "품명", "카드번호"],
    ["2026-01-05", "스타벅스", "5000", "아메리카노", "1234"],
    ["2026-01-05", "스타벅스", "5000", "아메리카노", "1234"], // 진짜 중복 → #2
    ["합계", "", "10000", "", ""], // 날짜없음 → 후속 필터 대상
  ];

  it("레코드 파싱 + 날짜없는 행은 transaction_date null", () => {
    const { records } = parseSheetRecords(sheet, "현대카드", "현대카드", "유정인", new Map());
    expect(records.length).toBe(3);
    expect(records[0].transaction_date).toBe("2026-01-05");
    expect(records[0].amount).toBe(5000);
    expect(records[2].transaction_date).toBeNull(); // 합계행
  });

  it("동일 내용 중복행은 #2 접미사로 구분(둘 다 보존)", () => {
    const { records } = parseSheetRecords(sheet, "현대카드", "현대카드", "유정인", new Map());
    expect(records[0].row_hash).not.toBe(records[1].row_hash);
    expect(records[1].row_hash.endsWith("#2")).toBe(true);
  });

  it("같은 파일 재업로드는 동일 row_hash → upsert로 중복 안 생김(결정적)", () => {
    const a = parseSheetRecords(sheet, "현대카드", "현대카드", "유정인", new Map()).records.map((r) => r.row_hash);
    const b = parseSheetRecords(sheet, "현대카드", "현대카드", "유정인", new Map()).records.map((r) => r.row_hash);
    expect(a).toEqual(b);
  });

  it("명의자가 다르면 row_hash도 다름", () => {
    const a = parseSheetRecords(sheet, "현대카드", "현대카드", "유정인", new Map()).records[0].row_hash;
    const b = parseSheetRecords(sheet, "현대카드", "현대카드", "김성수", new Map()).records[0].row_hash;
    expect(a).not.toBe(b);
  });
});
