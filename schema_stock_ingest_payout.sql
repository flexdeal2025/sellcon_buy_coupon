-- 셀콘 정산완료 스냅샷 (POST /api/stock/ingest/payout)
-- 실행 순서: schema_stock_ingest.sql 다음
-- 셀콘이 PAYOUT_COMPLETED 시 호출 → 확정 지급일 + 실명 해시('지문')를 봉인.
-- 목적: 셀콘 데이터 소실 시에도 소명 가능하도록 최소 증거를 타워에 불변 보존(내구성 안전판).
-- 평문 PII는 저장하지 않음(해시만). 기존 로직·데이터 무수정, 컬럼 추가만.

ALTER TABLE public.stock_registrations
  ADD COLUMN IF NOT EXISTS kyc_name_hash   text NOT NULL DEFAULT '',  -- 셀콘이 계산한 실명 해시(SHA-256). 평문 아님
  ADD COLUMN IF NOT EXISTS payout_locked_at timestamptz;              -- 정산 스냅샷 봉인 시각(있으면 확정·잠금)

-- payout_date 는 schema_stock_ingest.sql 에서 이미 추가됨(정산완료 시 확정값으로 갱신).
