-- 카드내역 자동 입력 규칙 (반복 결제건 품명/비용구분 자동 채우기)
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS public.card_auto_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_merchant text    NOT NULL DEFAULT '',  -- 가맹점명 부분일치 (빈값 = 모든 가맹점)
  match_amount   integer,                       -- 정확 금액 (NULL = 금액 무관)
  set_product    text    NOT NULL DEFAULT '',   -- 채울 품명 (빈값이면 품명 미설정)
  set_category   text    NOT NULL DEFAULT '',   -- 채울 비용구분 (빈값이면 미설정)
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE public.card_auto_rules DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_auto_rules TO anon, authenticated;

-- 규칙 일괄 적용. only_empty=true면 빈 칸만 채움(기존 입력 보존).
-- 반환값: 적용된 셀(품명·비용구분) 건수.
CREATE OR REPLACE FUNCTION public.apply_card_rules(only_empty boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  rule  record;
  total int := 0;
  n     int;
BEGIN
  FOR rule IN SELECT * FROM public.card_auto_rules LOOP
    IF rule.set_product <> '' THEN
      UPDATE public.card_transactions_tax t
        SET product_name = rule.set_product
      WHERE (rule.match_merchant = '' OR t.merchant_name ILIKE '%' || rule.match_merchant || '%')
        AND (rule.match_amount IS NULL OR t.amount = rule.match_amount)
        AND (NOT only_empty OR t.product_name = '')
        AND t.product_name IS DISTINCT FROM rule.set_product;
      GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    END IF;
    IF rule.set_category <> '' THEN
      UPDATE public.card_transactions_tax t
        SET cost_category = rule.set_category
      WHERE (rule.match_merchant = '' OR t.merchant_name ILIKE '%' || rule.match_merchant || '%')
        AND (rule.match_amount IS NULL OR t.amount = rule.match_amount)
        AND (NOT only_empty OR t.cost_category = '')
        AND t.cost_category IS DISTINCT FROM rule.set_category;
      GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    END IF;
  END LOOP;
  RETURN total;
END$$;

GRANT EXECUTE ON FUNCTION public.apply_card_rules(boolean) TO anon, authenticated;
