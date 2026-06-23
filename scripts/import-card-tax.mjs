#!/usr/bin/env node
/**
 * 카드내역 엑셀 → Supabase 임포트 (카드사별 시트 자동 파싱)
 * 사용법: node --env-file=.env.local scripts/import-card-tax.mjs <excel.xlsx> [--replace]
 *   --replace : 기존 card_transactions_tax 전체 삭제 후 적재 (납세자 교체 시)
 *
 * 시트 형식이 카드사·발급처마다 달라서, 컬럼은 고정 인덱스가 아니라
 * "헤더 이름"으로 탐지한다. 헤더 줄바꿈/탭/공백은 정규화 후 비교.
 * 헤더가 1행이 아닐 수 있어('품명' 포함 행을 헤더로 자동 탐지) 데이터 시작 위치도 가변.
 *
 * 순수 파싱 함수(norm/detectCompany/parseDate/parseAmount/mapCategory/findFirst 및
 * 컬럼 우선순위 상수)는 ./lib/card-tax-parse.mjs 로 분리됨 (테스트·회귀방지).
 */

import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';
import {
  norm, detectCompany, parseDate, parseAmount, mapCategory,
  findFirst, DATE_COLS, AMT_COLS, EXCLUDE_AMT, MERCH_COLS, CARD_COLS,
} from './lib/card-tax-parse.mjs';

const argv = process.argv.slice(2);
const REPLACE = argv.includes('--replace');
const DRY = argv.includes('--dry');
const OWNER = (argv.find(a => a.startsWith('--owner=')) || '').split('=')[1] || '유정인';
const EXCEL_PATH = argv.find(a => !a.startsWith('--'));
if (!EXCEL_PATH) {
  console.error('사용법: npm run card-tax "<엑셀파일경로>" [--owner=명의자] [--replace] [--dry]');
  console.error('  예: npm run card-tax "...김성수....xlsx" --owner=김성수 --replace');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function parseSheet(ws, sheetName, company) {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: '' });
  if (raw.length < 2) return { records: [], headerIdx: -1, rawCount: 0 };

  // 헤더 행 자동 탐지: '품명'을 포함하는 첫 행 (없으면 0행)
  let headerIdx = raw.findIndex(r => r.some(c => norm(c) === '품명'));
  if (headerIdx === -1) headerIdx = 0;

  const headers = raw[headerIdx];
  const dataRows = raw.slice(headerIdx + 1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));

  // 정규화 이름으로 컬럼 인덱스 탐지
  const col = (name) => headers.findIndex(h => norm(h) === norm(name));

  const records = [];

  // 광주은행: 연도 + 일자 조합, 비용구분은 '...확인...내역' 열에서 파싱
  if (company === '광주은행카드' && col('연도') !== -1) {
    const iYear = col('연도'), iDay = col('일자'), iMerch = col('거래처');
    const iProd = col('품명'), iAmt = col('합계');
    const iCat = headers.findIndex(h => norm(h).includes('확인') && norm(h).includes('내역'));
    dataRows.forEach((row, idx) => {
      const year = String(row[iYear] ?? '').trim();
      const day = String(row[iDay] ?? '').trim();
      records.push({
        card_company: company,
        transaction_date: year && day ? `${year}-${day.replace(/[.\/]/g, '-')}` : null,
        card_number: null,
        merchant_name: String(row[iMerch] ?? '').trim(),
        amount: parseAmount(row[iAmt]),
        product_name: String(row[iProd] ?? '').trim(),
        cost_category: mapCategory(iCat !== -1 ? row[iCat] : ''),
        owner: OWNER,
        row_hash: `${sheetName}::${idx}`,
      });
    });
    return { records, headerIdx, rawCount: dataRows.length };
  }

  // 일반 처리 — 거래일 기준 = '매출일자'(실제 거래일)를 '매입일자'(청구일)보다 우선.
  //   → 작년 거래의 환불건은 매출일자가 전년도(2024)로 표시되는 게 정상.
  //   (DATE_COLS/AMT_COLS/EXCLUDE_AMT/MERCH_COLS/CARD_COLS, findFirst 는 분리 모듈에서 import)
  let iDate    = findFirst(headers, DATE_COLS);
  // 폴백: 헤더가 2행으로 분리된 시트(예: 제주은행 "거래"+"일자")는 날짜 컬럼명을 못 찾음.
  //       첫 컬럼이 날짜로 파싱되면 첫 컬럼을 거래일로 사용.
  if (iDate === -1 && dataRows.some(r => parseDate(r[0]))) iDate = 0;
  const iAmt   = findFirst(headers, AMT_COLS, EXCLUDE_AMT);
  const iMerch = findFirst(headers, MERCH_COLS);
  const iCard  = findFirst(headers, CARD_COLS);
  const iProd  = col('품명');
  const iCat   = col('비용 구분');

  if (DRY) {
    const hNames = headers.map((h, i) => `[${i}]${norm(h) || '(빈)'}`).join(' | ');
    console.log(`    헤더: ${hNames}`);
    console.log(`    감지: 날짜=[${iDate}]${headers[iDate] ?? '?'} 금액=[${iAmt}]${headers[iAmt] ?? '?'} 가맹점=[${iMerch}]${headers[iMerch] ?? '?'}`);
  }

  dataRows.forEach((row, idx) => {
    records.push({
      card_company: company,
      transaction_date: iDate !== -1 ? parseDate(row[iDate]) : null,
      card_number: iCard !== -1 ? (String(row[iCard] ?? '').trim() || null) : null,
      merchant_name: iMerch !== -1 ? String(row[iMerch] ?? '').trim() : '',
      amount: iAmt !== -1 ? parseAmount(row[iAmt]) : 0,
      product_name: iProd !== -1 ? String(row[iProd] ?? '').trim() : '',
      cost_category: iCat !== -1 ? mapCategory(row[iCat]) : '',
      row_hash: `${sheetName}::${idx}`,
    });
  });

  return { records, headerIdx, rawCount: dataRows.length };
}

