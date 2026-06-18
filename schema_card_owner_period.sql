-- 카드내역에 명의자 + 연/월 컬럼 추가 (월별·명의자별 필터용)
-- Supabase SQL Editor에서 실행

-- 1) 명의자 컬럼 (기존 데이터는 '유정인')
ALTER TABLE public.card_transactions_tax ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT '';
UPDATE public.card_transactions_tax SET owner = '유정인' WHERE owner = '' OR owner IS NULL;

-- 2) 연/월 컬럼 — transaction_date에서 자동 계산(생성 컬럼). 2025 / 06 형식.
--    to_char()는 로케일 의존이라 생성컬럼에 못 씀(not immutable) → extract()+lpad() 사용.
ALTER TABLE public.card_transactions_tax
  ADD COLUMN IF NOT EXISTS year  text GENERATED ALWAYS AS (lpad((extract(year  from transaction_date))::text, 4, '0')) STORED,
  ADD COLUMN IF NOT EXISTS month text GENERATED ALWAYS AS (lpad((extract(month from transaction_date))::text, 2, '0')) STORED;

CREATE INDEX IF NOT EXISTS ctt_owner_idx      ON public.card_transactions_tax (owner);
CREATE INDEX IF NOT EXISTS ctt_yearmonth_idx  ON public.card_transactions_tax (year, month);

-- 3) 필터 드롭다운용 distinct 목록 (1000행 캡 회피)
CREATE OR REPLACE FUNCTION public.distinct_card_owners()
RETURNS TABLE(owner text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT owner FROM public.card_transactions_tax WHERE owner <> '' ORDER BY owner;
$$;
GRANT EXECUTE ON FUNCTION public.distinct_card_owners() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.distinct_card_years()
RETURNS TABLE(year text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT year FROM public.card_transactions_tax WHERE year IS NOT NULL ORDER BY year DESC;
$$;
GRANT EXECUTE ON FUNCTION public.distinct_card_years() TO anon, authenticated;
