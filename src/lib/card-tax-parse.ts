/**
 * 카드내역 엑셀 파싱 순수 로직 (UI 업로드용 TS 포트).
 * scripts/lib/card-tax-parse.mjs 와 동일 규칙 — 카드사별 컬럼 자동 탐지.
 * ⚠️ UI 증분 업로드 안전을 위해 row_hash 를 "시트명::행번호"가 아닌 내용 기반으로 생성
 *    (월별로 나눠 여러 번 올려도 서로 덮어쓰지 않음. 동일 파일 재업로드는 upsert로 무해).
 */

export const norm = (s: unknown): string => String(s ?? "").replace(/[\s ]/g, "");

export function detectCompany(sheetName: string): string {
  const map: [string, string][] = [
    ["국민", "국민카드"], ["농협", "농협카드"], ["롯데", "롯데카드"],
    ["비씨바로", "비씨바로카드"], ["기업", "기업카드"], ["부산은행", "부산은행카드"],
    ["우리", "우리카드"], ["비씨", "비씨카드"], ["삼성", "삼성카드"],
    ["신한", "신한카드"], ["하나", "하나카드"], ["현대", "현대카드"],
    ["제주은행", "제주은행카드"], ["광주은행", "광주은행카드"],
  ];
  for (const [key, val] of map) if (sheetName.includes(key)) return val;
  return sheetName.trim();
}

export function parseDate(val: unknown): string | null {
  if (!val && val !== 0) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, "0")}-${String(val.getDate()).padStart(2, "0")}`;
  }
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(val).trim();
  const m1 = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
  const m2 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m2) {
    const yr = m2[3].length === 2 ? `20${m2[3]}` : m2[3];
    return `${yr}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
  }
  return null;
}

export function parseAmount(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return Math.round(val);
  const cleaned = String(val).replace(/[^0-9-]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  return parseInt(cleaned, 10) || 0;
}

export function mapCategory(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (v.includes("비에스유통")) return "비에스유통";
  if (v.includes("연인터")) return "연인터내셔널";
  if (v.includes("내역 삭제") || v.includes("내역삭제")) return "내역 삭제";
  return v;
}

export const DATE_COLS = ["이용일", "매출일자", "매입일자", "거래일", "거래일자", "접수일자"];
export const AMT_COLS = ["승인금액", "이용금액", "이용금액(원)", "원화사용금액", "매출금액", "매출금액(원)"];
export const EXCLUDE_AMT = ["부가세", "공급가액", "공급가", "세액"];
export const MERCH_COLS = ["가맹점명", "거래처"];
export const CARD_COLS = ["카드번호", "이용카드(뒤4자리)", "이용카드"];

export function findFirst(headers: unknown[], cands: string[], exclude?: string[]): number {
  for (const name of cands) {
    const i = headers.findIndex((h) => norm(h) === norm(name));
    if (i === -1) continue;
    if (exclude?.length && exclude.some((ex) => norm(headers[i]).includes(norm(ex)))) continue;
    return i;
  }
  return -1;
}

export interface CardRecord {
  card_company: string;
  transaction_date: string | null;
  card_number: string | null;
  merchant_name: string;
  amount: number;
  product_name: string;
  cost_category: string;
  owner: string;
  row_hash: string;
}

// 내용 기반 row_hash. 동일 내용이 한 업로드에 여러 번이면 #n 접미사로 구분(진짜 중복 보존).
function makeRowHash(r: Omit<CardRecord, "row_hash">, seen: Map<string, number>): string {
  const base = [r.owner, r.card_company, r.transaction_date, r.amount, r.merchant_name, r.product_name, r.card_number ?? ""].join("|");
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}#${n}`;
}

/** 한 시트(AOA) → 레코드. seen 맵은 업로드 전체에서 공유(중복 카운트). */
export function parseSheetRecords(
  raw: unknown[][], sheetName: string, company: string, owner: string, seen: Map<string, number>,
): { records: CardRecord[]; rawCount: number } {
  if (!raw || raw.length < 2) return { records: [], rawCount: 0 };
  let headerIdx = raw.findIndex((r) => r.some((c) => norm(c) === "품명"));
  if (headerIdx === -1) headerIdx = 0;
  const headers = raw[headerIdx];
  const dataRows = raw.slice(headerIdx + 1).filter((r) => r.some((c) => c !== "" && c !== null && c !== undefined));
  const col = (name: string) => headers.findIndex((h) => norm(h) === norm(name));
  const records: CardRecord[] = [];
  const push = (rec: Omit<CardRecord, "row_hash">) => records.push({ ...rec, row_hash: makeRowHash(rec, seen) });

  // 광주은행: 연도 + 일자 조합
  if (company === "광주은행카드" && col("연도") !== -1) {
    const iYear = col("연도"), iDay = col("일자"), iMerch = col("거래처");
    const iProd = col("품명"), iAmt = col("합계");
    const iCat = headers.findIndex((h) => norm(h).includes("확인") && norm(h).includes("내역"));
    for (const row of dataRows) {
      const year = String(row[iYear] ?? "").trim();
      const day = String(row[iDay] ?? "").trim();
      push({
        card_company: company,
        transaction_date: year && day ? `${year}-${day.replace(/[.\/]/g, "-")}` : null,
        card_number: null,
        merchant_name: String(row[iMerch] ?? "").trim(),
        amount: parseAmount(row[iAmt]),
        product_name: String(row[iProd] ?? "").trim(),
        cost_category: mapCategory(iCat !== -1 ? row[iCat] : ""),
        owner,
      });
    }
    return { records, rawCount: dataRows.length };
  }

  // 일반 처리
  let iDate = findFirst(headers, DATE_COLS);
  if (iDate === -1 && dataRows.some((r) => parseDate(r[0]))) iDate = 0;
  const iAmt = findFirst(headers, AMT_COLS, EXCLUDE_AMT);
  const iMerch = findFirst(headers, MERCH_COLS);
  const iCard = findFirst(headers, CARD_COLS);
  const iProd = col("품명");
  const iCat = col("비용 구분");
  for (const row of dataRows) {
    push({
      card_company: company,
      transaction_date: iDate !== -1 ? parseDate(row[iDate]) : null,
      card_number: iCard !== -1 ? (String(row[iCard] ?? "").trim() || null) : null,
      merchant_name: iMerch !== -1 ? String(row[iMerch] ?? "").trim() : "",
      amount: iAmt !== -1 ? parseAmount(row[iAmt]) : 0,
      product_name: iProd !== -1 ? String(row[iProd] ?? "").trim() : "",
      cost_category: iCat !== -1 ? mapCategory(row[iCat]) : "",
      owner,
    });
  }
  return { records, rawCount: dataRows.length };
}
