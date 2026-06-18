#!/usr/bin/env node
/**
 * 공급처 거래명세서(.xls/.xlsx) → supplier_statements 적재
 * 사용법: node --env-file=.env.local scripts/import-supplier-statements.mjs <파일...> --supplier=센드비 [--owner=유정인] [--account=xxx] [--dry] [--replace]
 *   여러 파일 동시 가능. --replace 는 해당 supplier 기존 데이터 삭제 후 적재.
 *
 * 지원 양식 (헤더 이름으로 자동 인식):
 *  - orderList 엑셀: 거래일자 / 상품명 / 주문수량 / 소비자가 / 거래금액
 *  - 전자거래명세서:  거래일자 / 상품명 / 주문수량 / 제공가([%]단가) / 거래금액
 */

import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const argv = process.argv.slice(2);
const flag = (name, def = '') => (argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] || def;
const SUPPLIER = flag('supplier');
const OWNER    = flag('owner', '유정인');
const ACCOUNT  = flag('account');
const DRY      = argv.includes('--dry');
const REPLACE  = argv.includes('--replace');
const FILES    = argv.filter(a => !a.startsWith('--'));

if (!SUPPLIER || FILES.length === 0) {
  console.error('사용법: ... import-supplier-statements.mjs <파일...> --supplier=센드비 [--owner=유정인] [--dry] [--replace]');
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const norm = (s) => String(s ?? '').replace(/[\s ]/g, '');
const num = (v) => { const c = String(v ?? '').replace(/[^0-9-]/g, ''); return c && c !== '-' ? (parseInt(c, 10) || 0) : 0; };

function parseDate(v) {
  if (v instanceof Date && !isNaN(v.getTime()))
    return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  if (typeof v === 'number') {   // Excel serial (.xls raw 숫자)
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20'+m[3] : m[3]; return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; }
  m = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return null;
}

// "[CGV(영화)] CGV 영화관람권" → {brand:'CGV(영화)', name:'CGV 영화관람권'}
// "[맘스터치][맘스터치] 싸이버거 세트" → {brand:'맘스터치', name:'싸이버거 세트'}
function splitProduct(raw) {
  const s = String(raw ?? '').trim();
  const brands = [...s.matchAll(/\[([^\]]*)\]/g)].map(m => m[1]);
  const name = s.replace(/^(\s*\[[^\]]*\]\s*)+/, '').trim();
  return { brand: brands[0] ?? '', name: name || s };
}

// ── 양식 프로파일 레지스트리 ──────────────────────────────
// 공급처/양식이 늘면 여기에 항목만 추가하면 됨. (공급처 이름과 무관 — 헤더 구조로 매칭)
//   require: 헤더 행 판별에 반드시 있어야 하는 컬럼(정규화 이름)
//   cols:    논리 컬럼 → 후보 헤더명들(동의어). 위에서부터 먼저 찾는 것 사용.
const FORMATS = [
  {
    name: '기프티콘 거래명세서/주문목록', // 센드비 등 (전자거래명세서·orderList)
    require: ['거래일자', '상품명'],
    cols: {
      date:    ['거래일자', '주문일자', '주문일', '결제일자', '결제일'],
      product: ['상품명', '품목', '품명', '상품'],
      qty:     ['주문수량', '수량', '개수', '구매수량'],
      unit:    ['소비자가', '제공가', '단가', '공급가', '판매가'],
      total:   ['거래금액', '금액', '합계', '결제금액', '주문금액', '공급가액'],
    },
  },
  // 다른 공급처 양식은 샘플 받아 여기에 추가
];

// 시트 헤더로 양식 프로파일 탐지 → 헤더행 인덱스 + 컬럼 인덱스 매핑 반환
function detectFormat(rows) {
  for (const fmt of FORMATS) {
    const hi = rows.findIndex(r => fmt.require.every(req => r.some(c => norm(c) === norm(req))));
    if (hi === -1) continue;
    const h = rows[hi];
    const find = (cands) => { for (const n of cands) { const i = h.findIndex(c => norm(c) === norm(n)); if (i !== -1) return i; } return -1; };
    const idx = {};
    for (const [k, cands] of Object.entries(fmt.cols)) idx[k] = find(cands);
    return { fmt, hi, idx };
  }
  return null;
}

function parseFile(path) {
  const fname = path.split(/[\\/]/).pop();
  const wb = XLSX.readFile(path);
  const out = [];
  let matched = false;
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, cellDates: true, defval: '' });
    const det = detectFormat(rows);
    if (!det) continue;
    matched = true;
    const { hi, idx } = det;
    for (const r of rows.slice(hi + 1)) {
      const date = parseDate(r[idx.date]);
      if (!date) continue;                       // 합계/빈행 등
      if (!date.startsWith('2025')) continue;    // 25년만
      const { brand, name } = splitProduct(r[idx.product]);
      out.push({
        supplier: SUPPLIER, owner: OWNER, account: ACCOUNT,
        order_date: date, product_name: name, brand, raw_product: String(r[idx.product] ?? '').trim(),
        quantity: idx.qty !== -1 ? num(r[idx.qty]) : 0,
        unit_price: idx.unit !== -1 ? num(r[idx.unit]) : 0,
        line_total: idx.total !== -1 ? num(r[idx.total]) : 0,
        source_file: fname, row_hash: '',
      });
    }
  }
  if (!matched) {
    // 양식 미인식 — 헤더를 출력해 새 프로파일 추가에 참고
    const wb2 = XLSX.readFile(path);
    const first = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, raw: false, defval: '' });
    console.warn(`  ⚠️ 양식 미인식: ${fname}`);
    console.warn(`     1행: ${JSON.stringify((first[0] || []).slice(0, 12))}`);
    console.warn(`     → FORMATS에 프로파일 추가 필요`);
  }
  return out;
}

async function main() {
  const all = [];
  for (const f of FILES) {
    const recs = parseFile(f);
    console.log(`  ${f.split(/[\\/]/).pop()} → ${recs.length}건`);
    all.push(...recs);
  }
  // 파일 간 row_hash 충돌 방지: 전역 인덱스로 재부여
  all.forEach((r, i) => { r.row_hash = `${SUPPLIER}::${r.source_file}::${i}`; });

  const sum = all.reduce((a, b) => a + b.line_total, 0);
  console.log(`\n  공급처 ${SUPPLIER} · 명의자 ${OWNER} · ${all.length}건 · 합계 ${sum.toLocaleString()}원`);
  console.log('  상품명 샘플:', [...new Set(all.map(r => r.product_name))].slice(0, 12).join(' / '));

  if (DRY) { console.log('\n🧪 --dry: DB 미반영\n'); return; }

  if (REPLACE) {
    const { error } = await sb.from('supplier_statements').delete().eq('supplier', SUPPLIER);
    if (error) { console.error('삭제 실패:', error.message); process.exit(1); }
    console.log(`  🗑️  ${SUPPLIER} 기존 데이터 삭제`);
  }

  for (let i = 0; i < all.length; i += 500) {
    const { error } = await sb.from('supplier_statements').upsert(all.slice(i, i + 500), { onConflict: 'row_hash' });
    if (error) { console.error('적재 실패:', error.message); process.exit(1); }
  }
  const { count } = await sb.from('supplier_statements').select('*', { count: 'exact', head: true }).eq('supplier', SUPPLIER);
  console.log(`\n✅ 완료! ${SUPPLIER} 적재 ${count}건\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
