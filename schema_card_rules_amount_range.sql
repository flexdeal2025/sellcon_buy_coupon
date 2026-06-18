-- 자동입력 규칙에 금액 범위 조건 추가 (이상 ≥ / 이하 ≤)
-- schema_card_rules.sql 실행 후 추가 실행. Supabase SQL Editor에서 실행.

ALTER TABLE public.card_auto_rules
  ADD COLUMN IF NOT EXISTS amount_min integer,   -- 이 금액 이상(>=)일 때 매칭 (NULL=조건없음)
  ADD COLUMN IF NOT EXISTS amount_max integer;   -- 이 금액 이하(<=)일 때 매칭 (NULL=조건없음)

-- 규칙 적용 RPC 교체: 가맹점 + (정확금액 | 금액범위) 모두 AND 조건
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
        AND (rule.amount_min   IS NULL OR t.amount >= rule.amount_min)
        AND (rule.amount_max   IS NULL OR t.amount <= rule.amount_max)
        AND (NOT only_empty OR t.product_name = '')
        AND t.product_name IS DISTINCT FROM rule.set_product;
      GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    END IF;
    IF rule.set_category <> '' THEN
      UPDATE public.card_transactions_tax t
        SET cost_category = rule.set_category
      WHERE (rule.match_merchant = '' OR t.merchant_name ILIKE '%' || rule.match_merchant || '%')
        AND (rule.match_amount IS NULL OR t.amount = rule.match_amount)
        AND (rule.amount_min   IS NULL OR t.amount >= rule.amount_min)
        AND (rule.amount_max   IS NULL OR t.amount <= rule.amount_max)
        AND (NOT only_empty OR t.cost_category = '')
        AND t.cost_category IS DISTINCT FROM rule.set_category;
      GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    END IF;
  END LOOP;
  RETURN total;
END$$;

GRANT EXECUTE ON FUNCTION public.apply_card_rules(boolean) TO anon, authenticated;
