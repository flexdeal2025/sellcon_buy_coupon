// 센드비 거래명세서(.xls) ↔ 카드내역 대조 검증 리포트 (DB 변경 없음, 읽기 전용)
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FILES = [
  'C:/Users/vivay/Desktop/비바콘/발송사이트 백업/센드비/20250808_orderList_센드비_limpidk@gmail.com8.8탈퇴.xls',
  'C:/Users/vivay/Desktop/비바콘/발송사이트 백업/센드비/vivayji@gmail.com 12.24 탈퇴/20251224_orderList_vivayji(탈퇴) 25년.xls',
];

const num = (v) => parseInt(String(v ?? '').replace(/[^0-9-]/g, ''), 10) || 0;
function parseDate(s) {
  s = String(s ?? '').trim();
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; }
  m = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return null;
}
const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);

// 명세서 라인 로드
const lines = [];
for (const f of FILES) {
  const wb = XLSX.readFile(f);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  const acct = f.includes('limpidk') ? 'limpidk' : 'vivayji';
  rows.slice(1).forEach((r) => {
    if (!r[0]) return;
    const date = parseDate(r[0]);
    if (!date || !date.startsWith('2025')) return; // 25년만
    lines.push({ acct, date, product: String(r[1]).trim(), qty: num(r[2]), unit: num(r[3]), total: num(r[4]) });
  });
}
lines.sort((a, b) => a.date.localeCompare(b.date));

// 카드내역 전체 로드 (금액·날짜·가맹점)
let card = [];
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from('card_transactions_tax')
    .select('transaction_date,merchant_name,amount,card_company,product_name').range(from, from + 999);
  if (!data?.length) break;
  card = card.concat(data);
  if (data.length < 1000) break;
}

const WINDOW = 3;
let exact = 0, near = 0, ambig = 0, none = 0;
const report = [];
for (const ln of lines) {
  const sameAmt = card.filter((c) => c.amount === ln.total);
  const within = sameAmt.filter((c) => Math.abs(dayDiff(c.transaction_date, ln.date)) <= WINDOW);
  const exactDay = within.filter((c) => c.transaction_date === ln.date);
  let cls, note;
  if (exactDay.length === 1) { cls = '✅정확'; exact++; note = `${exactDay[0].transaction_date} ${exactDay[0].merchant_name.slice(0,12)}/${exactDay[0].card_company}`; }
  else if (within.length === 1) { cls = '🟡근접'; near++; note = `${within[0].transaction_date}(${dayDiff(within[0].transaction_date, ln.date)>0?'+':''}${dayDiff(within[0].transaction_date, ln.date)}d) ${within[0].card_company}`; }
  else if (within.length > 1 || exactDay.length > 1) { cls = '🟠중복'; ambig++; note = `${within.length}건 후보`; }
  else { cls = '❌무매칭'; none++; note = sameAmt.length ? `금액일치 ${sameAmt.length}건 있으나 날짜 ±${WINDOW}일 밖` : '금액 없음'; }
  report.push(`${cls} ${ln.date} ${String(ln.total).padStart(9)} ${ln.product.replace(/\[[^\]]*\]/g,'').trim().slice(0,18).padEnd(18)} → ${note}`);
}

console.log(`\n명세서 라인: ${lines.length}건 (limpidk ${lines.filter(l=>l.acct==='limpidk').length}, vivayji ${lines.filter(l=>l.acct==='vivayji').length})`);
console.log(`카드내역 로드: ${card.length}건\n`);
report.forEach((r) => console.log(r));
console.log(`\n결과: ✅정확 ${exact} · 🟡근접 ${near} · 🟠중복 ${ambig} · ❌무매칭 ${none}  (자동매칭 가능 ≈ ${exact+near}/${lines.length})`);
