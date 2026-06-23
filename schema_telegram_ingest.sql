-- 텔레그램 수집 봇: 채팅방별 "현재 매입 컨텍스트"(매입일/매입처) 저장
-- 텍스트로 "260623 당근마켓" 보내면 갱신 → 이후 이미지에 자동 적용
-- Supabase SQL Editor 에서 실행

CREATE TABLE IF NOT EXISTS public.telegram_ingest_context (
  chat_id       text PRIMARY KEY,
  purchase_date date,
  supplier      text NOT NULL DEFAULT '',
  code_product  text NOT NULL DEFAULT '',   -- 코드모드: 매칭된 상품명
  code_expiry   text NOT NULL DEFAULT '',   -- 코드모드: 유효기간 YYYY-MM-DD
  code_mode     boolean NOT NULL DEFAULT false, -- 코드모드 활성 여부
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE public.telegram_ingest_context ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.telegram_ingest_context;
CREATE POLICY "anon_all" ON public.telegram_ingest_context FOR ALL USING (true) WITH CHECK (true);
