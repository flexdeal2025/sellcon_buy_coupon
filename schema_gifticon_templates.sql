-- 기프티콘 변환: 상품별 템플릿 저장·재활용
-- 템플릿 프레임 이미지 + 상품 이미지 + 좌표(coords)를 저장해두고, 동일 상품 재매입 시 불러와 재사용.
-- 이미지는 GCP OCR버킷 gifticon_templates/ 경로에 저장, 경로만 DB에 보관.
CREATE TABLE IF NOT EXISTS public.gifticon_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                      -- 템플릿 이름(예: 세븐일레븐 3만원권)
  template_path text NOT NULL DEFAULT '',           -- GCP 프레임 이미지 경로
  product_path  text NOT NULL DEFAULT '',           -- GCP 상품 이미지 경로(선택)
  coords        jsonb NOT NULL DEFAULT '{}'::jsonb, -- 좌표/폰트 설정
  name_autofit  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gifticon_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.gifticon_templates;
CREATE POLICY "anon_all" ON public.gifticon_templates FOR ALL USING (true) WITH CHECK (true);
