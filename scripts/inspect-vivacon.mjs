// 외주(비바콘) Supabase coupon_codes 연결/스키마 점검 (읽기 전용)
// 실행: node --env-file=.env.local scripts/inspect-vivacon.mjs
// 민감한 쿠폰번호 값은 출력하지 않음 (컬럼명·건수·상태분포만)
import { createClient } from "@supabase/supabase-js";

const url = process.env.VIVACON_SUPABASE_URL;
const key = process.env.VIVACON_SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("❌ VIVACON_SUPABASE_URL / VIVACON_SUPABASE_SERVICE_KEY 가 .env.local 에 없습니다.");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

// 1) 연결 + 전체 건수 + 컬럼명
const { data, error, count } = await sb
  .from("coupon_codes")
  .select("*", { count: "exact" })
  .limit(1);

if (error) {
  console.error("❌ 조회 실패:", error.message);
  process.exit(1);
}

console.log("✅ 연결 성공");
console.log("총 건수:", count);
console.log("컬럼 목록:", data.length ? Object.keys(data[0]) : "(빈 테이블 — 컬럼 확인 불가)");

// 2) status 분포 (값만 집계, 민감정보 없음)
const { data: rows, error: e2 } = await sb
  .from("coupon_codes")
  .select("status")
  .limit(5000);

if (!e2 && rows) {
  const tally = {};
  for (const r of rows) tally[r.status ?? "(null)"] = (tally[r.status ?? "(null)"] ?? 0) + 1;
  console.log("status 분포(최대 5000건 표본):", tally);
}
