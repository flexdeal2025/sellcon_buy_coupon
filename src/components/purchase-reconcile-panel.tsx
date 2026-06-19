"use client";

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { RefreshCw, Wand2, PackagePlus, CheckCircle2 } from "lucide-react";

interface Statement {
  id: string;
  supplier: string;
  owner: string;
  account: string;
  order_date: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  registered: boolean;
  source_file: string;
}
interface MatchStatus { exact_cnt: number; near_cnt: number }

const PAGE_SIZE = 100;

export function PurchaseReconcilePanel() {
  const sb = getSupabaseClient();

  const [supplierList, setSupplierList] = useState<string[]>([]);
  const [supplier, setSupplier] = useState("");
  const [regFilter, setRegFilter] = useState<"" | "no" | "yes">("no"); // 기본: 미등록만
  const [rows, setRows] = useState<Statement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const [match, setMatch] = useState<Record<string, MatchStatus>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [stats, setStats] = useState({ total: 0, reg: 0, sum: 0 });

  /* 공급처 목록 */
  const fetchSuppliers = useCallback(async () => {
    const { data } = await sb.rpc("distinct_statement_suppliers");
    if (data?.length) setSupplierList((data as { supplier: string }[]).map((r) => r.supplier));
  }, [sb]);

  /* 매칭 상태(전체 1회) */
  const fetchMatch = useCallback(async () => {
    const { data } = await sb.rpc("statement_match_status");
    if (data) {
      const m: Record<string, MatchStatus> = {};
      (data as { statement_id: string; exact_cnt: number; near_cnt: number }[]).forEach((r) => {
        m[r.statement_id] = { exact_cnt: Number(r.exact_cnt), near_cnt: Number(r.near_cnt) };
      });
      setMatch(m);
    }
  }, [sb]);

  /* 통계 */
  const fetchStats = useCallback(async () => {
    let q = sb.from("supplier_statements").select("line_total,registered");
    if (supplier) q = q.eq("supplier", supplier);
    const { data } = await q.limit(10000);
    const list = (data as { line_total: number; registered: boolean }[]) ?? [];
    setStats({
      total: list.length,
      reg: list.filter((r) => r.registered).length,
      sum: list.reduce((a, b) => a + b.line_total, 0),
    });
  }, [sb, supplier]);

  /* 행 */
  const fetchRows = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      let q = sb.from("supplier_statements").select("*", { count: "exact" })
        .order("order_date", { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (supplier) q = q.eq("supplier", supplier);
      if (regFilter === "no") q = q.eq("registered", false);
      if (regFilter === "yes") q = q.eq("registered", true);
      const { data, count } = await q;
      setRows((data as Statement[]) ?? []);
      setTotal(count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [sb, supplier, regFilter, page]);

  useEffect(() => { fetchSuppliers(); fetchMatch(); }, [fetchSuppliers, fetchMatch]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { setPage(0); }, [supplier, regFilter]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  /* 매입등록 (선택 건 → purchase_records) */
  const registerSelected = async () => {
    const targets = rows.filter((r) => selected.has(r.id) && !r.registered);
    if (targets.length === 0) { toast.error("등록할 미등록 건을 선택하세요"); return; }
    setBusy(true);
    try {
      const payloads = targets.map((s) => ({
        purchase_date: s.order_date,
        supplier: s.supplier,
        product_name: s.product_name,
        ordered_quantity: s.quantity,
        received_quantity: s.quantity,
        limit_per_number: 0,
        allocated_phone_ids: [],
        unit_price: s.unit_price,
        total_price: s.line_total,
        account_email: s.account || null,
        evidence_type: "카드",
        status: "매입등록",
        status_updated_by: "명세서자동",
        delivery_logs: [],
        checked_phone_ids: [],
        notes: `명세서 자동등록 (${s.source_file})`,
      }));
      const { data: inserted, error } = await sb.from("purchase_records").insert(payloads).select("id");
      if (error) { toast.error("매입등록 실패: " + error.message); return; }
      // 명세서 registered 표시 + purchase_id 연결
      const ids = (inserted as { id: string }[]) ?? [];
      await Promise.all(targets.map((s, i) =>
        sb.from("supplier_statements").update({ registered: true, purchase_id: ids[i]?.id ?? null }).eq("id", s.id),
      ));
      toast.success(`${targets.length}건 매입등록 완료`);
      setSelected(new Set());
      await Promise.all([fetchRows(), fetchStats()]);
    } finally {
      setBusy(false);
    }
  };

  /* 카드 품명 자동기입 */
  const fillCardProducts = async () => {
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("fill_card_products_from_statements", { only_empty: true });
      if (error) { toast.error("카드 품명 기입 실패: " + error.message); return; }
      toast.success(`카드 품명 자동기입 — ${data ?? 0}건 채움`);
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const selectable = rows.filter((r) => !r.registered);
  const allSel = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggleAll = () => allSel ? setSelected(new Set()) : setSelected(new Set(selectable.map((r) => r.id)));

  const matchBadge = (id: string) => {
    const m = match[id];
    if (!m) return <span className="text-muted-foreground">–</span>;
    if (m.exact_cnt === 1) return <span className="text-green-600" title="카드 정확매칭">✅정확</span>;
    if (m.exact_cnt > 1) return <span className="text-orange-500" title={`같은날 ${m.exact_cnt}건`}>🟠중복</span>;
    if (m.near_cnt > 0) return <span className="text-amber-500" title={`±3일 ${m.near_cnt}건`}>🟡근접</span>;
    return <span className="text-muted-foreground" title="카드 매칭 없음(타명의 카드 등)">❌없음</span>;
  };

  return (
    <div className="space-y-3">
      {/* 통계 */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span>명세서 <strong>{stats.total.toLocaleString()}건</strong></span>
        <span className="text-green-600">등록 <strong>{stats.reg.toLocaleString()}</strong></span>
        <span className="text-amber-600">미등록 <strong>{(stats.total - stats.reg).toLocaleString()}</strong></span>
        <span className="text-muted-foreground">합계 {stats.sum.toLocaleString()}원</span>
      </div>

      {/* 필터 + 액션 */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-secondary/40 p-3">
        <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">전체 공급처</option>
          {supplierList.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={regFilter} onChange={(e) => setRegFilter(e.target.value as "" | "no" | "yes")}>
          <option value="no">미등록만</option>
          <option value="yes">등록완료</option>
          <option value="">전체</option>
        </select>
        <div className="ml-auto flex gap-2">
          <button onClick={fillCardProducts} disabled={busy}
            title="명세서와 금액·날짜 정확 일치하는 카드건의 빈 품명을 자동 기입"
            className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm hover:bg-primary/10 disabled:opacity-40">
            <Wand2 className={cn("h-3.5 w-3.5", busy && "animate-pulse")} /> 카드 품명 자동기입
          </button>
          <button onClick={fetchRows} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm hover:bg-secondary">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* 선택 등록 바 */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">{selected.size}건 선택</span>
          <button onClick={registerSelected} disabled={busy}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
            <PackagePlus className="h-4 w-4" /> 매입등록
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-sm text-muted-foreground hover:text-foreground">선택 해제</button>
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-3 py-2 text-left"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">거래일</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">공급처</th>
              <th className="px-3 py-2 text-left text-xs whitespace-nowrap">상품명</th>
              <th className="px-3 py-2 text-right text-xs whitespace-nowrap">수량</th>
              <th className="px-3 py-2 text-right text-xs whitespace-nowrap">단가</th>
              <th className="px-3 py-2 text-right text-xs whitespace-nowrap">거래금액</th>
              <th className="px-3 py-2 text-center text-xs whitespace-nowrap">카드매칭</th>
              <th className="px-3 py-2 text-center text-xs whitespace-nowrap">등록</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="py-8 text-center text-muted-foreground text-sm">로딩 중...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-muted-foreground text-sm">명세서 없음 — 적재 스크립트를 먼저 실행하세요</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-border/50", r.registered ? "bg-green-50/40 dark:bg-green-950/10" : "hover:bg-secondary/40")}>
                <td className="px-3 py-1.5">
                  <input type="checkbox" disabled={r.registered} checked={selected.has(r.id)}
                    onChange={(e) => setSelected((prev) => { const s = new Set(prev); e.target.checked ? s.add(r.id) : s.delete(r.id); return s; })} />
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{r.order_date}</td>
                <td className="px-3 py-1.5 text-xs whitespace-nowrap font-medium">{r.supplier}</td>
                <td className="px-3 py-1.5 text-xs">{r.product_name}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{r.quantity.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{r.unit_price.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{r.line_total.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-center text-xs whitespace-nowrap">{matchBadge(r.id)}</td>
                <td className="px-3 py-1.5 text-center text-xs whitespace-nowrap">
                  {r.registered ? <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" /> : <span className="text-muted-foreground">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} / {total.toLocaleString()}건</span>
          <div className="flex items-center gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40">이전</button>
            <span className="px-2">{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40">다음</button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        ❌없음 = 유정인 카드에 매칭 결제 없음(김성수 명의 카드 결제 등). 매입등록은 카드매칭과 무관하게 명세서 기준으로 됩니다.
      </p>
    </div>
  );
}
