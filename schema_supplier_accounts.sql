-- 공급처 계정 정보 관리
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS public.supplier_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier   text NOT NULL,           -- 공급처명 (예: 센드비, 쿠칩)
  login_url  text NOT NULL DEFAULT '', -- 로그인 URL
  account    text NOT NULL DEFAULT '', -- 계정 ID / 이메일
  password   text NOT NULL DEFAULT '', -- 비밀번호
  notes      text NOT NULL DEFAULT '', -- 메모 (예: 담당자, 정산일)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.supplier_accounts DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_accounts TO anon, authenticated;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END$$;

DROP TRIGGER IF EXISTS supplier_accounts_updated_at ON public.supplier_accounts;
CREATE TRIGGER supplier_accounts_updated_at
  BEFORE UPDATE ON public.supplier_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
