-- 텔레그램 수집봇: 세션 배치 기억(순번 배치 지원)
-- 실행 순서: schema_telegram_ingest_v3.sql 다음
-- ⚠️ 이 마이그레이션을 먼저 적용해야 매입설정마다 새 번호 배치(TG-YYMMDD-매입처-NNN)가 동작함.

ALTER TABLE public.telegram_ingest_context
  ADD COLUMN IF NOT EXISTS batch_no text NOT NULL DEFAULT '';  -- 현재 세션 배치명(매입설정 시 갱신)
