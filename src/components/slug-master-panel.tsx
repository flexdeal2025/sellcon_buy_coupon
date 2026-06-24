"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Sparkles, Save, Loader2, RefreshCw, Search } from "lucide-react";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };
const CHUNK = 25; // 일괄 생성 1회 요청당 상품 수(타임아웃 여유)

interface Row { product_name: string; slug: string }

export function SlugMasterPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/slugs");
    const json = await res.json();
    if (json.ok) setRows(json.rows);
    else toast.error("조회 실패: " + json.error);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setSlug = (name: string, slug: string) =>
    setRows((prev) => prev.map((r) => (r.product_name === name ? { ...r, slug } : r)));

  const saveOne = async (r: Row) => {
    const res = await fetch("/api/slugs", {
      method: "PATCH", headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ product_name: r.product_name, slug: r.slug }),
    });
    const json = await res.json();
    if (!json.ok) { toast.error("저장 실패: " + json.error); return; }
    setSlug(r.product_name, json.slug);
    toast.success("저장됨");
  };

  // AI 생성(상품명 배열) — CHUNK 단위 분할, 진행률 표시
  const generate = async (names: string[]) => {
    if (names.length === 0) { toast.error("생성할 상품명이 없습니다"); return; }
    setBusy(true);
    setProgress({ done: 0, total: names.length });
    try {
      let done = 0;
      for (let i = 0; i < names.length; i += CHUNK) {
        const chunk = names.slice(i, i + CHUNK);
        const res = await fetch("/api/slugs", {
          method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
          body: JSON.stringify({ names: chunk }),
        });
        const json = await res.json();
        if (!json.ok) { toast.error("생성 실패: " + json.error); break; }
        for (const g of json.generated ?? []) setSlug(g.product_name, g.slug);
        if (json.errors?.length) console.warn("슬러그 생성 일부 실패:", json.errors);
        done += chunk.length;
        setProgress({ done, total: names.length });
      }
      toast.success(`${done}건 영문명 생성 완료`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const filtered = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!missingOnly || !r.slug) &&
      (!nq || r.product_name.toLowerCase().includes(nq) || r.slug.includes(nq)),
    );
  }, [rows, q, missingOnly]);

  const missingCount = rows.filter((r) => !r.slug).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        상품명별 <strong>영문명(축약어)</strong> 마스터입니다. 검수 화면에서 상품명을 선택하면 여기 영문명이 자동 입력됩니다.
        AI가 <code className="text-xs">브랜드_금액_유형</code>(예: <code className="text-xs">megacoffee_1man_bal</code>)으로 생성하며, 직접 수정할 수 있습니다.
      </p>

      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/40 p-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input className="bg-transparent px-1 py-1.5 text-sm outline-none" placeholder="상품명·영문명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex cursor-pointer items-center gap-1 text-sm text-muted-foreground">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> 미입력만
        </label>
        <span className="text-sm">전체 <strong>{rows.length}</strong> · 미입력 <strong className={missingCount ? "text-amber-600" : "text-green-600"}>{missingCount}</strong></span>
        <button onClick={load} disabled={busy} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /></button>
        <button
          onClick={() => generate(rows.filter((r) => !r.slug).map((r) => r.product_name))}
          disabled={busy || missingCount === 0}
          className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {progress ? `생성 중 ${progress.done}/${progress.total}` : `미입력 ${missingCount}건 일괄 생성`}
        </button>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/60">
              <tr>
                <th className="px-3 py-2 text-left">상품명</th>
                <th className="px-3 py-2 text-left">영문명(축약어)</th>
                <th className="px-3 py-2 text-right w-28">작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.product_name} className={cn("border-b border-border/50", !r.slug && "bg-amber-50/40 dark:bg-amber-950/10")}>
                  <td className="px-3 py-1.5">{r.product_name}</td>
                  <td className="px-3 py-1.5">
                    <input
                      className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                      placeholder="(미입력)"
                      value={r.slug}
                      onChange={(e) => setSlug(r.product_name, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveOne(r); }}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => generate([r.product_name])} disabled={busy} title="AI 생성" className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-50"><Sparkles className="h-3.5 w-3.5" /></button>
                      <button onClick={() => saveOne(r)} disabled={busy} title="저장" className="rounded-md border border-border px-2 py-1 hover:bg-secondary disabled:opacity-50"><Save className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">표시할 상품명이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
