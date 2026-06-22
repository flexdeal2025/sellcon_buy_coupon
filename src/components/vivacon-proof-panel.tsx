"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Upload, Loader2, Link2, Unlink, RefreshCw, CheckCircle2, Trash2 } from "lucide-react";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };

interface Proof {
  id: string; platform: string; trader_name: string; proof_date: string | null;
  amount: number | null; memo: string; image_url: string; linked_count: number; linked_cost: number;
}
interface Reg {
  id: string; product_name: string; option_name: string; coupon_code: string;
  expiry_date: string | null; supplier: string; stored_as_code: boolean; published: boolean;
  proof_id: string | null; created_at: string | null; purchase_date: string | null;
}

export function VivaconProofPanel() {
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [inventory, setInventory] = useState<Reg[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [supplier, setSupplier] = useState("");
  const [mappedFilter, setMappedFilter] = useState<"" | "true" | "false">("");
  const [activeProof, setActiveProof] = useState<string | null>(null);
  const [selectedRegs, setSelectedRegs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // 업로드 폼
  const [platform, setPlatform] = useState("당근마켓");
  const [trader, setTrader] = useState("");
  const [pDate, setPDate] = useState("");
  const [amount, setAmount] = useState("");

  // 누락 리포트
  interface ReportRow { supplier: string; purchase_date: string; total: number; mapped: number; missing: number }
  const [report, setReport] = useState<ReportRow[]>([]);
  const [showReport, setShowReport] = useState(false);
  const loadReport = async () => {
    const res = await fetch("/api/proof/report");
    const json = await res.json();
    if (json.ok) { setReport(json.rows); setShowReport(true); }
    else toast.error("리포트 실패: " + json.error);
  };

  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient().from("purchase_vendors").select("name").order("name");
      setVendors((data ?? []).map((v: { name: string }) => v.name));
    })();
  }, []);

  const fetchProofs = useCallback(async () => {
    const res = await fetch("/api/proofs");
    const json = await res.json();
    if (json.ok) setProofs(json.rows);
  }, []);

  const fetchInventory = useCallback(async () => {
    const params = new URLSearchParams();
    if (supplier) params.set("supplier", supplier);
    if (mappedFilter) params.set("mapped", mappedFilter);
    const res = await fetch(`/api/proof/inventory?${params}`);
    const json = await res.json();
    if (json.ok) setInventory(json.rows);
  }, [supplier, mappedFilter]);

  useEffect(() => { fetchProofs(); }, [fetchProofs]);
  useEffect(() => { fetchInventory(); }, [fetchInventory]);
  useEffect(() => { setSelectedRegs(new Set()); }, [supplier, mappedFilter]);

  const uploadProofs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setBusy(true);
    try {
      for (const f of arr) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("platform", platform);
        fd.append("trader_name", trader);
        if (pDate) fd.append("proof_date", pDate);
        if (amount) fd.append("amount", amount);
        const res = await fetch("/api/proof/upload", { method: "POST", headers: AUTH, body: fd });
        const json = await res.json();
        if (!json.ok) toast.error(`${f.name}: ${json.error}`);
      }
      toast.success(`${arr.length}건 증빙 업로드`);
      fetchProofs();
    } finally {
      setBusy(false);
    }
  };

  const linkSelected = async () => {
    if (!activeProof) { toast.error("연결할 증빙을 먼저 선택하세요"); return; }
    const ids = [...selectedRegs];
    if (ids.length === 0) { toast.error("연결할 재고를 선택하세요"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/proof/link", {
        method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ proof_id: activeProof, registration_ids: ids }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error("연결 실패: " + json.error); return; }
      toast.success(`${json.linked}건 연결`);
      setSelectedRegs(new Set());
      await Promise.all([fetchProofs(), fetchInventory()]);
    } finally {
      setBusy(false);
    }
  };

  const deleteProof = async (id: string) => {
    if (!confirm("이 증빙을 삭제합니다(이미지·연결 함께 삭제). 계속할까요?")) return;
    const res = await fetch(`/api/proofs?id=${id}`, { method: "DELETE", headers: AUTH });
    const json = await res.json();
    if (!json.ok) { toast.error("삭제 실패: " + json.error); return; }
    if (activeProof === id) setActiveProof(null);
    await Promise.all([fetchProofs(), fetchInventory()]);
  };

  const unlink = async (rid: string) => {
    const res = await fetch(`/api/proof/link?registration_id=${rid}`, { method: "DELETE", headers: AUTH });
    const json = await res.json();
    if (!json.ok) { toast.error(json.error); return; }
    await Promise.all([fetchProofs(), fetchInventory()]);
  };

  const total = inventory.length;
  const mapped = inventory.filter((r) => r.proof_id).length;

  return (
    <div className="space-y-4">
      {/* 필터 + 누락 요약 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3">
        <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">전체 매입처</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={mappedFilter} onChange={(e) => setMappedFilter(e.target.value as "" | "true" | "false")}>
          <option value="">전체</option>
          <option value="false">미연결만</option>
          <option value="true">연결완료</option>
        </select>
        <span className="text-sm">재고 <strong>{total}</strong> · 증빙연결 <strong className="text-green-600">{mapped}</strong> · 미연결 <strong className="text-amber-600">{total - mapped}</strong></span>
        <button onClick={loadReport} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-secondary">누락 리포트</button>
        <button onClick={() => { fetchProofs(); fetchInventory(); }} className="ml-auto rounded-lg border border-border bg-background px-2 py-1.5 text-sm"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>

      {/* 누락 리포트 (매입처 × 매입일) */}
      {showReport && (
        <div className="rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-3 py-2">
            <span className="text-sm font-medium">증빙 누락 리포트 (매입처 × 매입일)</span>
            <button onClick={() => setShowReport(false)} className="text-xs text-muted-foreground hover:text-foreground">닫기</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-secondary/30">
                <tr>
                  <th className="px-3 py-1.5 text-left">매입처</th>
                  <th className="px-3 py-1.5 text-left">매입일</th>
                  <th className="px-3 py-1.5 text-right">전체</th>
                  <th className="px-3 py-1.5 text-right">연결</th>
                  <th className="px-3 py-1.5 text-right">미연결</th>
                </tr>
              </thead>
              <tbody>
                {report.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">데이터 없음</td></tr>}
                {report.map((r) => (
                  <tr key={`${r.supplier}__${r.purchase_date}`} className={cn("border-b border-border/40", r.missing > 0 && "bg-amber-50/40 dark:bg-amber-950/10")}>
                    <td className="px-3 py-1.5">{r.supplier}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.purchase_date}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.total}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-green-600">{r.mapped}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums font-medium", r.missing > 0 ? "text-amber-600" : "text-muted-foreground")}>{r.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 좌: 증빙 */}
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option>당근마켓</option><option>중고나라</option><option>번개장터</option><option>기타</option>
              </select>
              <input className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="거래자" value={trader} onChange={(e) => setTrader(e.target.value)} />
              <input type="date" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={pDate} onChange={(e) => setPDate(e.target.value)} />
              <input inputMode="numeric" className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums" placeholder="금액" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <label className={cn("flex cursor-pointer items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground", busy && "opacity-50 pointer-events-none")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} 증빙 업로드
                <input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={(e) => { uploadProofs(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">증빙(거래내역/채팅 캡쳐)을 올리고, 카드를 클릭해 활성화한 뒤 우측 재고를 선택해 연결하세요. (한 증빙에 여러 재고 = N:1)</p>
          </div>

          {proofs.map((p) => {
            const amt = p.amount ?? null;
            const matched = amt != null && p.linked_count > 0 && amt === p.linked_cost;
            const mismatch = amt != null && p.linked_count > 0 && amt !== p.linked_cost;
            return (
            <div key={p.id} role="button" tabIndex={0} onClick={() => setActiveProof(p.id)}
              onKeyDown={(e) => e.key === "Enter" && setActiveProof(p.id)}
              className={cn("flex w-full cursor-pointer gap-3 rounded-xl border p-2 text-left", activeProof === p.id ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-secondary/30")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.image_url} alt="증빙" className="h-24 w-20 rounded border border-border object-cover" />
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex items-center gap-1">
                  <span className="font-medium">{p.platform} {p.trader_name && `· ${p.trader_name}`}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteProof(p.id); }} title="증빙 삭제"
                    className="ml-auto text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="text-muted-foreground">{p.proof_date ?? "-"} · 거래금액 {amt?.toLocaleString() ?? "-"}원</div>
                <div className="mt-1">연결 <strong className={p.linked_count ? "text-green-600" : "text-muted-foreground"}>{p.linked_count}건</strong>
                  {p.linked_count > 0 && <span className="text-muted-foreground"> · 매핑합계 {p.linked_cost.toLocaleString()}원</span>}
                  {matched && <span className="ml-1 text-green-600">✅금액일치</span>}
                  {mismatch && <span className="ml-1 text-amber-600">⚠️금액불일치</span>}
                </div>
                {activeProof === p.id && <div className="mt-1 text-primary font-medium">● 활성 (이 증빙에 연결)</div>}
              </div>
            </div>
            );
          })}
          {proofs.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">업로드된 증빙이 없습니다.</p>}
        </div>

        {/* 우: 재고 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">재고 {total}건</span>
            <button onClick={linkSelected} disabled={busy || !activeProof || selectedRegs.size === 0}
              className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40">
              <Link2 className="h-4 w-4" /> 활성 증빙에 {selectedRegs.size}건 연결
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-secondary/60">
                <tr>
                  <th className="px-2 py-1.5 w-8"></th>
                  <th className="px-2 py-1.5 text-left">상품명</th>
                  <th className="px-2 py-1.5 text-left">쿠폰번호</th>
                  <th className="px-2 py-1.5 text-left">유효기간</th>
                  <th className="px-2 py-1.5 text-left">등록일</th>
                  <th className="px-2 py-1.5 text-center">증빙</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((r) => (
                  <tr key={r.id} className={cn("border-b border-border/50", r.proof_id ? "bg-green-50/30 dark:bg-green-950/10" : "hover:bg-secondary/30")}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={selectedRegs.has(r.id)} disabled={!!r.proof_id}
                        onChange={(e) => setSelectedRegs((p) => { const s = new Set(p); e.target.checked ? s.add(r.id) : s.delete(r.id); return s; })} />
                    </td>
                    <td className="px-2 py-1.5 truncate max-w-32" title={r.product_name}>{r.product_name}{r.option_name && ` (${r.option_name})`}</td>
                    <td className="px-2 py-1.5 font-mono truncate max-w-28" title={r.coupon_code}>{r.coupon_code}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.expiry_date ?? "-"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground" title={r.purchase_date ? `매입일 ${r.purchase_date}` : undefined}>{(r.created_at ?? "").slice(0, 10) || "-"}</td>
                    <td className="px-2 py-1.5 text-center">
                      {r.proof_id ? (
                        <button onClick={() => unlink(r.id)} title="연결 해제" className="inline-flex items-center gap-0.5 text-green-600 hover:text-destructive">
                          <CheckCircle2 className="h-3.5 w-3.5" /><Unlink className="h-3 w-3" />
                        </button>
                      ) : <span className="text-muted-foreground">–</span>}
                    </td>
                  </tr>
                ))}
                {inventory.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">재고가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
