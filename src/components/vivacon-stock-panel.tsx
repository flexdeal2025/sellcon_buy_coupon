"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getSupabaseClient } from "@/lib/supabase/client";
import { stripVivacon } from "@/hooks/use-vivacon-products";
import { Upload, Loader2, Save, CheckCircle2, RotateCcw, Send, RefreshCw, StopCircle, Trash2, ZoomIn, ZoomOut, X, Sparkles } from "lucide-react";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };

interface Reg {
  id: string;
  image_path: string;
  image_url: string;
  product_name: string;
  option_name: string;
  coupon_code: string;
  expiry_date: string | null;
  exchange_location: string;
  supplier: string;
  purchase_date: string | null;
  unit_cost: number | null;
  ocr_confidence: number | null;
  extraction_quality: string;
  inspection_status: string;
  stored_as_code: boolean;
  published: boolean;
  product_slug: string;
  dup?: boolean;
  source?: string;              // manual | telegram | sellcon
  seller_name_masked?: string;  // 셀콘 직결 건의 매도자 마스킹명
}

const QUALITY_COLOR: Record<string, string> = {
  high: "text-success", medium: "text-warning", low: "text-destructive",
};
type BulkField = "product_name" | "option_name" | "expiry_date" | "supplier" | "unit_cost" | "stored_as_code";
interface Vendor { name: string; name_en: string }

