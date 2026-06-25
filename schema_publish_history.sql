-- 발행 이력 일원화: 별도 로그 테이블 대신 등록이력(stock_registrations)에 발행 시도 메타를 함께 보관.
-- 등록일시=created_at, 발행일시=published_at(기존). 여기에 실패 사유/마지막 시도/시도횟수를 더한다.
-- 코드는 이 컬럼들이 없어도 발행 자체는 정상(메타 기록만 best-effort로 분리됨 — graceful degrade).
ALTER TABLE public.stock_registrations
  ADD COLUMN IF NOT EXISTS last_publish_error      text,
  ADD COLUMN IF NOT EXISTS last_publish_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_attempts        integer NOT NULL DEFAULT 0;

-- 발행 실패가 남아 있는(검수대기로 환원된) 건 빠르게 조회
CREATE INDEX IF NOT EXISTS idx_stockreg_pub_error
  ON public.stock_registrations (last_publish_attempt_at DESC)
  WHERE last_publish_error IS NOT NULL;
