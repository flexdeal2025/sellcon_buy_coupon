-- 손익 분석용 스키마 (schema_smartstore.sql 실행 후 추가 실행)

-- 건별 정산 내역 (주문 상세의 expectedSettlementAmount 기반)
-- 매출(실수령) = settle_amount, 귀속 기준일 = decision_date(구매확정일)
CREATE TABLE IF NOT EXISTS public.smartstore_settlements (
  product_order_id   text PRIMARY KEY,     -- 상품주문번호
  channel_product_no bigint,               -- = productId (smartstore_products 조인키)
  product_name       text,
  quantity           integer DEFAULT 0,
  payment_amount     integer DEFAULT 0,    -- 고객 결제액(총, 참고용)
  settle_amount      integer,             -- 정산금액(수수료 차감 실수령) = 매출
  commission         integer DEFAULT 0,    -- 수수료 합계(결제+연동+판매+채널, 참고용)
  order_status       text,                 -- PURCHASE_DECIDED 등
  decision_date      date,                 -- 구매확정일(정산 기준일) = 귀속일
  payment_date       date,                 -- 결제일(참고)
  synced_at          timestamptz DEFAULT now()
);
ALTER TABLE public.smartstore_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.smartstore_settlements;
CREATE POLICY "anon_all" ON public.smartstore_settlements FOR ALL USING (true) WITH CHECK (true);
-- 집계 조회 가속
CREATE INDEX IF NOT EXISTS idx_settle_decision_date ON public.smartstore_settlements (decision_date);
CREATE INDEX IF NOT EXISTS idx_settle_channel ON public.smartstore_settlements (channel_product_no);

-- 상품별 기간 매입원가 (수동 입력)
CREATE TABLE IF NOT EXISTS public.product_cost (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_product_no bigint NOT NULL,
  unit_cost          integer NOT NULL,     -- 1개당 매입원가
  effective_from     date NOT NULL,        -- 적용 시작일
  effective_to       date,                 -- 적용 종료일 (NULL = 현재 진행 중)
  note               text,
  created_at         timestamptz DEFAULT now()
);
ALTER TABLE public.product_cost ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.product_cost;
CREATE POLICY "anon_all" ON public.product_cost FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_cost_channel ON public.product_cost (channel_product_no);

-- (선택) 회사 전체 일별 정산 — 정산완료일 기준 총액 대조용
CREATE TABLE IF NOT EXISTS public.smartstore_daily_settlement (
  settle_complete_date date PRIMARY KEY,   -- 정산완료일
  settle_amount        bigint DEFAULT 0,   -- 실정산액(net)
  pay_settle_amount    bigint DEFAULT 0,   -- 결제정산액(gross)
  commission_amount    bigint DEFAULT 0,   -- 수수료(음수)
  synced_at            timestamptz DEFAULT now()
);
ALTER TABLE public.smartstore_daily_settlement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.smartstore_daily_settlement;
CREATE POLICY "anon_all" ON public.smartstore_daily_settlement FOR ALL USING (true) WITH CHECK (true);
