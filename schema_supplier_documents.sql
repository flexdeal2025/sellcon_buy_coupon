-- 공급처 증빙 보관함 — 대량 매입 공급처(센드비·오피스콘 등) 거래내역서/세금계산서 등
-- 미리 업로드해 두고 나중에 조회. 파일은 GCS(supplier-docs/), DB엔 메타만.
-- Supabase SQL Editor 에서 1회 실행.

CREATE TABLE IF NOT EXISTS public.supplier_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier     text NOT NULL DEFAULT '',   -- 공급처명
  doc_date     date,                        -- 매입일/거래일
  amount       bigint,                      -- 금액(선택)
  memo         text NOT NULL DEFAULT '',
  file_path    text NOT NULL,               -- GCS 경로
  file_name    text NOT NULL DEFAULT '',    -- 원본 파일명
  content_type text NOT NULL DEFAULT '',
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.supplier_documents;
CREATE POLICY "anon_all" ON public.supplier_documents FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS supdoc_supplier_idx ON public.supplier_documents (supplier);
CREATE INDEX IF NOT EXISTS supdoc_date_idx     ON public.supplier_documents (doc_date);
