#!/usr/bin/env node
/**
 * 카드내역 엑셀 → Supabase 임포트
 * 사용법: node --env-file=.env.local scripts/import-card-tax.mjs <excel_file.xlsx>
 * 예시:   npm run card-tax "C:\Users\vivay\OneDrive\세무업무\김성수대표님 2025년 카드_26.05_260528확인.xlsx"
 */

import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const EXCEL_PATH = process.argv[2];
if (!EXCEL_PATH) {
  console.error('사용법: npm run card-tax "<엑셀파일경로>"');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// 기대 행 수 (검증용)
const EXPECTED_ROWS = {
  '국민카드': 3076,
  '농협카드': 35,
  '롯데카드': 2735,
  '기업카드': 34,
  '부산은행카드': 53,
  '우리카드': 3997,
  '비씨카드': 246,
  '삼성카드': 300,
  '신한카드': 986,
  '하나카드': 186,
  '현대카드': 1293,
  '제주은행카드': 56,
  '광주은행카드': 22,
};

// 시트명 → 카드사 매핑 (부분 매칭)
function detectCompany(sheetName) {
  const map = [
    ['국민카드', '국민카드'], ['농협카드', '농협카드'], ['롯데카드', '롯데카드'],
    ['기업카드', '기업카드'], ['부산은행', '부산은행카드'], ['우리카드', '우리카드'],
    ['비씨카드', '비씨카드'], ['삼성카드', '삼성카드'], ['신한카드', '신한카드'],
    ['하나카드', '하나카드'], ['현대카드', '현대카드'], ['제주은행', '제주은행카드'],
    ['광주은행', '광주은행카드'],
  ];
  for (const [key, val] of map) {
    if (sheetName.includes(key)) return val;
  }
  return sheetName;
}

// 날짜 → YYYY-MM-DD
// SheetJS cellDates:true → Date 객체, raw:false → 문자열, 숫자(serial) 등 모두 처리
function parseDate(val) {
  if (!val && val !== 0) return null;
  // Date 객체 (cellDates:true)
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // UTC 기준으로 slice하면 시차 오류 → 로컬 기준
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // 숫자(Excel serial) — cellDates 미처리 fallback
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}`;
  }
  // 문자열: "2025-01-02", "2025/01/02", "2025.01.02", "2025-01-02 00:00:00"
  const s = String(val).trim();
  const m1 = s.match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  // "1/2/2025" 또는 "1/2/25" (M/D/YY)
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m2) {
    const yr = m2[3].length === 2 ? `20${m2[3]}` : m2[3];
    return `${yr}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
  }
  return null;
}

// 금액 → 정수 (콤마, 공백 제거)
function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val);
  return parseInt(String(val).replace(/[,\s]/g, ''), 10) || 0;
}

// 비용 구분 정규화
function mapCategory(raw) {
  if (!raw) return '';
  const v = String(raw).trim();
  if (!v) return '';
  if (v.includes('비에스유통')) return '비에스유통';
  if (v.includes('연인터내셔널') || v.includes('연인터')) return '연인터내셔널';
  if (v === '내역 삭제') return '내역 삭제';
  return v;
}

