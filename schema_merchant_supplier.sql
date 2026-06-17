-- 가맹점 → 공급처 매핑 마스터
-- 카드 가맹점명(부분일치)을 기프티콘 매입 공급처로 연결. 매입 자동등록·대조에 사용.
-- 예: 가맹점명에 '윈큐브마케팅' 포함 → 공급처 '센드비'
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS public.merchant_supplier_map (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_merchant text NOT NULL,            -- 가맹점명 부분일치 키
  supplier       text NOT NULL,            -- 매핑될 공급처명
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT merchant_supplier_map_key UNIQUE (match_merchant, supplier)
);

CREATE INDEX IF NOT EXISTS msm_merchant_idx ON public.merchant_supplier_map (match_merchant);

ALTER TABLE public.merchant_supplier_map DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchant_supplier_map TO anon, authenticated;
