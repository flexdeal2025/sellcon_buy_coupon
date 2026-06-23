-- ============================================================================
-- 손익 제외 상품 + v_order_pnl '결제 조정' 분리
-- 실행 순서: schema_pnl_functions.sql → schema_pnl_functions_v2.sql → (이 파일)
--
-- 목적: '[비바콘] 별도 결제 상품'(channel_product_no=11614544910)처럼 실제
--       기프티콘이 아닌 결제 패스스루/조정성 상품을 손익(P&L) 계산에서 제외.
--
-- ⚠️ 설계 원칙 (세무·CTO 이사회 합의):
--   1) 원본 smartstore_settlements 는 절대 건드리지 않는다 → 부가세 신고상
--      "실매출 기록"은 그대로 보존 (감사 대비).
--   2) 손익에서 '안 보이게' 하지 않고, 별도 '결제 조정' 버킷(adj_rev/adj_cnt)으로
--      옮겨 화면에 표시 → "정산합계 ≠ 손익매출" 차액이 화면에서 설명됨.
--   3) 제외 대상은 코드에 박지 않고 pnl_excluded_products 테이블로 관리
--      → 새 더미상품은 INSERT 한 줄, 사유(reason)가 곧 세무 소명자료.
--
-- ✅ [결정 2026-06-24] 별도결제 상품은 '제외'가 아니라 '매출 유지 + 건별 원가 입력'.
--   → 제외 목록에서 제거(위 2번). 인프라(테이블/뷰/함수)는 향후 진짜 비매출용 휴면.
--   원가 입력 시 ⚠️이중계상 주의: 같은 기프티콘 원가가 다른(취소된) 주문에 또
--   잡혀있지 않은지 확인하고, order_cost.note 에 소명근거를 남길 것(가이드 별도).
-- ============================================================================

-- 1) 제외 상품 설정 테이블 ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pnl_excluded_products (
  channel_product_no bigint PRIMARY KEY,
  reason             text,
  treatment          text NOT NULL DEFAULT 'exclude'
                       CHECK (treatment IN ('exclude', 'deduct')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pnl_excluded_products IS
  '손익(P&L)에서 제외할 상품. exclude=매출유지·손익만제외 / deduct=매출에서도차감';

ALTER TABLE public.pnl_excluded_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.pnl_excluded_products;
CREATE POLICY "anon_all" ON public.pnl_excluded_products FOR ALL USING (true) WITH CHECK (true);

-- 2) 초기 제외 대상: 없음 -----------------------------------------------------
--    [결정 2026-06-24] '별도 결제 상품'(11614544910)은 제외하지 않는다.
--    고객이 스마트스토어에 실제 결제를 일으킨 건이라 매출(부가세 신고대상)로
--    반드시 잡혀야 한다 → 손익에서 빼면 안 됨. 대신 발생 시마다 '건별 원가'
--    (order_cost)에 매입원가를 직접 입력해 매출−원가−수익으로 정상 반영한다.
--    (톡톡 상담 이력으로 어떤 실상품 결제인지 파악 → 그 상품 원가를 건별 입력)
--
--    이 테이블은 '진짜 비매출'(테스트·오등록 등 매출로 잡으면 안 되는 건)이
--    생길 때를 위한 휴면 인프라로 비워 둔다. 그런 건이 생기면 아래처럼 추가:
--      INSERT INTO public.pnl_excluded_products (channel_product_no, reason, treatment)
--      VALUES (<번호>, '<사유=소명자료>', 'exclude');  -- 매출에서도 빼려면 'deduct'
--
--    ⚠️ 이미 이 파일을 한 번 실행해 11614544910 이 들어가 있다면, 매출 복구를 위해
--       아래 한 줄을 SQL Editor 에서 실행하세요:
--         DELETE FROM public.pnl_excluded_products WHERE channel_product_no = 11614544910;

-- 3) 주문 건별 손익 뷰 재정의 -------------------------------------------------
--    schema_pnl_functions.sql 의 본문 그대로 + is_adjustment 컬럼만 추가.
--    (행을 제거하지 않고 플래그만 부여 → 함수에서 손익/조정 버킷으로 분리)
CREATE OR REPLACE VIEW public.v_order_pnl AS
SELECT
  s.product_order_id,
  s.channel_product_no,
  s.product_name,
  s.decision_date,
  s.quantity,
  s.settle_amount,
  COALESCE(oc.cost_amount, pc.unit_cost * s.quantity) AS cost_amount,
  (oc.cost_amount IS NOT NULL OR pc.unit_cost IS NOT NULL) AS has_cost,
  EXISTS (
    SELECT 1 FROM public.pnl_excluded_products x
    WHERE x.channel_product_no = s.channel_product_no
  ) AS is_adjustment
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

