-- 텔레그램 수집봇: 저장형식(이미지형/코드형) 선택 모드
-- 실행 순서: schema_telegram_ingest_v2.sql 다음
-- ⚠️ 이 마이그레이션을 먼저 적용해야 새 봇 흐름(모드 선택 → 매입설정 → 수집)이 동작함.

ALTER TABLE public.telegram_ingest_context
  ADD COLUMN IF NOT EXISTS storage_mode text NOT NULL DEFAULT '';  -- '' | image | code
