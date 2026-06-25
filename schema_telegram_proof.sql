-- ============================================================================
-- 텔레그램 수집봇: 증빙 모드 — 추천 매핑 '확인' 대기 상태 저장
--
-- 목적: 폰에서 당근 거래내역 캡쳐를 봇에 전송 → OCR 적재 → 추천 매핑 회신.
--       사용자가 '확인'을 보내면 직전 추천(아래 컬럼에 보관)을 실제 연결.
--
-- 실행 순서: schema_telegram_ingest_v4.sql, schema_proof_ocr.sql 다음
-- ============================================================================

ALTER TABLE public.telegram_ingest_context
  ADD COLUMN IF NOT EXISTS pending_proof_id text,    -- 직전 적재 증빙 id('확인' 대상)
  ADD COLUMN IF NOT EXISTS pending_link_ids jsonb;   -- 추천된 재고 id 배열

COMMENT ON COLUMN public.telegram_ingest_context.pending_proof_id IS '증빙 모드: 직전 적재 증빙. ''확인'' 시 pending_link_ids와 연결';

-- storage_mode 에 'proof' 값이 추가로 쓰인다(기존: '' | image | code). CHECK 제약 없음 — 변경 불필요.

-- ============================================================================
-- [롤백]
--   ALTER TABLE public.telegram_ingest_context
--     DROP COLUMN IF EXISTS pending_proof_id,
--     DROP COLUMN IF EXISTS pending_link_ids;
-- ============================================================================