-- 4) 전체 요약 — 손익에서 조정상품 제외 + adj_rev/adj_cnt 별도 반환 -----------
--    RETURNS 시그니처가 바뀌므로(컬럼 2개 추가) DROP 후 재생성 필요.
DROP FUNCTION IF EXISTS public.pnl_summary(date, date);
DROP FUNCTION IF EXISTS public.pnl_summary();
CREATE FUNCTION public.pnl_summary(date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE(
  matched_rev bigint, cost bigint, profit bigint,
  miss_rev bigint, miss_cnt bigint, miss_products bigint,
  adj_rev bigint, adj_cnt bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(settle_amount) FILTER (WHERE has_cost AND NOT is_adjustment), 0)::bigint,
    COALESCE(SUM(cost_amount)   FILTER (WHERE has_cost AND NOT is_adjustment), 0)::bigint,
    (COALESCE(SUM(settle_amount) FILTER (WHERE has_cost AND NOT is_adjustment), 0)
       - COALESCE(SUM(cost_amount) FILTER (WHERE has_cost AND NOT is_adjustment), 0))::bigint,
    COALESCE(SUM(settle_amount) FILTER (WHERE NOT has_cost AND NOT is_adjustment), 0)::bigint,
    COUNT(*) FILTER (WHERE NOT has_cost AND NOT is_adjustment)::bigint,
    COUNT(DISTINCT channel_product_no) FILTER (WHERE NOT has_cost AND NOT is_adjustment)::bigint,
    COALESCE(SUM(settle_amount) FILTER (WHERE is_adjustment), 0)::bigint,
    COUNT(*) FILTER (WHERE is_adjustment)::bigint
  FROM public.v_order_pnl
  WHERE (date_from IS NULL OR decision_date >= date_from)
    AND (date_to   IS NULL OR decision_date <= date_to);
$$;

-- 5) 기간별 손익 — 조정상품 제외 ---------------------------------------------
CREATE OR REPLACE FUNCTION public.pnl_by_period(gran text, date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE(period text, matched_rev bigint, cost bigint, profit bigint, miss_rev bigint, miss_cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE gran
      WHEN 'day'   THEN to_char(decision_date, 'YYYY-MM-DD')
      WHEN 'month' THEN to_char(decision_date, 'YYYY-MM')
      ELSE              to_char(decision_date, 'YYYY')
    END AS period,
    COALESCE(SUM(settle_amount) FILTER (WHERE has_cost AND NOT is_adjustment), 0)::bigint,
    COALESCE(SUM(cost_amount)   FILTER (WHERE has_cost AND NOT is_adjustment), 0)::bigint,
    (COALESCE(SUM(settle_amount) FILTER (WHERE has_cost AND NOT is_adjustment), 0)
       - COALESCE(SUM(cost_amount) FILTER (WHERE has_cost AND NOT is_adjustment), 0))::bigint,
    COALESCE(SUM(settle_amount) FILTER (WHERE NOT has_cost AND NOT is_adjustment), 0)::bigint,
    COUNT(*) FILTER (WHERE NOT has_cost AND NOT is_adjustment)::bigint
  FROM public.v_order_pnl
  WHERE (date_from IS NULL OR decision_date >= date_from)
    AND (date_to   IS NULL OR decision_date <= date_to)
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

-- 6) 상품별 손익 — 조정상품 제외 ---------------------------------------------
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
  WHERE has_cost AND NOT is_adjustment
    AND (date_from IS NULL OR decision_date >= date_from)
    AND (date_to   IS NULL OR decision_date <= date_to)
  GROUP BY channel_product_no
  ORDER BY 5 DESC
  LIMIT limit_n;
$$;

-- 7) 원가 미입력 상품 목록 — 조정상품 제외(헛경고 제거) ----------------------
CREATE OR REPLACE FUNCTION public.pnl_missing_products(date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE(channel_product_no bigint, product_name text, miss_rev bigint, miss_cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    channel_product_no,
    MAX(product_name),
    COALESCE(SUM(settle_amount), 0)::bigint,
    COUNT(*)::bigint
  FROM public.v_order_pnl
  WHERE NOT has_cost AND NOT is_adjustment
    AND (date_from IS NULL OR decision_date >= date_from)
    AND (date_to   IS NULL OR decision_date <= date_to)
  GROUP BY channel_product_no
  ORDER BY 3 DESC;
$$;

-- 8) 권한 부여 ---------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.pnl_summary(date, date)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_by_period(text, date, date)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_by_product(int, date, date)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pnl_missing_products(date, date)    TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pnl_excluded_products TO anon, authenticated;

-- ============================================================================
-- [롤백] 손익 제외를 되돌리려면:
--   -- (a) 특정 상품만 다시 손익에 포함:
--   DELETE FROM public.pnl_excluded_products WHERE channel_product_no = 11614544910;
--   -- (b) 기능 전체 원복: schema_pnl_functions_v2.sql 를 다시 실행하면
--   --     pnl_summary 가 8컬럼→6컬럼으로 되돌아가고 is_adjustment 필터가 사라짐.
--   --     (단, 클라이언트가 adj_rev 를 0으로 안전 처리하므로 화면은 깨지지 않음)
-- ============================================================================
