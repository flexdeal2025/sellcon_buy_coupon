-- 매입처/상품명 프리셋 (기기 무관 공유) — Supabase SQL Editor에서 실행
-- 기존 localStorage 값은 웹 첫 로드 시 자동 이관됨.

CREATE TABLE IF NOT EXISTS public.presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind IN ('supplier', 'product')),
  value      text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT presets_kind_value_key UNIQUE (kind, value)
);

CREATE INDEX IF NOT EXISTS presets_kind_idx ON public.presets (kind, sort_order);

-- 내부 관리 도구 — RLS 비활성화, anon 접근 허용
ALTER TABLE public.presets DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.presets TO anon, authenticated;
