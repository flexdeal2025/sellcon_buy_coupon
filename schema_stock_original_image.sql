-- 재고 이미지 편집 시 원본 보존용 컬럼.
-- 편집본으로 재고 전환해도 원본을 우리 시스템에 보존한다.
-- (image_path = 발행에 쓰는 현재 이미지(편집본), original_image_path = 최초 원본)
-- Supabase SQL Editor 에서 1회 실행.

ALTER TABLE public.stock_registrations
  ADD COLUMN IF NOT EXISTS original_image_path text NOT NULL DEFAULT '';
