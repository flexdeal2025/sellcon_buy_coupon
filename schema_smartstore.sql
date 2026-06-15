-- 스마트스토어 연동 스키마 (schema.sql 실행 후 추가 실행)

-- 상품 재고 캐시
CREATE TABLE IF NOT EXISTS public.smartstore_products (
  channel_product_no bigint PRIMARY KEY,
  origin_product_no  bigint,
  name               text    NOT NULL,
  sale_price         integer DEFAULT 0,
  stock_quantity     integer DEFAULT 0,
  status             text    DEFAULT 'SALE',
  low_stock_threshold integer DEFAULT 10,
  synced_at          timestamptz DEFAULT now()
);
ALTER TABLE public.smartstore_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.smartstore_products FOR ALL USING (true) WITH CHECK (true);

-- 일별 판매 집계
CREATE TABLE IF NOT EXISTS public.smartstore_daily_sales (
  sale_date          date   NOT NULL,
  channel_product_no bigint NOT NULL,
  product_name       text,
  total_quantity     integer DEFAULT 0,
  total_revenue      integer DEFAULT 0,
  synced_at          timestamptz DEFAULT now(),
  PRIMARY KEY (sale_date, channel_product_no)
);
ALTER TABLE public.smartstore_daily_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.smartstore_daily_sales FOR ALL USING (true) WITH CHECK (true);

-- AI 분석 리포트 보관
CREATE TABLE IF NOT EXISTS public.ai_analysis_reports (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date date DEFAULT CURRENT_DATE,
  report_text text NOT NULL,
  model       text DEFAULT 'claude-sonnet-4-6',
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.ai_analysis_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.ai_analysis_reports FOR ALL USING (true) WITH CHECK (true);
