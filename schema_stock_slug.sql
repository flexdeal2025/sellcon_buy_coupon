-- 재고등록: 영문 상품 슬러그 컬럼 추가 (이미지형 발행 파일명 규칙에 사용)
-- schema_stock_registration.sql 실행 후 추가 실행.
ALTER TABLE public.stock_registrations
  ADD COLUMN IF NOT EXISTS product_slug text NOT NULL DEFAULT '';
