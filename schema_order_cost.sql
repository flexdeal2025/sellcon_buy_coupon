-- 주문 건별 매입원가 (schema_settlements.sql 실행 후 추가 실행)
-- '별도 결제 상품'처럼 주문마다 매입 구성이 달라 기간단가로 못 매기는 경우 사용.
-- 손익 원가 우선순위: ① order_cost(건별 총액) → ② product_cost(기간단가)×수량 → ③ 미입력

CREATE TABLE IF NOT EXISTS public.order_cost (
  product_order_id text PRIMARY KEY,   -- 상품주문번호 (smartstore_settlements와 1:1)
  cost_amount      integer NOT NULL,    -- 그 주문의 총 매입원가
  note             text,                -- 고객 협의 내용 등 메모
  created_at       timestamptz DEFAULT now()
);
ALTER TABLE public.order_cost ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.order_cost;
CREATE POLICY "anon_all" ON public.order_cost FOR ALL USING (true) WITH CHECK (true);
