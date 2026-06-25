"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn, toKST } from "@/lib/utils";
import { toast } from "sonner";
import { RefreshCw, Search, Pencil, X, Save, Trash2 } from "lucide-react";

interface Coupon {
  id: string;
  상품명: string | null;
  옵션명: string | null;
  coupon_code: string | null;
  expiry_date: string | null;
  expiry_yymmdd: string | null;
  status: string | null;
  매입원가: number | null;
  이슈사항: string | null;
  batch_id: string | null;
  allocated_to: string | null;
  allocated_at: string | null;
  created_at: string | null;
}

const STATUSES = ["available", "allocated", "disabled", "exchanged"];
// 실제 DB 저장값(영문) 그대로 표시 — 임의 변환 금지 (B서버 공유 테이블)
const STATUS_COLOR: Record<string, string> = {
  available: "text-green-600", allocated: "text-muted-foreground",
  disabled: "text-red-500", exchanged: "text-amber-600",
};
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];
const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";

type ColKey =
  | "상품명" | "옵션명" | "coupon_code" | "expiry_date" | "status" | "매입원가" | "이슈사항"
  | "batch_id" | "allocated_to" | "allocated_at" | "created_at";
type ColType = "text" | "code" | "date" | "status" | "number" | "datetime";

interface ColDef {
  key: ColKey; label: string; w: number;
  type: ColType; editable: boolean;
  align?: "right" | "center"; muted?: boolean; sortable?: boolean;
}

const COLS: ColDef[] = [
  { key: "상품명",      label: "상품명",   w: 200, type: "text",     editable: true },
  { key: "옵션명",      label: "옵션명",   w: 140, type: "text",     editable: true, muted: true },
  { key: "coupon_code", label: "쿠폰번호", w: 180, type: "code",     editable: true },
  { key: "expiry_date", label: "유효기간", w: 140, type: "date",     editable: true, sortable: true },
  { key: "status",      label: "상태",     w: 120, type: "status",   editable: true, align: "center" },
  { key: "매입원가",    label: "매입원가", w: 100, type: "number",   editable: true, align: "right" },
  { key: "이슈사항",    label: "이슈사항", w: 220, type: "text",     editable: true, muted: true },
  { key: "batch_id",    label: "배치ID",   w: 150, type: "text",     editable: false, muted: true },
  { key: "allocated_to",label: "배정대상", w: 140, type: "text",     editable: false, muted: true },
  { key: "allocated_at",label: "배정시간", w: 150, type: "datetime", editable: false, muted: true, sortable: true },
  { key: "created_at",  label: "등록시간", w: 150, type: "datetime", editable: false, muted: true, sortable: true },
];
type SortKey = "created_at" | "expiry_date" | "allocated_at";
// 일괄수정 대상: 수정 가능 + 쿠폰번호(고유값) 제외
const BULK_FIELDS = COLS.filter((c) => c.editable && c.key !== "coupon_code");

// 등록시간·배정시간은 KST(UTC+9) 고정 표시 — 브라우저 타임존 무관
function fmtDateTime(v: string | null): string {
  return v ? (toKST(v) || v) : "—";
}

