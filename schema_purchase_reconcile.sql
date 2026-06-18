-- 매입대조: 공급처 명세서 ↔ 카드내역 매칭 + 카드 품명 자동기입
-- Supabase SQL Editor에서 실행 (schema_supplier_statements.sql 이후)

-- 1) 명세서 공급처 목록 (필터용)
CREATE OR REPLACE FUNCTION public.distinct_statement_suppliers()
RETURNS TABLE(supplier text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT supplier FROM public.supplier_statements ORDER BY supplier;
$$;
GRANT EXECUTE ON FUNCTION public.distinct_statement_suppliers() TO anon, authenticated;

-- 2) 명세서별 카드 매칭 상태 (금액 동일 + 거래일 ±3일)
--    exact_cnt: 같은 날짜 매칭 카드 수, near_cnt: ±3일내(날짜 다른) 매칭 카드 수
CREATE OR REPLACE FUNCTION public.statement_match_status()
RETURNS TABLE(statement_id uuid, exact_cnt bigint, near_cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT s.id,
    count(c.id) FILTER (WHERE c.transaction_date = s.order_date),
    count(c.id) FILTER (WHERE c.transaction_date <> s.order_date)
  FROM public.supplier_statements s
  LEFT JOIN public.card_transactions_tax c
    ON c.amount = s.line_total
   AND abs(c.transaction_date - s.order_date) <= 3
  GROUP BY s.id;
$$;
GRANT EXECUTE ON FUNCTION public.statement_match_status() TO anon, authenticated;

-- 3) 카드 품명 자동기입: 명세서와 금액+거래일 정확 일치하고,
--    매칭 명세서의 상품명이 단일(모호하지 않음)인 카드건의 빈 품명을 채움.
CREATE OR REPLACE FUNCTION public.fill_card_products_from_statements(only_empty boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH uniq AS (
    SELECT c.id AS card_id, max(s.product_name) AS pname
    FROM public.card_transactions_tax c
    JOIN public.supplier_statements s
      ON s.line_total = c.amount AND s.order_date = c.transaction_date
    WHERE (NOT only_empty OR c.product_name = '')
      AND s.product_name <> ''
    GROUP BY c.id
    HAVING count(DISTINCT s.product_name) = 1
  )
  UPDATE public.card_transactions_tax c
    SET product_name = u.pname
  FROM uniq u
  WHERE c.id = u.card_id
    AND c.product_name IS DISTINCT FROM u.pname;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END$$;
GRANT EXECUTE ON FUNCTION public.fill_card_products_from_statements(boolean) TO anon, authenticated;
