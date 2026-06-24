"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import JsBarcode from "jsbarcode";
import { Upload, Loader2, ImageIcon, Sparkles } from "lucide-react";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };
const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Nanum Gothic','Noto Sans KR',sans-serif";

// 기본 좌표 — 약 800×1400 템플릿(상단 상품박스 + '상품명' 라벨 + 바코드박스 + '유효기간' 라벨) 기준.
// 라벨('상품명'·'유효기간')은 템플릿에 인쇄돼 있고, 실제 값은 라벨 오른쪽에 렌더된다.
// 템플릿 해상도/디자인이 다르면 아래 '레이아웃'에서 조정(미리보기로 확인).
const DEFAULT_COORDS = {
  prodX: 40, prodY: 40, prodSize: 720,
  nameX: 230, nameY: 818, nameFont: 34, nameMaxW: 520,
  bcX: 80, bcY: 962, bcW: 640, bcH: 210, bcFont: 22,
  expX: 230, expY: 1258, expFont: 34,
};
type Coords = typeof DEFAULT_COORDS;

interface Item { name: string; code: string; expiryDb: string | null; expiryText: string }

// 좌표 입력 (최상위 컴포넌트 — 내부 정의 시 매 렌더 리마운트/포커스 유실)
function CoordInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="number" className="w-16 rounded border border-border bg-background px-1 py-0.5 tabular-nums"
        value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}

// 유효기간 정규화 → { DB용 YYYY-MM-DD | null, 이미지 표시용 }
function normExpiry(raw: unknown): { db: string | null; text: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { db: null, text: "유효기간 없음" };
  let m = s.match(/^(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})$/);
  if (m) { const d = `${m[1]}-${m[2]}-${m[3]}`; return { db: d, text: d }; }
  m = s.match(/^(\d{2})[.\-/]?(\d{2})[.\-/]?(\d{2})$/);
  if (m) { const d = `20${m[1]}-${m[2]}-${m[3]}`; return { db: d, text: d }; }
  return { db: null, text: s.replace(/\./g, "-") };
}