export function VivaconInventoryPanel() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [codeQ, setCodeQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sortKey, setSortKey] = useState<SortKey>("created_at"); // 기본: 등록시간
  const [sortAsc, setSortAsc] = useState(false);                 // 기본: 최신순(내림차순)

  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Coupon>>({});
  const [saving, setSaving] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<ColKey>("status");
  const [bulkValue, setBulkValue] = useState("available");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [colW, setColW] = useState<Record<ColKey, number>>(
    () => Object.fromEntries(COLS.map((c) => [c.key, c.w])) as Record<ColKey, number>,
  );
  const resizing = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);
  const startResize = (key: ColKey, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startW: colW[key] };
    const onMove = (ev: MouseEvent) => {
      const r = resizing.current; if (!r) return;
      setColW((w) => ({ ...w, [r.key]: Math.max(60, r.startW + (ev.clientX - r.startX)) }));
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({
        q, code: codeQ, status, page: String(page), pageSize: String(pageSize),
        sort: sortKey, dir: sortAsc ? "asc" : "desc",
      });
      const res = await fetch(`/api/vivacon/inventory?${params}`);
      const json = await res.json();
      if (!json.ok) { toast.error("조회 실패: " + json.error); return; }
      setRows(json.rows); setTotal(json.total); setSummary(json.summary ?? {});
    } catch {
      toast.error("조회 중 오류");
    } finally {
      setLoading(false);
    }
  }, [q, codeQ, status, page, pageSize, sortKey, sortAsc]);

  useEffect(() => { setPage(0); }, [q, codeQ, status, pageSize, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(false); } // 새 컬럼은 내림차순부터
  };
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const startEdit = (r: Coupon) => {
    setEditId(r.id);
    setDraft({
      상품명: r.상품명 ?? "", 옵션명: r.옵션명 ?? "", coupon_code: r.coupon_code ?? "",
      expiry_date: r.expiry_date ?? "", status: r.status ?? "available",
      매입원가: r.매입원가 ?? null, 이슈사항: r.이슈사항 ?? "",
    });
  };
  const cancelEdit = () => { setEditId(null); setDraft({}); };

  const deleteRow = async (r: Coupon) => {
    if (r.status !== "available") {
      toast.error(`삭제 불가 — 상태: ${r.status} (available 건만 삭제 가능)`); return;
    }
    if (!confirm(`[${r.상품명 ?? ""}] 쿠폰을 삭제합니다.\n발송기(B서버) 재고에서 즉시 제거됩니다. 계속할까요?`)) return;
    try {
      const res = await fetch(`/api/vivacon/coupon?id=${r.id}`, {
        method: "DELETE", headers: { "x-app-passcode": PASSCODE },
      });
      const json = await res.json();
      if (!json.ok) { toast.error("삭제 실패: " + json.error); return; }
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      setTotal((t) => t - 1);
      toast.success("삭제 완료");
    } catch {
      toast.error("삭제 중 오류");
    }
  };

  const saveEdit = async (id: string) => {
    if (!confirm("이 쿠폰 정보를 수정합니다.\n발송기(B서버)가 읽는 실제 재고이니 값을 확인하세요. 계속할까요?")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/vivacon/coupon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-app-passcode": PASSCODE },
        body: JSON.stringify({ id, patch: draft }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error("수정 실패: " + json.error); return; }
      setRows((prev) => prev.map((r) => (r.id === id ? json.row : r)));
      toast.success("수정 완료"); cancelEdit(); fetchRows();
    } catch {
      toast.error("수정 중 오류");
    } finally {
      setSaving(false);
    }
  };

  const onBulkFieldChange = (k: ColKey) => {
    setBulkField(k);
    setBulkValue(k === "status" ? "available" : "");
  };
  const applyBulk = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const fld = COLS.find((c) => c.key === bulkField)!;
    if (fld.type !== "text" && fld.type !== "number" && bulkValue.trim() === "") {
      toast.error("적용할 값을 입력하세요"); return;
    }
    if (!confirm(`선택한 ${ids.length}건의 [${fld.label}]을(를) "${bulkValue || "(빈값)"}"(으)로 일괄 변경합니다.\n발송기가 읽는 실제 재고입니다. 계속할까요?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/vivacon/coupon/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-passcode": PASSCODE },
        body: JSON.stringify({ ids, patch: { [bulkField]: bulkValue } }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error("일괄 수정 실패: " + json.error); return; }
      toast.success(`${json.count}건 일괄 수정 완료`); fetchRows();
    } catch {
      toast.error("일괄 수정 중 오류");
    } finally {
      setBulkBusy(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => allSel ? setSelected(new Set()) : setSelected(new Set(rows.map((r) => r.id)));
  const tableWidth = 44 + COLS.reduce((s, c) => s + colW[c.key], 0) + 80;

  // 읽기 셀 렌더
  const renderCell = (col: ColDef, r: Coupon) => {
    const v = r[col.key];
    if (col.type === "status") {
      return <span className={cn("font-medium", STATUS_COLOR[r.status ?? ""])}>{r.status}</span>;
    }
    if (col.type === "number") return v != null ? Number(v).toLocaleString() : "—";
    if (col.type === "datetime") return fmtDateTime(v as string | null);
    if (col.type === "code") return <span className="font-mono">{v}</span>;
    return v ?? "";
  };

  // 수정 셀 렌더 (editable=false 는 읽기 표시)
  const renderEditCell = (col: ColDef, r: Coupon) => {
    if (!col.editable) {
      return <span className="text-muted-foreground">{col.type === "datetime" ? fmtDateTime(r[col.key] as string | null) : (r[col.key] ?? "")}</span>;
    }
    const dv = draft[col.key];
    if (col.type === "status") {
      return (
        <select className="w-full rounded-md border border-border bg-background px-1 py-1 text-xs"
          value={(dv as string) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      );
    }
    if (col.type === "date") {
      return (
        <input type="date" className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
          value={(dv as string) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, expiry_date: e.target.value }))} />
      );
    }
    if (col.type === "number") {
      return (
        <input inputMode="numeric" className="w-full rounded-md border border-border bg-background px-2 py-1 text-right text-xs tabular-nums"
          value={(dv as number | null) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, 매입원가: e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9-]/g, "")) }))} />
      );
    }
    // text / code
    return (
      <input className={cn("w-full rounded-md border border-border bg-background px-2 py-1 text-xs", col.type === "code" && "font-mono")}
        value={(dv as string) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [col.key]: e.target.value }))} />
    );
  };

  return (
    <div className="space-y-3">
      {/* 요약 */}
      <div className="flex flex-wrap gap-4 text-sm">
        {STATUSES.map((s) => (
          <span key={s} className={STATUS_COLOR[s]}>{s} <strong>{(summary[s] ?? 0).toLocaleString()}</strong></span>
        ))}
        <span className="text-muted-foreground text-xs self-center">(검색어 반영)</span>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-secondary/40 p-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input className="bg-transparent py-1.5 text-sm outline-none" placeholder="상품명 검색..."
            value={qInput} onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setQ(qInput.trim()); setCodeQ(codeInput.trim()); } }} />
        </div>
        <input className="w-44 rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-mono" placeholder="쿠폰번호 검색..."
          value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setQ(qInput.trim()); setCodeQ(codeInput.trim()); } }} />
        <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">전체 상태</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => { setQ(qInput.trim()); setCodeQ(codeInput.trim()); }}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-secondary">검색</button>
        <button onClick={fetchRows}
          className="ml-auto rounded-lg border border-border bg-background px-2 py-1.5 text-sm hover:bg-secondary">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* 일괄수정 바 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
          <span className="text-sm font-medium">{selected.size}건 선택 →</span>
          <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            value={bulkField} onChange={(e) => onBulkFieldChange(e.target.value as ColKey)}>
            {BULK_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          {bulkField === "status" ? (
            <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : bulkField === "expiry_date" ? (
            <input type="date" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
          ) : bulkField === "매입원가" ? (
            <input inputMode="numeric" placeholder="금액" className="w-28 rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
              value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
          ) : (
            <input placeholder="변경할 값" className="w-48 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
          )}
          <span className="text-sm text-muted-foreground">(으)로</span>
          <button onClick={applyBulk} disabled={bulkBusy}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {bulkBusy ? "적용 중..." : "일괄 적용"}
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-sm text-muted-foreground hover:text-foreground">선택 해제</button>
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="text-sm" style={{ tableLayout: "fixed", width: tableWidth }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {COLS.map((c) => <col key={c.key} style={{ width: colW[c.key] }} />)}
            <col style={{ width: 80 }} />
          </colgroup>
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-3 py-2 text-left"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
              {COLS.map((c) => (
                <th key={c.key} className={cn("relative select-none px-3 py-2 text-xs whitespace-nowrap",
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left")}>
                  {c.sortable ? (
                    <button onClick={() => toggleSort(c.key as SortKey)}
                      className={cn("inline-flex items-center gap-1 hover:text-primary",
                        sortKey === c.key && "font-bold text-primary")}>
                      {c.label}
                      <span className="text-[10px]">{sortKey === c.key ? (sortAsc ? "▲" : "▼") : "↕"}</span>
                    </button>
                  ) : c.label}
                  <span onMouseDown={(e) => startResize(c.key, e)}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40" />
                </th>
              ))}
              <th className="px-3 py-2 text-center text-xs">수정/삭제</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={COLS.length + 2} className="py-8 text-center text-muted-foreground text-sm">로딩 중...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={COLS.length + 2} className="py-8 text-center text-muted-foreground text-sm">결과 없음</td></tr>}
            {rows.map((r) => editId === r.id ? (
              <tr key={r.id} className="border-b border-border/50 bg-primary/5">
                <td className="px-3 py-1.5" />
                {COLS.map((c) => (
                  <td key={c.key} className={cn("px-2 py-1.5 text-xs", c.align === "right" && "text-right")}>
                    {renderEditCell(c, r)}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center whitespace-nowrap">
                  <button onClick={() => saveEdit(r.id)} disabled={saving}
                    className="mb-1 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">
                    <Save className="h-3 w-3" /> 저장
                  </button>
                  <button onClick={cancelEdit} className="inline-flex items-center rounded-md border border-border px-1.5 py-1 text-xs">
                    <X className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={r.id} className={cn("border-b border-border/50", selected.has(r.id) ? "bg-primary/5" : "hover:bg-secondary/30")}>
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={selected.has(r.id)}
                    onChange={(e) => setSelected((prev) => { const s = new Set(prev); e.target.checked ? s.add(r.id) : s.delete(r.id); return s; })} />
                </td>
                {COLS.map((c) => {
                  const content = renderCell(c, r);
                  return (
                    <td key={c.key} className={cn("px-3 py-1.5 text-xs truncate",
                      c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "",
                      c.muted && "text-muted-foreground")}
                      title={typeof content === "string" ? content : undefined}>
                      {content}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-center whitespace-nowrap">
                  <button onClick={() => startEdit(r)} className="text-muted-foreground hover:text-primary mr-2" title="수정">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteRow(r)} className={cn("hover:text-destructive", r.status === "available" ? "text-muted-foreground" : "text-muted-foreground/30 cursor-not-allowed")} title={r.status === "available" ? "삭제" : `삭제 불가(${r.status})`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, total).toLocaleString()} / {total.toLocaleString()}건</span>
            <select className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
              value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}건씩</option>)}
            </select>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40">이전</button>
              <span className="px-2">{page + 1} / {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40">다음</button>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        ⚠️ 외주 비바콘 Supabase의 실제 발송 대상 재고입니다. 수정 시 발송기(B서버)에 즉시 반영됩니다. · 회색 컬럼(배치ID·배정대상·배정시간·등록시간)은 시스템 자동 기록값으로 수정 불가 · 헤더 우측 경계를 드래그하면 칸 너비 조절.
      </p>
    </div>
  );
}