async function main() {
  console.log(`\n📂 파일 읽기: ${EXCEL_PATH}`);
  const wb = XLSX.readFile(EXCEL_PATH);
  console.log(`   시트 수: ${wb.SheetNames.length}개  ·  명의자: ${OWNER}${REPLACE ? '  [⚠️ --replace: 기존 데이터 전체 삭제]' : ''}\n`);

  const allRecords = [];
  const dropped = [];
  let totalRaw = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const company = detectCompany(sheetName);
    const { records: parsed, headerIdx, rawCount } = parseSheet(ws, sheetName, company);

    // 날짜 없는 행(합계행·연속헤더행·빈행 등 비데이터 행) 제외
    const records = parsed.filter(r => r.transaction_date);
    const skip = parsed.filter(r => !r.transaction_date);
    dropped.push(...skip);
    totalRaw += rawCount;

    const skipNote = skip.length > 0 ? `  (비데이터 ${skip.length}건 제외)` : '';
    const hdrNote = headerIdx > 0 ? `  [헤더 ${headerIdx + 1}행째]` : '';
    console.log(`  ${company.padEnd(14)}  원본 ${String(rawCount).padStart(4)} → 적재 ${String(records.length).padStart(4)}건${skipNote}${hdrNote}`);
    allRecords.push(...records);
  }

  console.log(`\n   원본 데이터행 합계: ${totalRaw}건  →  적재 대상: ${allRecords.length}건`);
  if (dropped.length) {
    console.log(`   제외된 비데이터행 ${dropped.length}건: ${dropped.map(r => r.row_hash).join(', ')}`);
  }

  if (DRY) {
    console.log('\n🧪 --dry: DB에 쓰지 않고 종료 (파싱 검증 전용)\n');
    return;
  }

  if (REPLACE) {
    console.log('\n🗑️  기존 데이터 삭제 중...');
    const { error } = await supabase.from('card_transactions_tax').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) { console.error('삭제 실패:', error.message); process.exit(1); }
    console.log('   완료');
  }

  console.log('\n📤 Supabase에 업서트 중...');
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < allRecords.length; i += BATCH) {
    const batch = allRecords.slice(i, i + BATCH);
    const { error } = await supabase.from('card_transactions_tax').upsert(batch, { onConflict: 'row_hash' });
    if (error) { console.error(`배치 ${i} 오류:`, error.message); process.exit(1); }
    inserted += batch.length;
    process.stdout.write(`\r   ${inserted}/${allRecords.length}건`);
  }
  console.log('\n');

  // DB 검증 — 카드사별 건수 (행 조회는 1000행 캡이 있어 카드사별 count 쿼리로 집계)
  const companies = [...new Set(allRecords.map(r => r.card_company))].sort();
  console.log('🔍 DB 카드사별 건수:');
  for (const c of companies) {
    const { count } = await supabase
      .from('card_transactions_tax')
      .select('*', { count: 'exact', head: true })
      .eq('card_company', c);
    console.log(`   ${c.padEnd(14)} ${count}건`);
  }

  const { count: grandTotal } = await supabase
    .from('card_transactions_tax')
    .select('*', { count: 'exact', head: true });
  console.log(`\n✅ 완료! DB 전체 건수: ${grandTotal}건`);

  // 자동 입력 규칙 적용 (빈 칸만) — 함수 없으면 조용히 건너뜀
  const { data: applied, error: ruleErr } = await supabase.rpc('apply_card_rules', { only_empty: true });
  if (!ruleErr && applied != null) {
    console.log(`🤖 자동규칙 적용: ${applied}건 채움`);
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