export function GifticonConvertPanel() {
  const [templateImg, setTemplateImg] = useState<HTMLImageElement | null>(null);
  const [productImg, setProductImg] = useState<HTMLImageElement | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [productName2, setProductName2] = useState("");

  const [mode, setMode] = useState<"list" | "excel">("list");
  const [listText, setListText] = useState("");
  const [items, setItems] = useState<Item[]>([]);

  const [supplier, setSupplier] = useState("");
  const [optionName, setOptionName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const [coords, setCoords] = useState<Coords>(DEFAULT_COORDS);
  const [nameAutoFit, setNameAutoFit] = useState(true);
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stopRef = useRef(false);

  const loadImage = (file: File, set: (img: HTMLImageElement) => void, setName: (n: string) => void) => {
    const img = new Image();
    img.onload = () => { set(img); setName(file.name); };
    img.onerror = () => toast.error("이미지를 불러오지 못했습니다");
    img.src = URL.createObjectURL(file);
  };

  // 리스트 텍스트 파싱 (상품명,코드,유효기간 — 쉼표/탭 구분)
  const parseList = (text: string): Item[] =>
    text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[\t,]/).map((p) => p.trim());
      const e = normExpiry(parts[2]);
      return { name: parts[0] ?? "", code: (parts[1] ?? "").replace(/\s+/g, ""), expiryDb: e.db, expiryText: e.text };
    }).filter((it) => it.name && it.code);

  const onExcel = async (file: File | null) => {
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
      const parsed: Item[] = aoa.slice(1).map((row) => {
        const e = normExpiry(row[2]);
        return { name: String(row[0] ?? "").trim(), code: String(row[1] ?? "").replace(/\s+/g, "").trim(), expiryDb: e.db, expiryText: e.text };
      }).filter((it) => it.name && it.code);
      setItems(parsed);
      toast.success(`엑셀 ${parsed.length}건 인식`);
    } catch (e) {
      toast.error("엑셀 파싱 실패: " + (e instanceof Error ? e.message : ""));
    }
  };

  const applyList = () => {
    const parsed = parseList(listText);
    setItems(parsed);
    toast[parsed.length ? "success" : "error"](parsed.length ? `${parsed.length}건 인식` : "인식된 행이 없습니다 (상품명,코드,유효기간)");
  };

  // 쿠폰 이미지 1장 합성 → PNG Blob
  const generateOne = (it: Item): Promise<Blob> => new Promise((resolve, reject) => {
    if (!templateImg) return reject(new Error("템플릿 이미지 없음"));
    const canvas = document.createElement("canvas");
    canvas.width = templateImg.naturalWidth;
    canvas.height = templateImg.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("canvas 미지원"));
    ctx.drawImage(templateImg, 0, 0);
    if (productImg) ctx.drawImage(productImg, coords.prodX, coords.prodY, coords.prodSize, coords.prodSize);
    // 바코드(Code128) — 별도 캔버스에 그려 합성
    try {
      const bc = document.createElement("canvas");
      JsBarcode(bc, it.code, { format: "CODE128", displayValue: true, fontSize: coords.bcFont, height: 100, margin: 6, font: "monospace" });
      ctx.drawImage(bc, coords.bcX, coords.bcY, coords.bcW, coords.bcH);
    } catch { /* 바코드 실패해도 텍스트는 진행 */ }
    ctx.fillStyle = "black";
    ctx.textBaseline = "top";
    // 상품명 — 자동 폭맞춤: 길면 최대폭에 맞게 글자 축소(짧으면 기본 크기 그대로)
    let nf = coords.nameFont;
    ctx.font = `${nf}px ${FONT}`;
    if (nameAutoFit && coords.nameMaxW > 0) {
      while (nf > 12 && ctx.measureText(it.name).width > coords.nameMaxW) { nf -= 1; ctx.font = `${nf}px ${FONT}`; }
    }
    ctx.fillText(it.name, coords.nameX, coords.nameY);
    ctx.font = `${coords.expFont}px ${FONT}`;
    ctx.fillText(`~${it.expiryText}`, coords.expX, coords.expY);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 생성 실패"))), "image/png");
  });

  const preview = async () => {
    if (!templateImg) { toast.error("템플릿 이미지를 선택하세요"); return; }
    const list = items.length ? items : parseList(listText);
    if (list.length === 0) { toast.error("입력 데이터가 없습니다"); return; }
    try {
      const blob = await generateOne(list[0]);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) { toast.error("미리보기 실패: " + (e instanceof Error ? e.message : "")); }
  };

  const run = async () => {
    if (!templateImg) { toast.error("템플릿 이미지를 선택하세요"); return; }
    const list = items.length ? items : parseList(listText);
    if (list.length === 0) { toast.error("입력 데이터가 없습니다"); return; }
    if (!confirm(`${list.length}건의 기프티콘 이미지를 생성해 재고(검수대기)로 등록합니다. 계속할까요?`)) return;
    stopRef.current = false;
    setBusy(true);
    setProgress({ done: 0, total: list.length });
    try {
      // 배치 생성(이미지형)
      const br = await fetch("/api/stock/batch", {
        method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ storage_type: "image", default_product_name: list[0].name, default_exchange_location: supplier, purchase_date: purchaseDate || null }),
      });
      const bj = await br.json();
      if (!bj.ok) { toast.error("배치 생성 실패: " + bj.error); return; }
      const batch = { id: bj.batch.id as string, batch_no: bj.batch.batch_no as string };
      let done = 0;
      for (const it of list) {
        if (stopRef.current) break;
        const blob = await generateOne(it);
        const fd = new FormData();
        fd.append("file", blob, `${it.code}.png`);
        fd.append("batch_id", batch.id);
        fd.append("batch_no", batch.batch_no);
        fd.append("product_name", it.name);
        fd.append("coupon_code", it.code);
        fd.append("option_name", optionName);
        if (it.expiryDb) fd.append("expiry_date", it.expiryDb);
        fd.append("supplier", supplier);
        if (purchaseDate) fd.append("purchase_date", purchaseDate);
        if (unitCost) fd.append("unit_cost", unitCost);
        const res = await fetch("/api/stock/generated", { method: "POST", headers: AUTH, body: fd });
        const j = await res.json();
        if (!j.ok) toast.error(`${it.name}: ${j.error}`);
        done++;
        setProgress({ done, total: list.length });
      }
      toast[stopRef.current ? "info" : "success"](
        stopRef.current ? `중지됨 — ${done}건 등록` : `${done}건 생성·등록 완료 (배치 ${batch.batch_no}) — 재고 등록 탭에서 검수·승인·발행`,
      );
    } finally {
      setBusy(false);
      setProgress(null);
      stopRef.current = false;
    }
  };

  const list = items.length ? items : parseList(listText);

  const COORD_FIELDS: [keyof Coords, string][] = [
    ["prodX", "상품X"], ["prodY", "상품Y"], ["prodSize", "상품크기"],
    ["bcX", "바코드X"], ["bcY", "바코드Y"], ["bcW", "바코드W"], ["bcH", "바코드H"],
    ["expX", "유효X"], ["expY", "유효Y"], ["expFont", "유효pt"],
  ];
  const setC = (k: keyof Coords) => (n: number) => setCoords((c) => ({ ...c, [k]: n }));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        코드 상품을 <strong>우리 프레임의 기프티콘 이미지</strong>(상품이미지+상품명+바코드+유효기간)로 변환해 재고(검수대기)로 등록합니다.
        공급처 흔적 없이, 입력한 코드 수만큼 생성됩니다. (브라우저에서 합성 → 업로드)
      </p>

      {/* 1. 이미지 선택 */}
      <div className="grid gap-2 rounded-xl border border-border bg-secondary/40 p-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{templateName || "템플릿 프레임 이미지 선택"}</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && loadImage(e.target.files[0], setTemplateImg, setTemplateName)} />
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{productName2 || "상품 이미지 선택(선택)"}</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && loadImage(e.target.files[0], setProductImg, setProductName2)} />
        </label>
      </div>

      {/* 2. 공통 정보 */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-secondary/40 p-3">
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">매입처(증빙용)</span>
          <input className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="예: 센드비" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">옵션명(선택)</span>
          <input className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={optionName} onChange={(e) => setOptionName(e.target.value)} /></label>
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">매입일(선택)</span>
          <input type="date" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></label>
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">매입원가(선택)</span>
          <input inputMode="numeric" className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></label>
      </div>

      {/* 3. 입력 (리스트/엑셀) */}
      <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
        <div className="flex rounded-lg bg-secondary p-0.5 text-xs w-fit">
          {([["list", "리스트 붙여넣기"], ["excel", "엑셀 업로드"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} className={cn("rounded-md px-2.5 py-1 font-medium", mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>{label}</button>
          ))}
        </div>
        {mode === "list" ? (
          <>
            <textarea className="h-28 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-mono"
              placeholder={"상품명,코드,유효기간 (한 줄에 하나)\n세븐일레븐 3만원권,1234567890123,261231\n세븐일레븐 3만원권,2234567890123,261231"}
              value={listText} onChange={(e) => setListText(e.target.value)} />
            <button onClick={applyList} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-secondary">리스트 인식</button>
          </>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm w-fit">
            <Upload className="h-4 w-4" /> 엑셀(.xlsx) 선택 — 1행 머리글, [상품명·코드·유효기간]
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => onExcel(e.target.files?.[0] ?? null)} />
          </label>
        )}
        <p className="text-xs text-muted-foreground">인식된 항목 <strong className="text-foreground">{list.length}</strong>건</p>
      </div>

      {/* 4. 상품명 표시 (길이 가변 → 위치·크기 자유 조정 + 자동 축소) */}
      <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
        <p className="text-sm font-medium">상품명 표시 <span className="text-xs font-normal text-muted-foreground">(길이에 따라 위치·크기 자유 조정)</span></p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <CoordInput label="좌우(X)" value={coords.nameX} onChange={setC("nameX")} />
          <CoordInput label="상하(Y)" value={coords.nameY} onChange={setC("nameY")} />
          <CoordInput label="글자크기" value={coords.nameFont} onChange={setC("nameFont")} />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={nameAutoFit} onChange={(e) => setNameAutoFit(e.target.checked)} />
            긴 이름 자동 축소(폭 맞춤)
          </label>
          {nameAutoFit && <CoordInput label="최대폭" value={coords.nameMaxW} onChange={setC("nameMaxW")} />}
        </div>
        <p className="text-xs text-muted-foreground">짧은 이름은 설정한 글자크기 그대로, 긴 이름은 최대폭에 맞춰 자동으로 작아집니다. 미리보기로 확인하세요.</p>
      </div>

      {/* 5. 레이아웃 좌표(고급) */}
      <div className="rounded-xl border border-border bg-secondary/40 p-3">
        <button onClick={() => setCoordsOpen((v) => !v)} className="text-sm font-medium">레이아웃 좌표 {coordsOpen ? "▲" : "▼"} <span className="text-xs font-normal text-muted-foreground">(템플릿이 다르면 조정)</span></button>
        {coordsOpen && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
            {COORD_FIELDS.map(([k, label]) => (
              <CoordInput key={k} label={label} value={coords[k]} onChange={(n) => setCoords((c) => ({ ...c, [k]: n }))} />
            ))}
          </div>
        )}
      </div>

      {/* 5. 미리보기 + 실행 */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={preview} disabled={busy} className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm text-primary disabled:opacity-50">
          <ImageIcon className="h-4 w-4" /> 미리보기(첫 건)
        </button>
        <button onClick={run} disabled={busy || list.length === 0 || !templateImg} className="flex items-center gap-1 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {progress ? `생성·등록 ${progress.done}/${progress.total}` : `${list.length}건 생성·등록`}
        </button>
        {busy && <button onClick={() => { stopRef.current = true; }} className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">중지</button>}
      </div>

      {previewUrl && (
        <div className="rounded-xl border border-border bg-secondary/30 p-3">
          <p className="mb-2 text-xs text-muted-foreground">미리보기 (첫 번째 항목) — 좌표가 맞는지 확인하세요</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="미리보기" className="mx-auto max-h-[60vh] rounded-lg border border-border" />
        </div>
      )}
    </div>
  );
}