export function VivaconStockPanel() {
  const [storageType, setStorageType] = useState<"image" | "code">("code");
  const [defProduct, setDefProduct] = useState("");
  const [defSupplier, setDefSupplier] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const [batch, setBatch] = useState<{ id: string; batch_no: string } | null>(null);
  const [batches, setBatches] = useState<{ id: string; batch_no: string; storage_type: string; purchase_date: string | null }[]>([]);
  const [rows, setRows] = useState<Reg[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pubFilter, setPubFilter] = useState<"unpublished" | "published" | "all">("unpublished");
  const [lowFirst, setLowFirst] = useState(false);
  const stopRef = useRef(false);

  // 코드 직접 입력(텍스트)
  const [codesOpen, setCodesOpen] = useState(false);
  const [codesText, setCodesText] = useState("");
  const [codesExpiry, setCodesExpiry] = useState("");

  // 일괄변경
  const [bulkField, setBulkField] = useState<BulkField>("product_name");
  const [bulkValue, setBulkValue] = useState("");

  // 이미지 팝업(라이트박스)
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  // 상품명 자동완성 + 영문명 사전 + 매입처 마스터
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [slugMap, setSlugMap] = useState<Record<string, string>>({});
  const [vendors, setVendors] = useState<Vendor[]>([]);
  useEffect(() => {
    const sb = getSupabaseClient();
    (async () => {
      const [{ data: prods }, { data: slugs }, { data: vs }] = await Promise.all([
        sb.from("smartstore_products").select("name").limit(3000),
        sb.from("vivacon_product_slugs").select("product_name, slug").limit(10000),
        sb.from("purchase_vendors").select("name, name_en").order("name"),
      ]);
      const map: Record<string, string> = {};
      for (const s of slugs ?? []) map[s.product_name] = s.slug;
      // 상품명 후보: 사전 + 스마트스토어 합집합
      const names = new Set<string>(Object.keys(map));
      for (const r of prods ?? []) {
        const n = stripVivacon(r.name);
        if (n) names.add(n);
      }
      setSlugMap(map);
      setProductOptions(Array.from(names).sort());
      setVendors((vs as Vendor[]) ?? []);
    })();
  }, []);

  const fetchRows = useCallback(async (batchId: string) => {
    const params = new URLSearchParams({ batch_id: batchId });
    if (pubFilter !== "all") params.set("published", pubFilter === "published" ? "true" : "false");
    const res = await fetch(`/api/stock/registrations?${params}`);
    const json = await res.json();
    if (json.ok) setRows(json.rows);
    else toast.error("목록 조회 실패: " + json.error);
  }, [pubFilter]);

  // 발행상태 필터 변경 시 현재 배치 재조회
  useEffect(() => { if (batch) fetchRows(batch.id); }, [pubFilter, batch, fetchRows]);

  // 배치 목록 로드 (재진입용)
  const loadBatches = useCallback(async () => {
    const res = await fetch("/api/stock/batches");
    const json = await res.json();
    if (json.ok) setBatches(json.rows);
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  // 기존 배치 재진입
  const openBatch = (id: string) => {
    const b = batches.find((x) => x.id === id);
    if (!b) return;
    setBatch({ id: b.id, batch_no: b.batch_no });
    setStorageType(b.storage_type === "code" ? "code" : "image");
    setSelected(new Set());
    fetchRows(b.id);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files); // await 전에 즉시 스냅샷
    stopRef.current = false;
    setBusy(true);
    try {
      let b = batch;
      if (!b) {
        const res = await fetch("/api/stock/batch", {
          method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
          body: JSON.stringify({ storage_type: storageType, default_product_name: defProduct, default_exchange_location: defSupplier, purchase_date: purchaseDate || null }),
        });
        const json = await res.json();
        if (!json.ok) { toast.error("배치 생성 실패: " + json.error); return; }
        b = { id: json.batch.id, batch_no: json.batch.batch_no };
        setBatch(b);
      }
      setProgress({ done: 0, total: arr.length });
      let done = 0;
      for (let i = 0; i < arr.length; i++) {
        if (stopRef.current) break;
        const fd = new FormData();
        fd.append("file", arr[i]);
        fd.append("batch_id", b.id);
        fd.append("batch_no", b.batch_no);
        fd.append("storage_type", storageType);
        fd.append("default_product_name", defProduct);
        fd.append("default_supplier", defSupplier);
        if (purchaseDate) fd.append("purchase_date", purchaseDate);
        if (unitCost) fd.append("unit_cost", unitCost);
        const res = await fetch("/api/stock/ocr", { method: "POST", headers: AUTH, body: fd });
        const json = await res.json();
        // 처리 직후 중지를 눌렀으면 방금 생성건 취소(삭제)
        if (stopRef.current) {
          if (json.ok && json.row?.id) {
            await fetch(`/api/stock/registration?id=${json.row.id}`, { method: "DELETE", headers: AUTH });
          }
          break;
        }
        if (!json.ok) toast.error(`${arr[i].name}: ${json.error}`);
        done++;
        setProgress({ done: done, total: arr.length });
      }
      await fetchRows(b.id);
      loadBatches();
      toast[stopRef.current ? "info" : "success"](stopRef.current ? `중지됨 — ${done}장 처리` : `${done}장 업로드·OCR 완료`);
    } finally {
      setBusy(false);
      setProgress(null);
      stopRef.current = false;
    }
  };

  // 코드 텍스트 일괄등록
  const submitCodes = async () => {
    const codes = codesText.split(/[\r\n]+/).map((c) => c.trim()).filter(Boolean);
    if (codes.length === 0) { toast.error("코드를 입력하세요(한 줄에 하나)"); return; }
    setBusy(true);
    try {
      let b = batch;
      if (!b) {
        const res = await fetch("/api/stock/batch", {
          method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
          body: JSON.stringify({ storage_type: "code", default_product_name: defProduct, default_exchange_location: defSupplier, purchase_date: purchaseDate || null }),
        });
        const json = await res.json();
        if (!json.ok) { toast.error("배치 생성 실패: " + json.error); return; }
        b = { id: json.batch.id, batch_no: json.batch.batch_no };
        setBatch(b);
      }
      const res = await fetch("/api/stock/codes", {
        method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({
          batch_id: b.id, codes,
          product_name: defProduct, expiry_date: codesExpiry, supplier: defSupplier, unit_cost: unitCost,
          product_slug: slugMap[defProduct] ?? "",
        }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error("코드 등록 실패: " + json.error); return; }
      toast.success(`${json.inserted}건 코드 등록`);
      setCodesText("");
      await fetchRows(b.id);
      loadBatches();
    } finally {
      setBusy(false);
    }
  };

  const stop = () => { stopRef.current = true; };
  const newBatch = () => { setBatch(null); setRows([]); setSelected(new Set()); };

  const updateRow = (id: string, patch: Partial<Reg>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const saveRow = async (r: Reg) => {
    const res = await fetch("/api/stock/registration", {
      method: "PATCH", headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ id: r.id, patch: {
        product_name: r.product_name, option_name: r.option_name, coupon_code: r.coupon_code,
        expiry_date: r.expiry_date ?? "", supplier: r.supplier ?? "",
        unit_cost: r.unit_cost ?? "", stored_as_code: r.stored_as_code, product_slug: r.product_slug ?? "",
      } }),
    });
    const json = await res.json();
    if (!json.ok) { toast.error("저장 실패: " + json.error); return; }
    updateRow(r.id, json.row);
    toast.success("저장됨");
  };

  // 발행형태(코드형/이미지형)는 발행 경로를 바꾸는 치명적 필드 → 변경 즉시 DB 저장(desync 방지)
  const setStoredType = async (r: Reg, isCode: boolean) => {
    if (r.stored_as_code === isCode) return;
    updateRow(r.id, { stored_as_code: isCode }); // 낙관적 반영
    const res = await fetch("/api/stock/registration", {
      method: "PATCH", headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ id: r.id, patch: { stored_as_code: isCode } }),
    });
    const json = await res.json();
    if (!json.ok) {
      updateRow(r.id, { stored_as_code: !isCode }); // 실패 시 롤백
      toast.error("발행형태 저장 실패: " + json.error);
      return;
    }
    toast.success(isCode ? "코드형으로 저장됨" : "이미지형으로 저장됨");
  };

  // 영문 슬러그 AI 생성
  const genSlug = async (r: Reg) => {
    if (!r.product_name.trim()) { toast.error("상품명을 먼저 입력하세요"); return; }
    const res = await fetch("/api/stock/slug", {
      method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ product_name: r.product_name }),
    });
    const json = await res.json();
    if (!json.ok) { toast.error("영문명 생성 실패: " + json.error); return; }
    updateRow(r.id, { product_slug: json.slug });
    toast.success(`영문명: ${json.slug}`);
  };

  const setStatus = async (r: Reg, status: "approved" | "pending") => {
    // 승인 시 현재 카드 상태(발행형태 포함)를 먼저 저장하여 UI 변경이 DB에 반영되도록 함
    if (status === "approved") {
      const saveRes = await fetch("/api/stock/registration", {
        method: "PATCH", headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ id: r.id, patch: {
          product_name: r.product_name, option_name: r.option_name, coupon_code: r.coupon_code,
          expiry_date: r.expiry_date ?? "", supplier: r.supplier ?? "",
          unit_cost: r.unit_cost ?? "", stored_as_code: r.stored_as_code, product_slug: r.product_slug ?? "",
        } }),
      });
      const saveJson = await saveRes.json();
      if (!saveJson.ok) { toast.error("저장 실패(승인 전): " + saveJson.error); return; }
      updateRow(r.id, saveJson.row);
    }
    const res = await fetch("/api/stock/registration", {
      method: "PATCH", headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ id: r.id, patch: { inspection_status: status } }),
    });
    const json = await res.json();
    if (!json.ok) { toast.error(json.error); return; }
    updateRow(r.id, { inspection_status: status });
  };

  const deleteRow = async (r: Reg) => {
    if (!confirm("이 카드를 삭제합니다(이미지도 함께 삭제). 계속할까요?")) return;
    const res = await fetch(`/api/stock/registration?id=${r.id}`, { method: "DELETE", headers: AUTH });
    const json = await res.json();
    if (!json.ok) { toast.error("삭제 실패: " + json.error); return; }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    setSelected((p) => { const s = new Set(p); s.delete(r.id); return s; });
  };

  // 선택 카드 일괄 삭제(검수 취소) — 미발행 건만. 이미지도 함께 삭제.
  const deleteSelected = async () => {
    const targets = rows.filter((r) => selected.has(r.id) && !r.published);
    if (targets.length === 0) { toast.error("삭제할 미발행 카드를 선택하세요"); return; }
    if (!confirm(`선택한 ${targets.length}건을 검수 취소(삭제)합니다.\n이미지도 함께 삭제되며 되돌릴 수 없습니다. 계속할까요?`)) return;
    setBusy(true);
    try {
      const results = await Promise.all(
        targets.map(async (r) => {
          const res = await fetch(`/api/stock/registration?id=${r.id}`, { method: "DELETE", headers: AUTH });
          return (await res.json()).ok ? r.id : null;
        })
      );
      const deleted = new Set(results.filter(Boolean) as string[]);
      setRows((prev) => prev.filter((x) => !deleted.has(x.id)));
      setSelected(new Set());
      toast.success(`${deleted.size}건 삭제 완료${deleted.size < targets.length ? ` / 실패 ${targets.length - deleted.size}` : ""}`);
      loadBatches();
    } finally {
      setBusy(false);
    }
  };

  // 선택 카드 일괄 승인 — 미발행·미승인 건만 approved 로 전환
  const approveSelected = async () => {
    const targets = rows.filter((r) => selected.has(r.id) && !r.published && r.inspection_status !== "approved");
    if (targets.length === 0) { toast.error("승인할 미승인 카드를 선택하세요"); return; }
    setBusy(true);
    try {
      const results = await Promise.all(
        targets.map(async (r) => {
          const res = await fetch("/api/stock/registration", {
            method: "PATCH", headers: { "Content-Type": "application/json", ...AUTH },
            body: JSON.stringify({ id: r.id, patch: { inspection_status: "approved" } }),
          });
          const json = await res.json();
          if (json.ok) updateRow(r.id, { inspection_status: "approved" });
          return json.ok;
        })
      );
      const ok = results.filter(Boolean).length;
      toast.success(`${ok}건 승인${ok < targets.length ? ` / 실패 ${targets.length - ok}` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  // 현재 보기의 미발행 카드 전체 선택 / 선택 해제
  const selectAll = () => setSelected(new Set(rows.filter((r) => !r.published).map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  // 현재 배치 전체 삭제 (발행분 있으면 서버가 거부)
  const deleteBatch = async () => {
    if (!batch) return;
    if (!confirm(`배치 '${batch.batch_no}' 전체를 삭제합니다.\n검수대기 카드와 이미지가 모두 삭제되며 되돌릴 수 없습니다.\n(발행된 항목이 있으면 삭제되지 않습니다.)\n계속할까요?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/stock/batch?id=${batch.id}`, { method: "DELETE", headers: AUTH });
      const json = await res.json();
      if (!json.ok) { toast.error("배치 삭제 실패: " + json.error); return; }
      toast.success(`배치 삭제 완료 (${json.deleted}건)`);
      setBatch(null); setRows([]); setSelected(new Set());
      loadBatches();
    } finally {
      setBusy(false);
    }
  };

  // 선택 카드 일괄변경 (상품명/옵션명/유효기간)
  const applyBulk = async () => {
    const targets = rows.filter((r) => selected.has(r.id) && !r.published);
    if (targets.length === 0) { toast.error("미발행 카드를 선택하세요"); return; }
    if (bulkField === "expiry_date" && bulkValue && !/^\d{4}-\d{2}-\d{2}$/.test(bulkValue)) { toast.error("유효기간 형식 YYYY-MM-DD"); return; }
    if (bulkField === "unit_cost" && bulkValue.trim() && !/^[\d,]+$/.test(bulkValue.trim())) { toast.error("매입원가는 숫자만 입력하세요"); return; }
    // 발행형태(boolean)는 code/image → stored_as_code 로 변환
    const patch: Record<string, unknown> = bulkField === "stored_as_code"
      ? { stored_as_code: bulkValue === "code" }
      : { [bulkField]: bulkValue };
    setBusy(true);
    try {
      const results = await Promise.all(
        targets.map(async (r) => {
          const res = await fetch("/api/stock/registration", {
            method: "PATCH", headers: { "Content-Type": "application/json", ...AUTH },
            body: JSON.stringify({ id: r.id, patch }),
          });
          const json = await res.json();
          if (json.ok) updateRow(r.id, json.row);
          return json.ok;
        })
      );
      const ok = results.filter(Boolean).length;
      const label = bulkField === "stored_as_code" ? (bulkValue === "code" ? "코드형" : "이미지형") + "으로 " : "";
      toast.success(`${ok}건 ${label}일괄 변경 완료${ok < targets.length ? ` / 실패 ${targets.length - ok}` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  // 선택 카드 옵션명 자동채움 — 상품명 기준(미매칭 시 기본 옵션). 빈 값만 채움(수기값 보존).
  const autoFillOptions = async () => {
    const targets = rows.filter((r) => selected.has(r.id) && !r.published);
    if (targets.length === 0) { toast.error("미발행 카드를 선택하세요"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/stock/option-name", {
        method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ ids: targets.map((r) => r.id) }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error("자동채움 실패: " + (json.error ?? "")); return; }
      for (const u of (json.updated ?? []) as { id: string; option_name: string }[]) {
        updateRow(u.id, { option_name: u.option_name });
      }
      const kept = targets.length - (json.count ?? 0);
      toast.success(`옵션명 ${json.count ?? 0}건 자동채움${kept > 0 ? ` · 기존값 ${kept}건 유지` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    const ids = rows.filter((r) => selected.has(r.id) && r.inspection_status === "approved" && !r.published).map((r) => r.id);
    if (ids.length === 0) { toast.error("발행할 '승인'된 항목을 선택하세요"); return; }
    if (!confirm(`${ids.length}건을 실제 재고로 발행합니다.\n- 코드형 → 비바콘 판매재고(coupon_codes)\n- 이미지형 → GCP 발송폴더\n발송기에 즉시 반영됩니다. 계속할까요?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/stock/publish", { method: "POST", headers: { "Content-Type": "application/json", ...AUTH }, body: JSON.stringify({ ids }) });
      const json = await res.json();
      if (!json.ok) { toast.error("발행 실패: " + json.error); return; }
      toast.success(`${json.published}건 발행 완료${json.errors?.length ? ` · 실패 ${json.errors.length}건은 검수대기로 환원` : ""}`);
      if (json.errors?.length) {
        const list = json.errors as string[];
        toast.error("발행 실패 내역", { description: list.slice(0, 6).join("\n") + (list.length > 6 ? `\n…외 ${list.length - 6}건` : "") });
        console.warn("발행 실패:", json.errors);
      }
      if (batch) await fetchRows(batch.id);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const approvedCount = rows.filter((r) => r.inspection_status === "approved" && !r.published).length;
  // 검수 우선: 저신뢰(low) 먼저
  const qRank = (q: string) => (q === "low" ? 0 : q === "medium" ? 1 : q === "high" ? 2 : 3);
  const displayRows = lowFirst ? [...rows].sort((a, b) => qRank(a.extraction_quality) - qRank(b.extraction_quality)) : rows;
  const pendingCount = rows.filter((r) => r.inspection_status === "pending" && !r.published).length;
  const publishedCount = rows.filter((r) => r.published).length;
  const dupCount = rows.filter((r) => r.dup && !r.published).length;

  return (
    <div className="space-y-4">
      {/* 비바콘 상품명 자동완성 목록 */}
      <datalist id="vivacon-products">
        {productOptions.map((n) => <option key={n} value={n} />)}
      </datalist>

      {/* 배치 설정 + 업로드 */}
      <div className="rounded-xl border border-border bg-secondary/40 p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">등록 유형</span>
            <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={storageType}
              onChange={(e) => setStorageType(e.target.value as "image" | "code")} disabled={!!batch}>
              <option value="code">코드형 (Supabase 판매재고)</option>
              <option value="image">이미지형 (GCP 발송폴더)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">기본 상품명(선택)</span>
            <input list="vivacon-products" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="OCR 실패 시 사용"
              value={defProduct} onChange={(e) => setDefProduct(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">매입처</span>
            <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={defSupplier} onChange={(e) => setDefSupplier(e.target.value)}>
              <option value="">선택</option>
              {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">매입일(선택)</span>
            <input type="date" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">매입원가(선택)</span>
            <input inputMode="numeric" className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
              value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground", busy && "opacity-50 pointer-events-none")}>
            <Upload className="h-4 w-4" />
            기프티콘 이미지 업로드
            <input type="file" accept="image/*" multiple className="hidden" disabled={busy}
              onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {/* 기존 배치 재진입 */}
          {!progress && batches.length > 0 && (
            <select className="rounded-lg border border-border bg-background px-2 py-2 text-sm"
              value={batch?.id ?? ""} onChange={(e) => e.target.value && openBatch(e.target.value)}>
              <option value="">기존 배치 불러오기…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.batch_no} · {b.storage_type === "code" ? "코드" : "이미지"}{b.purchase_date ? ` · ${b.purchase_date}` : ""}</option>
              ))}
            </select>
          )}
          {progress && (
            <>
              <span className="flex items-center gap-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" /> {progress.done}/{progress.total} 처리 중...
              </span>
              <button onClick={stop} className="flex items-center gap-1 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/20">
                <StopCircle className="h-4 w-4" /> 중지
              </button>
            </>
          )}
          {batch && !progress && <span className="text-sm text-muted-foreground">현재 배치 <strong>{batch.batch_no}</strong></span>}
          {batch && !progress && <button onClick={newBatch} className="text-xs text-muted-foreground hover:text-foreground underline">새 배치 시작</button>}
          {batch && !progress && <button onClick={() => fetchRows(batch.id)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"><RefreshCw className="h-3.5 w-3.5" /></button>}
          {batch && !progress && <button onClick={deleteBatch} disabled={busy} title="이 배치 전체 삭제 (검수대기·미발행만)" className="flex items-center gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-sm text-destructive hover:bg-destructive/20 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> 배치 삭제</button>}
          <button onClick={() => setCodesOpen((v) => !v)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-secondary">
            {codesOpen ? "코드 입력 닫기" : "코드 직접 입력(텍스트)"}
          </button>
        </div>

        {/* 코드 직접 입력 (이미지 OCR 없이) */}
        {codesOpen && (
          <div className="rounded-lg border border-border bg-background p-3 space-y-2">
            <p className="text-xs text-muted-foreground">위 <strong>기본 상품명·매입처·매입원가</strong>가 공통 적용됩니다. 코드는 한 줄에 하나씩 붙여넣으세요. (채널 C 등 이미 글자로 된 코드용)</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground">유효기간</label>
              <input type="date" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={codesExpiry} onChange={(e) => setCodesExpiry(e.target.value)} />
            </div>
            <textarea className="h-32 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-mono" placeholder={"쿠폰번호1\n쿠폰번호2\n쿠폰번호3"} value={codesText} onChange={(e) => setCodesText(e.target.value)} />
            <button onClick={submitCodes} disabled={busy} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "등록 중..." : `코드 등록 (${codesText.split(/[\r\n]+/).map((c) => c.trim()).filter(Boolean).length}건)`}
            </button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          업로드하면 GCP 저장 → Gemini OCR로 쿠폰번호·유효기간 자동 추출 → 아래에서 이미지 보며 검수·수정 후 <strong>승인 → 발행</strong>.
        </p>
      </div>

      {/* 배치 요약 */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm">
          {batch && <span className="text-muted-foreground">배치 <strong className="text-foreground">{batch.batch_no}</strong></span>}
          <span>전체 <strong>{rows.length}</strong></span>
          <span className="text-amber-600">미검수 <strong>{pendingCount}</strong></span>
          <span className="text-primary">승인 <strong>{approvedCount}</strong></span>
          <span className="text-green-600">발행 <strong>{publishedCount}</strong></span>
          {dupCount > 0 && <span className="text-red-600">⚠️중복 <strong>{dupCount}</strong></span>}
          <label className="ml-auto flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={lowFirst} onChange={(e) => setLowFirst(e.target.checked)} />
            저신뢰 먼저
          </label>
          {/* 발행상태 보기 토글 */}
          <div className="flex gap-1">
            {([["unpublished", "검수중"], ["published", "발행완료"], ["all", "전체"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setPubFilter(k)}
                className={cn("rounded-md px-2 py-0.5 text-xs", pubFilter === k ? "bg-foreground text-background" : "bg-secondary text-muted-foreground")}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 일괄변경 + 발행 바 */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm">선택 {selected.size}</span>
          <button onClick={selectAll} className="rounded-lg border border-border bg-background px-2 py-1 text-xs hover:bg-secondary">전체 선택</button>
          {selected.size > 0 && (
            <button onClick={clearSelection} className="rounded-lg border border-border bg-background px-2 py-1 text-xs hover:bg-secondary">선택 해제</button>
          )}
          {selected.size > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-sm">|</span>
              <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={bulkField} onChange={(e) => { const f = e.target.value as BulkField; setBulkField(f); setBulkValue(f === "stored_as_code" ? "code" : ""); }}>
                <option value="product_name">상품명</option>
                <option value="option_name">옵션명</option>
                <option value="expiry_date">유효기간</option>
                <option value="supplier">매입처</option>
                <option value="unit_cost">매입원가</option>
                <option value="stored_as_code">발행형태</option>
              </select>
              {bulkField === "stored_as_code" ? (
                <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="code">코드형</option>
                  <option value="image">이미지형</option>
                </select>
              ) : bulkField === "expiry_date" ? (
                <input type="date" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
              ) : bulkField === "supplier" ? (
                <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">매입처 선택</option>
                  {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              ) : bulkField === "unit_cost" ? (
                <input inputMode="numeric" className="w-32 rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums" placeholder="매입원가(원)" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
              ) : (
                <input list={bulkField === "product_name" ? "vivacon-products" : undefined} className="w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="변경할 값" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
              )}
              <button onClick={applyBulk} disabled={busy} className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm text-primary disabled:opacity-50">일괄변경</button>
            </div>
          )}
          {selected.size > 0 && (
            <button onClick={autoFillOptions} disabled={busy} title="선택 카드의 빈 옵션명을 상품명 기준으로 채웁니다" className="flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50">
              <Sparkles className="h-4 w-4" /> 옵션명 자동채움
            </button>
          )}
          {selected.size > 0 && (
            <button onClick={approveSelected} disabled={busy} className="ml-auto flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm text-primary hover:bg-primary/20 disabled:opacity-50">
              <CheckCircle2 className="h-4 w-4" /> 선택 승인
            </button>
          )}
          {selected.size > 0 && (
            <button onClick={deleteSelected} disabled={busy} className="flex items-center gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/20 disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> 선택 삭제
            </button>
          )}
          <button onClick={publish} disabled={busy} className={cn("flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50", selected.size === 0 && "ml-auto")}>
            <Send className="h-4 w-4" /> 선택 발행
          </button>
        </div>
      )}

      {/* 검수 카드 목록 */}
      <div className="grid gap-3 lg:grid-cols-2">
        {displayRows.map((r) => (
          <div key={r.id} className={cn("flex gap-3 rounded-xl border p-3",
            r.published ? "border-green-500/40 bg-green-50/40 dark:bg-green-950/10" :
            r.inspection_status === "approved" ? "border-primary/40 bg-primary/5" : "border-border")}>
            {/* 이미지 (클릭 → 라이트박스) */}
            <button type="button" onClick={() => { setLightbox(r.image_url); setScale(1); }} className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.image_url} alt="기프티콘" className="h-32 w-24 sm:h-40 sm:w-32 rounded-lg border border-border object-cover hover:opacity-80" />
            </button>
            {/* 필드 (Enter=저장) */}
            <div className="min-w-0 flex-1 space-y-1.5"
              onKeyDown={(e) => { if (e.key === "Enter" && !r.published && e.target instanceof HTMLInputElement) saveRow(r); }}>
              <div className="flex items-center gap-2 text-xs">
                <span className={cn("font-medium", QUALITY_COLOR[r.extraction_quality])}>OCR {r.ocr_confidence ?? 0}점</span>
                {r.source === "sellcon" && (
                  <span className="rounded bg-blue-100 px-1 font-medium text-blue-600 dark:bg-blue-950/40" title={r.seller_name_masked ? `셀콘 자동매입 · 매도자 ${r.seller_name_masked}` : "셀콘 자동매입"}>셀콘</span>
                )}
                {r.dup && !r.published && <span className="rounded bg-red-100 px-1 font-medium text-red-600 dark:bg-red-950/40" title="이미 비바콘 재고에 있는 쿠폰번호">⚠️중복</span>}
                {r.published && <span className="text-green-600 font-medium">✅발행됨</span>}
                <label className="ml-auto flex items-center gap-1">
                  <input type="checkbox" checked={selected.has(r.id)} disabled={r.published}
                    onChange={(e) => setSelected((p) => { const s = new Set(p); e.target.checked ? s.add(r.id) : s.delete(r.id); return s; })} />
                  선택
                </label>
                {!r.published && (
                  <button onClick={() => deleteRow(r)} title="삭제" className="p-2 -m-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <input list="vivacon-products" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" placeholder="상품명(비바콘 검색)"
                value={r.product_name} disabled={r.published}
                onChange={(e) => { const v = e.target.value; updateRow(r.id, slugMap[v] ? { product_name: v, product_slug: slugMap[v] } : { product_name: v }); }}
                onBlur={(e) => { const v = e.target.value; if (v !== r.product_name) updateRow(r.id, slugMap[v] ? { product_name: v, product_slug: slugMap[v] } : { product_name: v }); }} />
              <input className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" placeholder="옵션명"
                value={r.option_name} disabled={r.published} onChange={(e) => updateRow(r.id, { option_name: e.target.value })} />
              {/* 영문명(슬러그) — 이미지형 파일명에 사용 */}
              <div className="flex gap-1.5">
                <input className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono" placeholder="영문명(파일명용)"
                  value={r.product_slug ?? ""} disabled={r.published}
                  onChange={(e) => updateRow(r.id, { product_slug: e.target.value })}
                  onBlur={(e) => { const v = e.target.value; if (v !== (r.product_slug ?? "")) updateRow(r.id, { product_slug: v }); }} />
                {!r.published && (
                  <button onClick={() => genSlug(r)} title="AI 영문명 생성" className="flex shrink-0 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-sm text-primary hover:bg-primary/10">
                    <Sparkles className="h-3 w-3" /> AI
                  </button>
                )}
              </div>
              <input className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono" placeholder="쿠폰번호"
                value={r.coupon_code} disabled={r.published} onChange={(e) => updateRow(r.id, { coupon_code: e.target.value })} />
              <div className="flex gap-1.5">
                <input type="date" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" title="유효기간"
                  value={r.expiry_date ?? ""} disabled={r.published} onChange={(e) => updateRow(r.id, { expiry_date: e.target.value })} />
                <select className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm" title="매입처"
                  value={r.supplier ?? ""} disabled={r.published} onChange={(e) => updateRow(r.id, { supplier: e.target.value })}>
                  <option value="">매입처</option>
                  {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
                <input inputMode="numeric" className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-xs tabular-nums" placeholder="매입원가"
                  value={r.unit_cost ?? ""} disabled={r.published} onChange={(e) => updateRow(r.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9-]/g, "")) })} />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" disabled={r.published}
                  value={r.stored_as_code ? "code" : "image"} onChange={(e) => setStoredType(r, e.target.value === "code")}>
                  <option value="code">코드형</option>
                  <option value="image">이미지형</option>
                </select>
                {!r.published && (
                  <>
                    <button onClick={() => saveRow(r)} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground" title="저장만(승인 없이)">
                      <Save className="h-4 w-4" />
                    </button>
                    {r.inspection_status === "approved" ? (
                      <button onClick={() => setStatus(r, "pending")} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-warning">
                        <RotateCcw className="h-4 w-4" /> 승인취소
                      </button>
                    ) : (
                      <button onClick={() => setStatus(r, "approved")} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground hover:bg-primary/90">
                        <CheckCircle2 className="h-4 w-4" /> 저장·승인
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 && !busy && (
        <p className="py-8 text-center text-sm text-muted-foreground">이미지를 업로드하면 OCR 검수 카드가 여기 표시됩니다.</p>
      )}

      {/* 라이트박스 (화면 내 팝업 + 확대/축소) */}
      {lightbox && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 text-slate-800"><ZoomOut className="h-5 w-5" /></button>
            <span className="flex h-10 min-w-14 items-center justify-center rounded-lg bg-white/90 text-sm text-slate-800">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale((s) => Math.min(5, s + 0.25))} className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 text-slate-800"><ZoomIn className="h-5 w-5" /></button>
            <button onClick={() => setLightbox(null)} className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 text-slate-800"><X className="h-5 w-5" /></button>
          </div>
          <div className="max-h-full max-w-full overflow-auto" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox} alt="확대" style={{ transform: `scale(${scale})`, transformOrigin: "center" }} className="max-w-none rounded-lg transition-transform" />
          </div>
        </div>
      )}
    </div>
  );
}
