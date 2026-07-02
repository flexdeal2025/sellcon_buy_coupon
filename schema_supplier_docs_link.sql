-- 공급처 증빙을 매입 건(purchase_records)에 연결.
-- 증빙은 매입 건 상세에서 업로드하고, 보관함은 공급처별 모아보기·일괄다운로드.
-- Supabase SQL Editor 에서 1회 실행. (schema_supplier_documents.sql 이후)

ALTER TABLE public.supplier_documents
  ADD COLUMN IF NOT EXISTS purchase_record_id uuid;

CREATE INDEX IF NOT EXISTS supdoc_record_idx ON public.supplier_documents (purchase_record_id);
