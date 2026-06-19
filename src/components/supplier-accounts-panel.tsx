"use client";

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Eye, EyeOff, Plus, Trash2, ExternalLink } from "lucide-react";

interface SupplierAccount {
  id: string;
  supplier: string;
  login_url: string;
  account: string;
  password: string;
  notes: string;
}

const EMPTY: Omit<SupplierAccount, "id"> = {
  supplier: "", login_url: "", account: "", password: "", notes: "",
};

export function SupplierAccountsPanel() {
  const sb = getSupabaseClient();

  const [rows, setRows]         = useState<SupplierAccount[]>([]);
  const [loading, setLoading]   = useState(false);
  const [adding, setAdding]     = useState(false);
  const [form, setForm]         = useState({ ...EMPTY });
  const [showPwIds, setShowPwIds] = useState<Set<string>>(new Set());

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb
      .from("supplier_accounts")
      .select("*")
      .order("supplier", { ascending: true });
    if (!error) setRows((data as SupplierAccount[]) ?? []);
    setLoading(false);
  }, [sb]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const togglePw = (id: string) =>
    setShowPwIds((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  /* 인라인 필드 수정 */
  const saveField = async (
    id: string,
    field: keyof Omit<SupplierAccount, "id">,
    value: string,
  ) => {
    const { error } = await sb
      .from("supplier_accounts")
      .update({ [field]: value })
      .eq("id", id);
    if (error) { toast.error("저장 실패"); return; }
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  /* 추가 */
  const addRow = async () => {
    if (!form.supplier.trim()) { toast.error("공급처명을 입력하세요"); return; }
    const { data, error } = await sb
      .from("supplier_accounts")
      .insert({ ...form })
      .select()
      .single();
    if (error) { toast.error("추가 실패: " + error.message); return; }
    setRows((prev) => [...prev, data as SupplierAccount].sort((a, b) => a.supplier.localeCompare(b.supplier)));
    setForm({ ...EMPTY });
    setAdding(false);
    toast.success("계정 정보 추가됨");
  };

  /* 삭제 */
  const deleteRow = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    const { error } = await sb.from("supplier_accounts").delete().eq("id", id);
    if (error) { toast.error("삭제 실패"); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success("삭제됨");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          공급처별 로그인 계정 정보를 저장합니다. 앱 잠금으로 보호됩니다.
        </p>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> 계정 추가
        </button>
      </div>

      {/* 추가 폼 */}
      {adding && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
          <p className="text-xs font-medium text-primary">새 계정 정보</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <input
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="공급처명 *"
              value={form.supplier}
              onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
            />
            <input
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="로그인 URL"
              value={form.login_url}
              onChange={(e) => setForm((f) => ({ ...f, login_url: e.target.value }))}
            />
            <input
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="계정 ID / 이메일"
              value={form.account}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
            />
            <input
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="비밀번호"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            <input
              className="col-span-2 sm:col-span-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="메모 (담당자, 정산일 등)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && addRow()}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={addRow}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm text-primary-foreground"
            >
              저장
            </button>
            <button
              onClick={() => { setAdding(false); setForm({ ...EMPTY }); }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 목록 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">공급처</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">로그인 URL</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">계정 ID / 이메일</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">비밀번호</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">메모</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground text-sm">로딩 중...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground text-sm">계정 정보 없음 — 위 버튼으로 추가하세요</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/30">
                {/* 공급처 */}
                <td className="px-2 py-1.5">
                  <EditableCell value={r.supplier} onSave={(v) => saveField(r.id, "supplier", v)}
                    className="font-medium" />
                </td>
                {/* URL */}
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <EditableCell value={r.login_url} onSave={(v) => saveField(r.id, "login_url", v)}
                      placeholder="URL 없음" />
                    {r.login_url && (
                      <a href={r.login_url} target="_blank" rel="noopener noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-primary">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </td>
                {/* 계정 */}
                <td className="px-2 py-1.5">
                  <EditableCell value={r.account} onSave={(v) => saveField(r.id, "account", v)}
                    placeholder="계정 없음" />
                </td>
                {/* 비밀번호 */}
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <EditableCell
                      value={r.password}
                      onSave={(v) => saveField(r.id, "password", v)}
                      masked={!showPwIds.has(r.id)}
                      placeholder="비밀번호 없음"
                    />
                    <button
                      onClick={() => togglePw(r.id)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      {showPwIds.has(r.id)
                        ? <EyeOff className="h-3 w-3" />
                        : <Eye className="h-3 w-3" />}
                    </button>
                  </div>
                </td>
                {/* 메모 */}
                <td className="px-2 py-1.5">
                  <EditableCell value={r.notes} onSave={(v) => saveField(r.id, "notes", v)}
                    placeholder="메모 없음" />
                </td>
                {/* 삭제 */}
                <td className="px-3 py-1.5 text-right">
                  <button
                    onClick={() => deleteRow(r.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* 인라인 편집 셀 */
function EditableCell({
  value,
  onSave,
  masked = false,
  placeholder = "",
  className = "",
}: {
  value: string;
  onSave: (v: string) => void;
  masked?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (!editing) {
    return (
      <span
        className={cn(
          "block cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-secondary",
          !value && "text-muted-foreground/50",
          className,
        )}
        onClick={() => setEditing(true)}
      >
        {value
          ? masked ? "•".repeat(Math.min(value.length, 10)) : value
          : placeholder}
      </span>
    );
  }

  return (
    <input
      autoFocus
      className="w-full min-w-24 rounded border border-primary bg-background px-1 py-0.5 text-xs outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
    />
  );
}
