-- 손익 서버측 집계 (schema_settlements.sql, schema_order_cost.sql 실행 후 추가 실행)
-- 대시보드가 전체 정산행을 받지 않고 DB가 집계한 요약만 받도록 함.
-- 원가는 UI에서 수시로 바뀌므로 사전집계 테이블이 아니라 온디맨드 뷰/RPC로 항상 최신 반영.

-- 1) 주문 건별 손익 뷰 — 원가 우선순위: ① order_cost(총액) → ② product_cost(기간단가)×수량 → ③ 미입력
CREATE OR REPLACE VIEW public.v_order_pnl AS
SELECT
  s.product_order_id,
  s.channel_product_no,
  s.product_name,
  s.decision_date,
  s.quantity,
  s.settle_amount,
  COALESCE(oc.cost_amount, pc.unit_cost * s.quantity) AS cost_amount,
  (oc.cost_amount IS NOT NULL OR pc.unit_cost IS NOT NULL) AS has_cost
FROM public.smartstore_settlements s
LEFT JOIN public.order_cost oc ON oc.product_order_id = s.product_order_id
LEFT JOIN LATERAL (
  SELECT pc.unit_cost
  FROM public.product_cost pc
  WHERE pc.channel_product_no = s.channel_product_no
    AND pc.effective_from <= s.decision_date
    AND (pc.effective_to IS NULL OR s.decision_date <= pc.effective_to)
  ORDER BY pc.effective_from DESC
  LIMIT 1
) pc ON TRUE
WHERE s.order_status = 'PURCHASE_DECIDED'
  AND s.settle_amount IS NOT NULL
  AND s.decision_date IS NOT NULL;

-- 2) 전체 요약
CREATE OR REPLACE FUNCTION public.pnl_summary()
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
  FROM public.v_order_pnl;
$$;

-- 3) 기간별 손익 (gran: day | month | year)
CREATE OR REPLACE FUNCTION public.pnl_by_period(gran text)
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
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

-- 4) 상품별 손익 (원가 입력분, 수익 순)
CREATE OR REPLACE FUNCTION public.pnl_by_product(limit_n int DEFAULT 20)
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
  GROUP BY channel_product_no
  ORDER BY 5 DESC
  LIMIT limit_n;
$$;

-- 5) 원가 미입력 상품 목록 (입력 유도용)
CREATE OR REPLACE FUNCTION public.pnl_missing_products()
RETURNS TABLE(channel_product_no bigint, product_name text, miss_rev bigint, miss_cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    channel_product_no,
    MAX(product_name),
    COALESCE(SUM(settle_amount), 0)::bigint,
    COUNT(*)::bigint
  FROM public.v_order_pnl
  WHERE NOT has_cost
  GROUP BY channel_product_no
  ORDER BY 3 DESC;
$$;

-- anon 키(웹 클라이언트)에서 RPC 호출 허용
GRANT EXECUTE ON FUNCTION public.pnl_summary()              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_by_period(text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_by_product(int)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_missing_products()     TO anon, authenticated;