// 헤더 행 인덱스를 찾고 데이터 추출
// 첫 번째 행이 헤더라고 가정 (분석 결과 모든 시트 동일)
function parseSheet(ws, sheetName, company) {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: '' });
  if (raw.length < 2) return [];

  const headers = raw[0].map(h => String(h).trim());
  const dataRows = raw.slice(1).filter(r => r.some(c => c !== ''));

  const col = name => {
    const idx = headers.findIndex(h => h === name);
    return idx;
  };

  const records = [];

  if (company === '광주은행카드') {
    // 특수 처리: 연도 + 일자 조합, 비용구분은 마지막 열에서 파싱
    const iYear = col('연도');
    const iDay  = col('일자');
    const iMerch = col('거래처');
    const iProd  = col('품명');
    const iAmt   = col('합계');
    const iCat   = col('4월확인해주신 내역');

    dataRows.forEach((row, idx) => {
      const year = String(row[iYear] ?? '').trim();
      const day  = String(row[iDay]  ?? '').trim();
      const date = year && day ? `${year}-${day.replace(/\//g, '-')}` : null;
      records.push({
        card_company:     company,
        transaction_date: date,
        card_number:      null,
        merchant_name:    String(row[iMerch] ?? '').trim(),
        amount:           parseAmount(row[iAmt]),
        product_name:     String(row[iProd]  ?? '').trim(),
        cost_category:    mapCategory(row[iCat]),
        row_hash:         `${sheetName}::${idx}`,
      });
    });
    return records;
  }

  // 일반 처리 — 날짜 컬럼명 후보
  // ⚠️ 거래일 기준 = '매출일자'(실제 거래일)를 '매입일자'(카드 청구일)보다 우선.
  //    우리/비씨/기업/부산은행 카드는 두 컬럼 다 있으나, 실제 거래일(매출일자)을 채택.
  //    → 작년 거래의 환불건은 매출일자가 전년도(2024)로 표시되는 게 정상.
  const DATE_COLS  = ['이용일', '매출일자', '매입일자', '거래일', '거래일자', '접수일자'];
  const AMT_COLS   = ['매출금액', '이용금액', '이용금액(원)', '원화사용금액', '승인금액', '이용 금액'];
  const MERCH_COLS = ['가맹점명'];
  const CARD_COLS  = ['카드번호', '이용카드(뒤4자리)'];

  const findFirst = (candidates) => {
    for (const name of candidates) {
      const i = col(name);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iDate  = findFirst(DATE_COLS);
  const iAmt   = findFirst(AMT_COLS);
  const iMerch = findFirst(MERCH_COLS);
  const iCard  = findFirst(CARD_COLS);
  const iProd  = col('품명');
  const iCat   = col('비용 구분');

  // 하나카드는 매출일자(idx 1)가 실제 거래일
  const effectiveDateIdx = company === '하나카드'
    ? (col('매출일자') !== -1 ? col('매출일자') : iDate)
    : iDate;

  dataRows.forEach((row, idx) => {
    records.push({
      card_company:     company,
      transaction_date: parseDate(row[effectiveDateIdx]),
      card_number:      iCard !== -1 ? String(row[iCard] ?? '').trim() || null : null,
      merchant_name:    iMerch !== -1 ? String(row[iMerch] ?? '').trim() : '',
      amount:           parseAmount(row[iAmt]),
      product_name:     iProd !== -1 ? String(row[iProd] ?? '').trim() : '',
      cost_category:    iCat  !== -1 ? mapCategory(row[iCat]) : '',
      row_hash:         `${sheetName}::${idx}`,
    });
  });

  return records;
}

async function main() {
  console.log(`\n📂 파일 읽기: ${EXCEL_PATH}`);
  const wb = XLSX.readFile(EXCEL_PATH);
  console.log(`   시트 수: ${wb.SheetNames.length}개\n`);

  let totalParsed = 0;
  let totalErrors = 0;
  const allRecords = [];
  const summary = [];

  let skippedTotal = 0;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const company = detectCompany(sheetName);
    const parsed = parseSheet(ws, sheetName, company);

    // 날짜 없는 행(합계행·빈행 등 비데이터 행) 제외 후 카운트
    const records = parsed.filter(r => r.transaction_date);
    const skipped = parsed.length - records.length;
    skippedTotal += skipped;

    const expected = EXPECTED_ROWS[company];
    const match = expected !== undefined
      ? (records.length === expected ? '✅' : `⚠️ 기대:${expected}`)
      : '❓';

    const skipNote = skipped > 0 ? `  (합계행 등 ${skipped}건 제외)` : '';
    console.log(`  ${match}  ${company.padEnd(12)}  ${records.length}건${skipNote}`);
    summary.push({ company, count: records.length, expected });
    totalParsed += records.length;
    if (expected && records.length !== expected) totalErrors++;
    allRecords.push(...records);
  }

  console.log(`\n   합계: ${totalParsed}건${skippedTotal > 0 ? `  (비데이터 행 ${skippedTotal}건 제외)` : ''}`);
  if (totalErrors > 0) {
    console.warn(`⚠️  행 수 불일치 시트: ${totalErrors}개`);
  }

  console.log('\n📤 Supabase에 업서트 중...');
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < allRecords.length; i += BATCH) {
    const batch = allRecords.slice(i, i + BATCH);
    const { error } = await supabase
      .from('card_transactions_tax')
      .upsert(batch, { onConflict: 'row_hash' });
    if (error) {
      console.error(`배치 ${i}~${i + batch.length} 오류:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    process.stdout.write(`\r   ${inserted}/${allRecords.length}건`);
  }
  console.log('\n');

  // 검증: DB에서 카드사별 건수 조회
  console.log('🔍 DB 검증 중...');
  const { data: dbCounts, error: dbErr } = await supabase
    .from('card_transactions_tax')
    .select('card_company')
    .then(async ({ data, error }) => {
      if (error) return { data: null, error };
      // count per company
      const counts = {};
      (data ?? []).forEach(r => { counts[r.card_company] = (counts[r.card_company] ?? 0) + 1; });
      return { data: counts, error: null };
    });

  if (dbErr) {
    console.warn('DB 검증 오류:', dbErr.message);
  } else {
    let allOk = true;
    for (const { company, count } of summary) {
      const dbCount = dbCounts[company] ?? 0;
      if (dbCount < count) {
        console.warn(`  ⚠️  ${company}: 파싱 ${count}건 vs DB ${dbCount}건`);
        allOk = false;
      }
    }
    if (allOk) console.log('  ✅ 모든 시트 행 수 일치');
  }

  const { count: grandTotal } = await supabase
    .from('card_transactions_tax')
    .select('*', { count: 'exact', head: true });

  console.log(`\n✅ 완료! DB 전체 건수: ${grandTotal}건\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
