-- 카드 내역 세무 관리 (종합소득세 신고용)
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS public.card_transactions_tax (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  card_company     text    NOT NULL,
  transaction_date date    NOT NULL,
  card_number      text,
  merchant_name    text    NOT NULL DEFAULT '',
  amount           integer NOT NULL,
  product_name     text    NOT NULL DEFAULT '',
  cost_category    text    NOT NULL DEFAULT '',
  row_hash         text    NOT NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT card_transactions_tax_row_hash_key UNIQUE (row_hash)
);

CREATE INDEX IF NOT EXISTS ctt_date_idx     ON public.card_transactions_tax (transaction_date);
CREATE INDEX IF NOT EXISTS ctt_company_idx  ON public.card_transactions_tax (card_company);
CREATE INDEX IF NOT EXISTS ctt_category_idx ON public.card_transactions_tax (cost_category);
CREATE INDEX IF NOT EXISTS ctt_product_idx  ON public.card_transactions_tax (product_name);

-- 비용 구분 옵션 테이블
CREATE TABLE IF NOT EXISTS public.cost_category_options (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text    NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT cost_category_options_label_key UNIQUE (label)
);

INSERT INTO public.cost_category_options (label, sort_order) VALUES
  ('연인터내셔널', 1),
  ('비에스유통',   2),
  ('내역 삭제',   3)
ON CONFLICT (label) DO NOTHING;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS ctt_updated_at ON public.card_transactions_tax;
CREATE TRIGGER ctt_updated_at
  BEFORE UPDATE ON public.card_transactions_tax
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 내부 관리 도구 — RLS 비활성화, anon 접근 허용
ALTER TABLE public.card_transactions_tax    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_category_options    DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_transactions_tax TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_category_options TO anon, authenticated;

-- 필터용 카드사 목록 (행 조회 1000행 캡 회피 — DISTINCT 집계)
CREATE OR REPLACE FUNCTION public.distinct_card_companies()
RETURNS TABLE(card_company text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT card_company FROM public.card_transactions_tax ORDER BY card_company;
$$;
GRANT EXECUTE ON FUNCTION public.distinct_card_companies() TO anon, authenticated;
