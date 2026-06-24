"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { cn, toKST } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv";
import { Search, Download, Loader2, Eye, X } from "lucide-react";

interface Row {
  id: string;
  created_at: string | null;
  purchase_date: string | null;
  supplier: string;
  product_name: string;
  coupon_code: string;
  expiry_date: string | null;
  stored_as_code: boolean;
  inspection_status: string;
  published: boolean;
  unit_cost: number | null;
  exchange_location: string;
  source: string;
  product_slug: string;
  batch_no: string;
}

type DateField = "created" | "purchase";
type Storage = "all" | "image" | "code";
type Pub = "all" | "true" | "false";

const INSPECT_LABEL: Record<string, string> = { pending: "검수중", approved: "승인", rejected: "반려" };

export function StockHistoryPanel() {
  const [dateField, setDateField] = useState<DateField>("created");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [storage, setStorage] = useState<Storage>("all");
  const [published, setPublished] = useState<Pub>("all");
  const [supplier, setSupplier] = useState("");
  const [product, setProduct] = useState("");
  const [code, setCode] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [capped, setCapped] = useState(false);

  // 쿠폰 확인 뷰어
  interface Viewer { loading: boolean; url?: string; coupon_code?: string; product_name?: string; option_name?: string; expiry_date?: string | null; stored_as_code?: boolean; published?: boolean }
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const openViewer = async (id: string) => {
    setViewer({ loading: true });
    try {
      const res = await fetch(`/api/stock/image?id=${id}`);
      const json = await res.json();
      if (!json.ok) { toast.error("쿠폰 확인 실패: " + json.error); setViewer(null); return; }
      setViewer({ loading: false, ...json });
    } catch { toast.error("쿠폰 확인 중 오류"); setViewer(null); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ dateField, storage, published });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (supplier.trim()) p.set("supplier", supplier.trim());
    if (product.trim()) p.set("product", product.trim());
    if (code.trim()) p.set("code", code.trim());
    try {
      const res = await fetch(`/api/stock/history?${p}`);
      const json = await res.json();
      if (json.ok) { setRows(json.rows); setCapped(json.capped); }
      else toast.error("조회 실패: " + json.error);
    } finally {
      setLoading(false);
    }
  }, [dateField, from, to, storage, published, supplier, product, code]);

  // 최초 1회 로드(최근 등록 이력)
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const fmtDT = (s: string | null) => toKST(s) || "-"; // 등록일시는 KST 표시

  const exportCSV = () => {
    const data = rows.map((r) => ({
      등록일시: fmtDT(r.created_at),
      매입일: r.purchase_date ?? "",
      매입처: r.supplier,
      상품명: r.product_name,
      영문명: r.product_slug,
      쿠폰번호: r.coupon_code,
      유효기간: r.expiry_date ?? "",
      형식: r.stored_as_code ? "코드" : "이미지",
      검수: INSPECT_LABEL[r.inspection_status] ?? r.inspection_status,
      발행: r.published ? "발행" : "미발행",
      매입원가: r.unit_cost ?? "",
      출처: r.source,
      배치: r.batch_no,
    }));
    downloadCSV(`재고이력_${new Date().toISOString().slice(0, 10)}.csv`, data);
  };

  return (
    <div className="space-y-3">
      {/* 필터 */}
      <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex rounded-lg bg-secondary p-0.5 text-xs">
            {([["created", "등록일"], ["purchase", "매입일"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setDateField(k)}
                className={cn("rounded-md px-2.5 py-1 font-medium", dateField === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                {label}
              </button>
            ))}
          </div>
          <input type="date" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground">~</span>
          <input type="date" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={storage} onChange={(e) => setStorage(e.target.value as Storage)}>
            <option value="all">전체형식</option><option value="image">이미지형</option><option value="code">코드형</option>
          </select>
          <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={published} onChange={(e) => setPublished(e.target.value as Pub)}>
            <option value="all">전체상태</option><option value="false">미발행</option><option value="true">발행완료</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="w-28 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="매입처" value={supplier} onChange={(e) => setSupplier(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
          <input className="w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="상품명" value={product} onChange={(e) => setProduct(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
          <input className="w-44 rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-mono" placeholder="쿠폰번호" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
          <button onClick={load} disabled={loading} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} 조회
          </button>
          <button onClick={exportCSV} disabled={rows.length === 0} className="flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm disabled:opacity-50" title="CSV 내보내기">
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      {/* 결과 요약 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>결과 <strong className="text-foreground">{rows.length}</strong>건</span>
        {capped && <span className="text-amber-600">· 상한 도달 — 기간/검색을 좁혀 주세요</span>}
      </div>

      {/* 결과 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="border-b border-border bg-secondary/60">
            <tr>
              <th className="px-2 py-2 text-left">등록일시</th>
              <th className="px-2 py-2 text-left">매입일</th>
              <th className="px-2 py-2 text-left">매입처</th>
              <th className="px-2 py-2 text-left">상품명</th>
              <th className="px-2 py-2 text-left">쿠폰번호</th>
              <th className="px-2 py-2 text-left">유효기간</th>
              <th className="px-2 py-2 text-center">형식</th>
              <th className="px-2 py-2 text-center">검수</th>
              <th className="px-2 py-2 text-center">발행</th>
              <th className="px-2 py-2 text-left">배치</th>
              <th className="px-2 py-2 text-center">쿠폰</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="py-8 text-center text-muted-foreground">조회 결과가 없습니다.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-border/40", r.published ? "bg-green-50/30 dark:bg-green-950/10" : "")}>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{fmtDT(r.created_at)}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.purchase_date ?? "-"}</td>
                <td className="px-2 py-1.5">{r.supplier || "-"}{r.source === "sellcon" && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-600 dark:bg-blue-950/40">셀콘</span>}</td>
                <td className="px-2 py-1.5 max-w-48 truncate" title={r.product_name}>{r.product_name || "-"}</td>
                <td className="px-2 py-1.5 font-mono" title={r.coupon_code}>{r.coupon_code || "-"}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.expiry_date ?? "-"}</td>
                <td className="px-2 py-1.5 text-center">{r.stored_as_code ? "코드" : "이미지"}</td>
                <td className={cn("px-2 py-1.5 text-center", r.inspection_status === "approved" ? "text-primary" : r.inspection_status === "rejected" ? "text-destructive" : "text-amber-600")}>{INSPECT_LABEL[r.inspection_status] ?? r.inspection_status}</td>
                <td className={cn("px-2 py-1.5 text-center", r.published ? "text-green-600 font-medium" : "text-muted-foreground")}>{r.published ? "발행" : "—"}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.batch_no || "-"}</td>
                <td className="px-2 py-1.5 text-center">
                  <button onClick={() => openViewer(r.id)} title="쿠폰 확인" className="text-muted-foreground hover:text-primary"><Eye className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 쿠폰 확인 뷰어 */}
      {viewer && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4" onClick={() => setViewer(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-background p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">{viewer.stored_as_code ? "코드형 재고" : "이미지형 재고"}{viewer.published ? " · 발행완료" : ""}</span>
              <button onClick={() => setViewer(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            {viewer.loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2 text-sm">
                {viewer.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={viewer.url} alt="쿠폰 이미지" className="mx-auto max-h-[60vh] rounded-lg border border-border object-contain" />
                ) : (
                  <p className="rounded-lg bg-secondary p-4 text-center text-muted-foreground">이미지 없음 (코드형 — 아래 쿠폰번호로 확인)</p>
                )}
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border p-3">
                  <span className="text-muted-foreground">상품명</span><span>{viewer.product_name || "-"}</span>
                  {viewer.option_name ? (<><span className="text-muted-foreground">옵션명</span><span>{viewer.option_name}</span></>) : null}
                  <span className="text-muted-foreground">쿠폰번호</span><span className="font-mono select-all">{viewer.coupon_code || "-"}</span>
                  <span className="text-muted-foreground">유효기간</span><span>{viewer.expiry_date ?? "-"}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
