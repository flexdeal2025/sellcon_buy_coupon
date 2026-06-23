-- 텔레그램 수집봇 '취소(undo)' 지원
-- 실행 순서: schema_telegram_ingest.sql 다음
--
-- 채팅방별 '직전 등록 id 묶음'을 저장해, '취소' 명령 시 정확히 그 행들만
-- (검수대기·미발행 한정) 삭제할 수 있게 한다.
-- 미적용 상태에서도 봇은 정상 동작한다(코드가 컬럼 부재를 조용히 무시).

ALTER TABLE public.telegram_ingest_context
  ADD COLUMN IF NOT EXISTS last_insert_ids uuid[] NOT NULL DEFAULT '{}';
