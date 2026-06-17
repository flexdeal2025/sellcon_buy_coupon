-- 손익 RPC 함수 v2: 날짜 범위 필터 파라미터 추가
-- schema_pnl_functions.sql 실행 후 이 파일을 추가 실행 (함수 교체)
-- DEFAULT NULL 이므로 파라미터 없이 호출하면 전체 기간 그대로 동작함.

CREATE OR REPLACE FUNCTION public.pnl_summary(date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE(matched_rev bigint, cost bigint, profit bigint, miss_rev bigint, miss_cnt bigint, miss_products bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(settle_amount) FILTER (WHERE has_cost), 0)::bigint,
    COALESCE(SUM(cost_amount)   FILTER (WHERE has_cost), 0)::bigint,
    (COALESCE(SUM(settle_amount) FILTER (WHERE has_cost), 0)
       - COALESCE(SUM(cost_amount) FILTER (WHERE has_cost), 0))::bigint,
    COALESCE(SUM(settle_amount) FILTER (WHERE NOT has_cost), 0)::bigint,
    COUNT(*) FILTER (WHERE NOT has_cost)::bigint,
    COUNT(DISTINCT channel_product_no) FILTER (WHERE NOT has_cost)::bigint
  FROM public.v_order_pnl
  WHERE (date_from IS NULL OR decision_date >= date_from)
    AND (date_to   IS NULL OR decision_date <= date_to);
$$;

CREATE OR REPLACE FUNCTION public.pnl_by_period(gran text, date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE(period text, matched_rev bigint, cost bigint, profit bigint, miss_rev bigint, miss_cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE gran
      WHEN 'day'   THEN to_char(decision_date, 'YYYY-MM-DD')
      WHEN 'month' THEN to_char(decision_date, 'YYYY-MM')
      ELSE              to_char(decision_date, 'YYYY')
    END AS period,
    COALESCE(SUM(settle_amount) FILTER (WHERE has_cost), 0)::bigint,
    COALESCE(SUM(cost_amount)   FILTER (WHERE has_cost), 0)::bigint,
    (COALESCE(SUM(settle_amount) FILTER (WHERE has_cost), 0)
       - COALESCE(SUM(cost_amount) FILTER (WHERE has_cost), 0))::bigint,
    COALESCE(SUM(settle_amount) FILTER (WHERE NOT has_cost), 0)::bigint,
    COUNT(*) FILTER (WHERE NOT has_cost)::bigint
  FROM public.v_order_pnl
  WHERE (date_from IS NULL OR decision_date >= date_from)
    AND (date_to   IS NULL OR decision_date <= date_to)
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

CREATE OR REPLACE FUNCTION public.pnl_by_product(limit_n int DEFAULT 20, date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE(channel_product_no bigint, product_name text, rev bigint, cost bigint, profit bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    channel_product_no,
    MAX(product_name),
    COALESCE(SUM(settle_amount), 0)::bigint,
    COALESCE(SUM(cost_amount), 0)::bigint,
    (COALESCE(SUM(settle_amount), 0) - COALESCE(SUM(cost_amount), 0))::bigint
  FROM public.v_order_pnl
  WHERE has_cost
    AND (date_from IS NULL OR decision_date >= date_from)
    AND (date_to   IS NULL OR decision_date <= date_to)
  GROUP BY channel_product_no
  ORDER BY 5 DESC
  LIMIT limit_n;
$$;

CREATE OR REPLACE FUNCTION public.pnl_missing_products(date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE(channel_product_no bigint, product_name text, miss_rev bigint, miss_cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    channel_product_no,
    MAX(product_name),
    COALESCE(SUM(settle_amount), 0)::bigint,
    COUNT(*)::bigint
  FROM public.v_order_pnl
  WHERE NOT has_cost
    AND (date_from IS NULL OR decision_date >= date_from)
    AND (date_to   IS NULL OR decision_date <= date_to)
  GROUP BY channel_product_no
  ORDER BY 3 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.pnl_summary(date, date)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_by_period(text, date, date)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_by_product(int, date, date)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_missing_products(date, date)    TO anon, authenticated;
