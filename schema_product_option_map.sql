-- 상품명 → 옵션명 자동매핑 (코드형 재고 등록 시 적용)
-- 매칭 안 되면 기본값 '유효기간 최소 10일 이상 쿠폰 발송' 적용
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS public.product_option_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_match text NOT NULL UNIQUE,   -- 상품명 부분일치 키 (smartstore_products.name 기준)
  option_name   text NOT NULL,          -- 매핑될 옵션명
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.product_option_map DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_option_map TO anon, authenticated;

-- 초기 데이터
INSERT INTO public.product_option_map (product_match, option_name) VALUES
  ('밀리의 서재 전자책 12개월', '구독권 [사용하기] 시행일로부터 12개월'),
  ('밀리의 서재 전자책 6개월',  '구독권 [사용하기] 시행일로부터 6개월'),
  ('밀리의 서재 전자책 3개월',  '구독권 [사용하기] 시행일로부터 3개월'),
  ('밀리의 서재 전자책 1개월',  '구독권 [사용하기] 시행일로부터 1개월'),
  ('윌라 통합 멤버십 12개월',   '이용권 [사용하기] 시행일로부터 12개월'),
  ('윌라 통합 멤버십 6개월',    '이용권 [사용하기] 시행일로부터 6개월'),
  ('웨이브 프리미엄 Premium 12개월', '이용권 등록 후 철회 불가 동의'),
  ('웨이브 스탠다드 Standard 12개월', '이용권 등록 후 철회 불가 동의'),
  ('웨이브 베이직 Basic 12개월',     '이용권 등록 후 철회 불가 동의'),
  ('CGV 콤보',                        'CGV 직영점 사용 필수(상세페이지 확인)')
ON CONFLICT (product_match) DO NOTHING;
