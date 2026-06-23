/**
 * 카드내역 엑셀 파싱의 순수 함수 모음.
 * import-card-tax.mjs(임포트 스크립트)와 테스트가 함께 import 한다.
 * ⚠️ DB·파일 접근이 없는 순수 로직만 둔다 (테스트 용이성·회귀 방지).
 */

// 공백·줄바꿈·탭·nbsp 모두 제거 (헤더 이름 비교용)
export const norm = (s) => String(s ?? '').replace(/[\s ]/g, '');

// 시트명 → 카드사 라벨 (부분 매칭). 더 긴/구체적인 키가 먼저 와야 한다
// (예: '비씨바로'를 '비씨'보다 먼저 검사).
export function detectCompany(sheetName) {
  const map = [
    ['국민', '국민카드'], ['농협', '농협카드'], ['롯데', '롯데카드'],
    ['비씨바로', '비씨바로카드'], ['기업', '기업카드'], ['부산은행', '부산은행카드'],
    ['우리', '우리카드'], ['비씨', '비씨카드'], ['삼성', '삼성카드'],
    ['신한', '신한카드'], ['하나', '하나카드'], ['현대', '현대카드'],
    ['제주은행', '제주은행카드'], ['광주은행', '광주은행카드'],
  ];
  for (const [key, val] of map) {
    if (sheetName.includes(key)) return val;
  }
  return sheetName.trim();
}

// 날짜 → YYYY-MM-DD (Date 객체 / Excel serial / 다양한 문자열). 인식 불가 시 null.
export function parseDate(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(val).trim();
  const m1 = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m2) {
    const yr = m2[3].length === 2 ? `20${m2[3]}` : m2[3];
    return `${yr}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  }
  return null;
}

// 금액 → 정수 (콤마·"원"·공백 등 숫자/부호 외 제거). 인식 불가 시 0.
export function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val);
  const cleaned = String(val).replace(/[^0-9-]/g, '');
  if (cleaned === '' || cleaned === '-') return 0;
  return parseInt(cleaned, 10) || 0;
}

// 비용 구분 정규화 (부분문자열 매칭)
export function mapCategory(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (v.includes('비에스유통')) return '비에스유통';
  if (v.includes('연인터')) return '연인터내셔널';
  if (v.includes('내역 삭제') || v.includes('내역삭제')) return '내역 삭제';
  return v;
}

// ── 컬럼 탐지 우선순위 ───────────────────────────────────────────────
// 거래일 기준 = '매출일자'(실제 거래일)를 '매입일자'(청구일)보다 우선.
export const DATE_COLS = ['이용일', '매출일자', '매입일자', '거래일', '거래일자', '접수일자'];
// 승인/이용금액(실제 결제액) 우선 → 매출금액(가맹점 신고액, 면세·간이과세=0 가능) 후순위.
export const AMT_COLS = ['승인금액', '이용금액', '이용금액(원)', '원화사용금액', '매출금액', '매출금액(원)'];
// 부가세·공급가액 컬럼이 AMT 후보에 걸리지 않도록 명시 제외.
export const EXCLUDE_AMT = ['부가세', '공급가액', '공급가', '세액'];
export const MERCH_COLS = ['가맹점명', '거래처'];
export const CARD_COLS = ['카드번호', '이용카드(뒤4자리)', '이용카드'];

// 헤더 배열에서 후보명을 우선순위대로 찾아 인덱스 반환 (정규화 비교, exclude 키워드 회피).
//   - cands: 우선순위 후보명 배열
//   - exclude: 헤더명에 이 키워드가 포함되면 건너뜀(예: 부가세 컬럼 회피)
export function findFirst(headers, cands, exclude) {
  for (const name of cands) {
    const i = headers.findIndex((h) => norm(h) === norm(name));
    if (i === -1) continue;
    if (exclude?.length && exclude.some((ex) => norm(headers[i]).includes(norm(ex)))) continue;
    return i;
  }
  return -1;
}

// 헤더 한 줄에서 날짜·금액·가맹점·카드 컬럼 인덱스를 일괄 탐지.
// (광주은행 같은 특수 시트는 호출부에서 별도 처리)
export function pickColumns(headers) {
  return {
    iAmt: findFirst(headers, AMT_COLS, EXCLUDE_AMT),
    iDate: findFirst(headers, DATE_COLS),
    iMerch: findFirst(headers, MERCH_COLS),
    iCard: findFirst(headers, CARD_COLS),
  };
}
