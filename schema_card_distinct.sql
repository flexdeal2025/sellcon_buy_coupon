-- 카드장부: 카드번호 distinct + 카드별 합계 RPC
-- Supabase SQL Editor 에서 실행

-- 카드번호 목록 (필터 드롭다운용)
CREATE OR REPLACE FUNCTION public.distinct_card_numbers()
RETURNS TABLE(card_number text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT card_number
  FROM public.card_transactions_tax
  WHERE card_number IS NOT NULL AND card_number <> ''
  ORDER BY card_number;
$$;
GRANT EXECUTE ON FUNCTION public.distinct_card_numbers() TO anon, authenticated;

-- 카드사 × 카드번호별 건수·합계
CREATE OR REPLACE FUNCTION public.card_number_summary()
RETURNS TABLE(card_company text, card_number text, cnt bigint, total bigint) LANGUAGE sql STABLE AS $$
  SELECT card_company, COALESCE(card_number, '') AS card_number,
         COUNT(*) AS cnt, COALESCE(SUM(amount), 0)::bigint AS total
  FROM public.card_transactions_tax
  GROUP BY card_company, COALESCE(card_number, '')
  ORDER BY card_company, card_number;
$$;
GRANT EXECUTE ON FUNCTION public.card_number_summary() TO anon, authenticated;
