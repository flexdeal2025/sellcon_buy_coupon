"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { useRecords } from "@/hooks/use-records";
import { usePhoneLines } from "@/hooks/use-phone-lines";
import { usePresets } from "@/hooks/use-presets";
import { useWorker } from "@/hooks/use-worker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LineSelector } from "@/components/line-selector";
import { WorkerPicker } from "@/components/worker-picker";
import { reconcile, type CalcSource } from "@/lib/calc";
import { formatKRW, formatUnitPrice, toDateInput } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { EVIDENCE_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ArrowLeft, Calculator, Save, Loader2 } from "lucide-react";

export default function EditPurchasePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { records, update } = useRecords();
  const { lines } = usePhoneLines();
  const { suppliers, products } = usePresets();
  const { worker } = useWorker();

  // 원본 레코드
  const record = useMemo(() => records.find((r) => r.id === id) ?? null, [records, id]);

  // 폼 상태 — record 로드 후 초기화 (초기값은 record 또는 빈값)
  const initialized = useRef(false);

  const [date, setDate] = useState(toDateInput());
  const [supplier, setSupplier] = useState("");
  const [productName, setProductName] = useState("");
  const [orderedQty, setOrderedQty] = useState<string>("");
  const [limitPer, setLimitPer] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [totalPrice, setTotalPrice] = useState<string>("");
  const [accountEmail, setAccountEmail] = useState("");
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [showProductSuggestions, setShowProductSuggestions] = useState(false);

  // record 로드 되면 한 번만 초기화
  if (record && !initialized.current) {
    initialized.current = true;
    setDate(record.purchase_date ?? toDateInput());
    setSupplier(record.supplier ?? "");
    setProductName(record.product_name ?? "");
    setOrderedQty(record.ordered_quantity ? String(record.ordered_quantity) : "");
    setLimitPer(record.limit_per_number ? String(record.limit_per_number) : "");
    setUnitPrice(record.unit_price ? String(record.unit_price) : "");
    setTotalPrice(record.total_price ? String(record.total_price) : "");
    setAccountEmail(record.account_email ?? "");
    setEvidence(record.evidence_type ?? "");
    setNotes(record.notes ?? "");
    setSelectedLines(record.allocated_phone_ids ?? []);
  }

  const qtyNum = Number(orderedQty) || 0;
  const limitNum = Number(limitPer) || 0;

  // 상품명 자동완성
  const productSuggestions = useMemo(() => {
    const q = productName.toLowerCase().trim();
    if (!q) return products.slice(0, 12);
    return products.filter((p) => p.toLowerCase().includes(q)).slice(0, 12);
  }, [products, productName]);

  // 양방향 계산기
  function recompute(q: number, u: number, t: number, source: CalcSource) {
    const { unitPrice: nu, totalPrice: nt } = reconcile(q, u, t, source);
    setUnitPrice(nu ? String(nu) : "");
    setTotalPrice(nt ? String(nt) : "");
  }

  function onQtyChange(v: string) {
    setOrderedQty(v);
    const q = Number(v) || 0;
    if (unitPrice) recompute(q, Number(unitPrice) || 0, Number(totalPrice) || 0, "unit");
    else if (totalPrice)
      recompute(q, Number(unitPrice) || 0, Number(totalPrice) || 0, "total");
  }
  function onUnitChange(v: string) {
    setUnitPrice(v);
    recompute(qtyNum, Number(v) || 0, Number(totalPrice) || 0, "unit");
  }
  function onTotalChange(v: string) {
    setTotalPrice(v);
    recompute(qtyNum, Number(unitPrice) || 0, Number(v) || 0, "total");
  }

  const canSave = supplier.trim() && productName.trim() && qtyNum > 0 && !saving;

  async function handleSave() {
    if (!canSave || !record) return;
    if (!isSupabaseConfigured) {
      toast.error("Supabase 환경변수가 설정되지 않아 저장할 수 없습니다.");
      return;
    }
    setSaving(true);
    try {
      await update(record.id, {
        purchase_date: date,
        supplier: supplier.trim(),
        product_name: productName.trim(),
        ordered_quantity: qtyNum,
        limit_per_number: limitNum,
        allocated_phone_ids: selectedLines,
        unit_price: Number(unitPrice) || 0,
        total_price: Number(totalPrice) || 0,
        account_email: accountEmail.trim() || null,
        evidence_type: evidence || null,
        notes: notes.trim() || null,
        status_updated_by: worker,
      });
      toast.success("매입 정보가 수정되었습니다.");
      router.back();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
      setSaving(false);
    }
  }

  // 로딩 중
  if (records.length === 0) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // 없는 ID
  if (!record) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          뒤로
        </Button>
        <p className="text-sm text-destructive">해당 매입 건을 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold">매입 수정</h1>
        </div>
        <WorkerPicker />
      </div>

      {/* 매입처 / 상품 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">매입처 · 상품</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>매입처</Label>
            <ChipRow items={suppliers} active={supplier} onPick={setSupplier} />
            <Input
              placeholder="매입처명 입력"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>상품명</Label>
            <div className="relative">
              <Input
                placeholder="키워드 입력 (예: cu, 스타벅스)"
                value={productName}
                onChange={(e) => {
                  setProductName(e.target.value);
                  setShowProductSuggestions(true);
                }}
                onFocus={() => setShowProductSuggestions(true)}
                onBlur={() => setTimeout(() => setShowProductSuggestions(false), 150)}
              />
              {showProductSuggestions && productSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border bg-background shadow-lg">
                  {productSuggestions.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={cn(
                        "w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary",
                        productName === p && "bg-primary/10 font-medium text-primary",
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setProductName(p);
                        setShowProductSuggestions(false);
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">매입일</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 수량 & 양방향 계산기 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4" />
            수량 · 단가 계산기
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qty">주문수량</Label>
              <Input
                id="qty"
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={orderedQty}
                onChange={(e) => onQtyChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit">번호당 제한</Label>
              <Input
                id="limit"
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={limitPer}
                onChange={(e) => setLimitPer(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="unit">매입단가</Label>
              <Input
                id="unit"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={unitPrice}
                onChange={(e) => onUnitChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="total">총 매입액</Label>
              <Input
                id="total"
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={totalPrice}
                onChange={(e) => onTotalChange(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">
              단가 {formatUnitPrice(Number(unitPrice) || 0)} × {qtyNum}개
            </span>
            <span className="font-bold tabular-nums">
              = {formatKRW(Number(totalPrice) || 0)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 회선 할당 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">회선 할당</CardTitle>
        </CardHeader>
        <CardContent>
          <LineSelector
            lines={lines}
            value={selectedLines}
            onChange={setSelectedLines}
          />
        </CardContent>
      </Card>

      {/* 부가 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">증빙 · 메모</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">계정 이메일</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              placeholder="account@example.com"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>증빙 유형</Label>
            <Select value={evidence} onValueChange={setEvidence}>
              <SelectTrigger>
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {EVIDENCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">메모</Label>
            <Textarea
              id="notes"
              placeholder="특이사항"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 저장 버튼 */}
      <div className="sticky bottom-20 z-20 sm:bottom-2">
        <Button
          size="xl"
          className={cn("w-full shadow-lg", !canSave && "opacity-60")}
          disabled={!canSave}
          onClick={handleSave}
        >
          {saving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Save className="h-5 w-5" />
          )}
          수정 저장 ({formatKRW(Number(totalPrice) || 0)})
        </Button>
      </div>
    </div>
  );
}

function ChipRow({
  items,
  active,
  onPick,
}: {
  items: string[];
  active: string;
  onPick: (v: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="-mx-1 flex flex-wrap gap-2 px-1">
      {items.map((it) => (
        <button
          key={it}
          type="button"
          onClick={() => onPick(it)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
            active === it
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:border-primary/40",
          )}
        >
          {it}
        </button>
      ))}
    </div>
  );
}
