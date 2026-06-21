-- 매입처 마스터 + 상품명 영문사전 + 재고등록 매입처 컬럼
-- Supabase SQL Editor 에서 실행 (schema_stock_registration.sql 이후)

-- 1) 매입처 마스터 (영문매입처명은 사용자가 직접 관리)
CREATE TABLE IF NOT EXISTS public.purchase_vendors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text UNIQUE NOT NULL,          -- 한글 매입처 (예: 당근마켓)
  name_en    text NOT NULL DEFAULT '',      -- 영문 매입처 (예: daangn) — 직접 입력
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.purchase_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.purchase_vendors;
CREATE POLICY "anon_all" ON public.purchase_vendors FOR ALL USING (true) WITH CHECK (true);

-- 2) 비바콘 상품명 → 영문 슬러그 사전 (미리 AI로 생성해 저장)
CREATE TABLE IF NOT EXISTS public.vivacon_product_slugs (
  product_name text PRIMARY KEY,            -- [비바콘] 제거된 상품명
  slug         text NOT NULL DEFAULT '',    -- 영문 슬러그 (cgv_2d 등)
  updated_at   timestamptz DEFAULT now()
);
ALTER TABLE public.vivacon_product_slugs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.vivacon_product_slugs;
CREATE POLICY "anon_all" ON public.vivacon_product_slugs FOR ALL USING (true) WITH CHECK (true);

-- 3) 재고등록에 매입처(한글) 추가
ALTER TABLE public.stock_registrations
  ADD COLUMN IF NOT EXISTS supplier text NOT NULL DEFAULT '';
