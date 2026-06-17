"use client";

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Download, RefreshCw, ChevronLeft, ChevronRight, X } from "lucide-react";

interface CardTransaction {
  id: string;
  card_company: string;
  transaction_date: string;
  card_number: string | null;
  merchant_name: string;
  amount: number;
  product_name: string;
  cost_category: string;
}

const PAGE_SIZE = 50;

export function CardTaxPanel() {
  const sb = getSupabaseClient();

  /* ── 필터 ─────────────────────────────── */
  const [company, setCompany]           = useState("");
  const [dateFrom, setDateFrom]         = useState("");
  const [dateTo, setDateTo]             = useState("");
  const [catFilter, setCatFilter]       = useState("");
  const [incompleteOnly, setIncomplete] = useState(false);

  /* ── 데이터 ────────────────────────────── */
  const [rows, setRows]           = useState<CardTransaction[]>([]);
  const [totalCount, setTotal]    = useState(0);
  const [page, setPage]           = useState(0);
  const [loading, setLoading]     = useState(false);

  /* ── 통계 ──────────────────────────────── */
  const [stats, setStats] = useState({ total: 0, done: 0, todo: 0 });

  /* ── 비용구분 옵션 ─────────────────────── */
  const [options, setOptions] = useState<string[]>(["연인터내셔널", "비에스유통", "내역 삭제"]);
  const [newOpt, setNewOpt]   = useState("");

  /* ── 카드사 목록 (DB distinct) ─────────── */
  const [companyList, setCompanyList] = useState<string[]>([]);

  /* ── 선택 / 일괄편집 ───────────────────── */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkVal, setBulkVal]   = useState("");

  /* ────────────────────────────────────────
     쿼리 빌더 (필터 적용)
  ──────────────────────────────────────── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = useCallback((q: any) => {
    if (company)        q = q.eq("card_company", company);
    if (dateFrom)       q = q.gte("transaction_date", dateFrom);
    if (dateTo)         q = q.lte("transaction_date", dateTo);
    if (catFilter)      q = q.eq("cost_category", catFilter);
    if (incompleteOnly) q = q.eq("cost_category", "");
    return q;
  }, [company, dateFrom, dateTo, catFilter, incompleteOnly]);

  /* ── 통계 fetch ────────────────────────── */
  const fetchStats = useCallback(async () => {
    const [{ count: total }, { count: done }] = await Promise.all([
      sb.from("card_transactions_tax").select("*", { count: "exact", head: true }),
      sb.from("card_transactions_tax").select("*", { count: "exact", head: true }).neq("cost_category", ""),
    ]);
    setStats({ total: total ?? 0, done: done ?? 0, todo: (total ?? 0) - (done ?? 0) });
  }, [sb]);

  /* ── 옵션 fetch ────────────────────────── */
  const fetchOptions = useCallback(async () => {
    const { data } = await sb.from("cost_category_options").select("label").order("sort_order");
    if (data?.length) setOptions(data.map((r) => r.label));
  }, [sb]);

  /* ── 카드사 목록 fetch ─────────────────── */
  const fetchCompanies = useCallback(async () => {
    const { data } = await sb.rpc("distinct_card_companies");
    if (data?.length) setCompanyList((data as { card_company: string }[]).map((r) => r.card_company));
  }, [sb]);

  /* ── 행 fetch ──────────────────────────── */
  const fetchRows = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      let q = sb
        .from("card_transactions_tax")
        .select("*", { count: "exact" })
        .order("transaction_date", { ascending: true })
        .order("card_company",     { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      q = applyFilters(q);
      const { data, count, error } = await q;
      if (error) throw error;
      setRows(data ?? []);
      setTotal(count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [sb, page, applyFilters]);

  useEffect(() => { fetchOptions(); }, [fetchOptions]);
  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  // 필터 변경 시 page 초기화
  useEffect(() => { setPage(0); }, [company, dateFrom, dateTo, catFilter, incompleteOnly]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  /* ── 단일 필드 저장 ─────────────────────── */
  const saveField = async (
    id: string,
    field: "product_name" | "cost_category",
    value: string,
  ): Promise<boolean> => {
    const { error } = await sb.from("card_transactions_tax").update({ [field]: value }).eq("id", id);
    if (error) { toast.error("저장 실패: " + error.message); return false; }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    fetchStats();
    return true;
  };

  /* ── 일괄 품명 저장 ─────────────────────── */
  const applyBulk = async () => {
    const val = bulkVal.trim();
    if (!val) return;
    const ids = [...selected];
    const { error } = await sb.from("card_transactions_tax").update({ product_name: val }).in("id", ids);
    if (error) { toast.error("일괄 저장 실패"); return; }
    setRows((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, product_name: val } : r)));
    setSelected(new Set());
    setBulkMode(false);
    setBulkVal("");
    toast.success(`${ids.length}건 품명 저장 완료`);
    fetchStats();
  };

  /* ── 엑셀 내보내기 ──────────────────────── */
  const handleExport = async () => {
    toast.info("데이터 가져오는 중...");
    let q = sb
      .from("card_transactions_tax")
      .select("transaction_date,card_company,card_number,merchant_name,amount,product_name,cost_category")
      .order("transaction_date", { ascending: true })
      .order("card_company",     { ascending: true });
    q = applyFilters(q);
    const { data, error } = await q;
    if (error || !data) { toast.error("데이터 조회 실패"); return; }

    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(
      data.map((r) => ({
        날짜:   r.transaction_date,
        카드사: r.card_company,
        카드번호: r.card_number ?? "",
        가맹점명: r.merchant_name,
        금액:   r.amount,
        품명:   r.product_name,
        비용구분: r.cost_category,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "카드내역");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `카드장부_${today}.xlsx`);
    toast.success(`${data.length.toLocaleString()}건 내보내기 완료`);
  };

  /* ── 옵션 추가 ──────────────────────────── */
  const addOption = async () => {
    const label = newOpt.trim();
    if (!label) return;
    const { error } = await sb
      .from("cost_category_options")
      .insert({ label, sort_order: options.length + 1 });
    if (error && !error.message.includes("unique")) { toast.error("옵션 추가 실패"); return; }
    if (!options.includes(label)) setOptions((prev) => [...prev, label]);
    setNewOpt("");
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const allPageSel = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll  = () =>
    allPageSel ? setSelected(new Set()) : setSelected(new Set(rows.map((r) => r.id)));

  /* ── 렌더 ──────────────────────────────── */
  return (
    <div className="space-y-3">
      {/* 통계 */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span>전체 <strong>{stats.total.toLocaleString()}건</strong></span>
        <span className="text-green-600">완료 <strong>{stats.done.toLocaleString()}건</strong></span>
        <span className="text-amber-600">미완료 <strong>{stats.todo.toLocaleString()}건</strong></span>
        <span className="text-muted-foreground text-xs self-center">
          (비용구분 입력 기준)
        </span>
      </div>

      {/* 필터 바 */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-secondary/40 p-3">
        <select
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        >
          <option value="">전체 카드사</option>
          {companyList.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <input
          type="date"
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <span className="self-center text-muted-foreground text-xs">~</span>
        <input
          type="date"
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />

        <select
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="">전체 비용구분</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={(e) => setIncomplete(e.target.checked)}
          />
          비용구분 미입력만
        </label>

        <div className="ml-auto flex gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" />
            엑셀 내보내기
          </button>
          <button
            onClick={fetchRows}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm hover:bg-secondary"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* 일괄편집 바 */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">{selected.size}건 선택</span>
          {!bulkMode ? (
            <button
              onClick={() => setBulkMode(true)}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              품명 일괄 입력
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                className="w-48 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                placeholder="품명 입력..."
                value={bulkVal}
                onChange={(e) => setBulkVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyBulk()}
              />
              <button
                onClick={applyBulk}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                적용
              </button>
              <button
                onClick={() => { setBulkMode(false); setBulkVal(""); }}
                className="rounded-lg border border-border px-2 py-1.5 text-sm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-sm text-muted-foreground hover:text-foreground"
          >
            선택 해제
          </button>
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-3 py-2 text-left">
                <input type="checkbox" checked={allPageSel} onChange={toggleAll} />
              </th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">날짜</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">카드사</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">가맹점명</th>
              <th className="px-3 py-2 text-right text-xs whitespace-nowrap">금액</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">품명</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">비용구분</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">
                  로딩 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">
                  데이터 없음 — 임포트 스크립트를 먼저 실행하세요
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <CardRow
                key={row.id}
                row={row}
                selected={selected.has(row.id)}
                options={options}
                onSelect={(sel) =>
                  setSelected((prev) => {
                    const s = new Set(prev);
                    sel ? s.add(row.id) : s.delete(row.id);
                    return s;
                  })
                }
                onSave={saveField}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {(page * PAGE_SIZE + 1).toLocaleString()}–
            {Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString()} / {totalCount.toLocaleString()}건
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-border px-2 py-1 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2">{page + 1} / {totalPages}</span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border px-2 py-1 disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 옵션 관리 */}
      <div className="rounded-xl border border-border p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">비용구분 옵션 관리</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {options.map((o) => (
            <span
              key={o}
              className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs"
            >
              {o}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="max-w-48 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="새 옵션 추가..."
            value={newOpt}
            onChange={(e) => setNewOpt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addOption()}
          />
          <button
            onClick={addOption}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   개별 행 (불필요한 리렌더 최소화)
══════════════════════════════════════════ */
function CardRow({
  row,
  selected,
  options,
  onSelect,
  onSave,
}: {
  row: CardTransaction;
  selected: boolean;
  options: string[];
  onSelect: (sel: boolean) => void;
  onSave: (id: string, field: "product_name" | "cost_category", value: string) => Promise<boolean>;
}) {
  const [productName, setProductName] = useState(row.product_name);
  const [saving, setSaving] = useState(false);

  // bulk edit 등 외부에서 row.product_name 변경 시 동기화
  useEffect(() => { setProductName(row.product_name); }, [row.product_name]);

  const handleProductBlur = async () => {
    if (productName === row.product_name) return;
    setSaving(true);
    await onSave(row.id, "product_name", productName);
    setSaving(false);
  };

  const handleCategoryChange = async (val: string) => {
    await onSave(row.id, "cost_category", val);
  };

  const incomplete = !row.cost_category;

  return (
    <tr
      className={cn(
        "border-b border-border/50 transition-colors",
        selected
          ? "bg-primary/5"
          : incomplete
          ? "bg-amber-50/40 dark:bg-amber-950/10 hover:bg-amber-50/60"
          : "hover:bg-secondary/40",
      )}
    >
      <td className="px-3 py-1.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
        {row.transaction_date}
      </td>
      <td className="px-3 py-1.5 text-xs whitespace-nowrap">{row.card_company}</td>
      <td
        className="max-w-44 truncate px-3 py-1.5 text-xs"
        title={row.merchant_name}
      >
        {row.merchant_name}
      </td>
      <td className="px-3 py-1.5 text-right text-xs tabular-nums whitespace-nowrap">
        {row.amount < 0 ? (
          <span className="text-red-500">({Math.abs(row.amount).toLocaleString()})</span>
        ) : (
          row.amount.toLocaleString()
        )}
      </td>
      <td className="px-2 py-1">
        <input
          className={cn(
            "w-full rounded-md border bg-transparent px-2 py-0.5 text-xs outline-none focus:border-primary focus:bg-background",
            saving
              ? "opacity-50"
              : "border-transparent hover:border-border",
          )}
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          onBlur={handleProductBlur}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.target as HTMLInputElement).blur()
          }
          placeholder="품명 입력..."
        />
      </td>
      <td className="px-2 py-1">
        <select
          className={cn(
            "rounded-md border px-1.5 py-0.5 text-xs bg-transparent outline-none focus:border-primary",
            row.cost_category
              ? "border-transparent hover:border-border"
              : "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
          )}
          value={row.cost_category}
          onChange={(e) => handleCategoryChange(e.target.value)}
        >
          <option value="">— 선택 —</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </td>
    </tr>
  );
}
