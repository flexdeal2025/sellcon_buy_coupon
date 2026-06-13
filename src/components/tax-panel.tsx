"use client";

import { useMemo, useState } from "react";
import { useRecords } from "@/hooks/use-records";
import { usePresets } from "@/hooks/use-presets";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadCSV } from "@/lib/csv";
import { formatKRW, formatUnitPrice, toDateInput } from "@/lib/utils";
import { formatSequenceRanges } from "@/lib/rotation";
import { EVIDENCE_TYPES } from "@/lib/constants";
import { Download } from "lucide-react";

const ALL = "__all__";

export function TaxPanel() {
  const { records } = useRecords();
  const { suppliers } = usePresets();

  const now = new Date();
  const firstOfMonth = toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(toDateInput());
  const [supplier, setSupplier] = useState<string>(ALL);
  const [evidence, setEvidence] = useState<string>(ALL);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (from && r.purchase_date < from) return false;
      if (to && r.purchase_date > to) return false;
      if (supplier !== ALL && r.supplier !== supplier) return false;
      if (evidence !== ALL && r.evidence_type !== evidence) return false;
      return true;
    });
  }, [records, from, to, supplier, evidence]);

  const total = filtered.reduce((s, r) => s + Number(r.total_price || 0), 0);

  // 매입처 필터 옵션 = 프리셋 + 데이터에 존재하는 매입처
  const supplierOptions = useMemo(() => {
    const set = new Set<string>([...suppliers, ...records.map((r) => r.supplier)]);
    return [...set].filter(Boolean).sort();
  }, [suppliers, records]);

  function exportCSV() {
    const rows = filtered.map((r) => ({
      purchase_date: r.purchase_date,
      supplier: r.supplier,
      product_name: r.product_name,
      ordered_quantity: r.ordered_quantity,
      received_quantity: r.received_quantity,
      unit_price: r.unit_price,
      total_price: r.total_price,
      account_email: r.account_email ?? "",
      evidence_type: r.evidence_type ?? "",
      status: r.status,
      lines: formatSequenceRanges(r.allocated_phone_ids),
      notes: r.notes ?? "",
    }));
    downloadCSV(`매입내역_${from}_${to}.csv`, rows, [
      { key: "purchase_date", label: "매입일" },
      { key: "supplier", label: "매입처" },
      { key: "product_name", label: "상품명" },
      { key: "ordered_quantity", label: "주문수량" },
      { key: "received_quantity", label: "입고수량" },
      { key: "unit_price", label: "매입단가" },
      { key: "total_price", label: "총매입액" },
      { key: "account_email", label: "계정이메일" },
      { key: "evidence_type", label: "증빙유형" },
      { key: "status", label: "상태" },
      { key: "lines", label: "사용회선" },
      { key: "notes", label: "메모" },
    ]);
  }

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">시작일</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">종료일</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">매입처</Label>
              <Select value={supplier} onValueChange={setSupplier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {supplierOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">증빙유형</Label>
              <Select value={evidence} onValueChange={setEvidence}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {EVIDENCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 합계 + 다운로드 */}
      <div className="flex items-center justify-between rounded-xl bg-primary px-4 py-3 text-primary-foreground">
        <div>
          <p className="text-xs opacity-90">{filtered.length}건 합계</p>
          <p className="text-xl font-bold tabular-nums">{formatKRW(total)}</p>
        </div>
        <Button variant="secondary" onClick={exportCSV} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" />
          CSV 다운로드
        </Button>
      </div>

      {/* 표 */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">매입일</th>
                <th className="px-3 py-2.5 font-medium">매입처</th>
                <th className="px-3 py-2.5 font-medium">상품</th>
                <th className="px-3 py-2.5 text-right font-medium">수량</th>
                <th className="px-3 py-2.5 text-right font-medium">단가</th>
                <th className="px-3 py-2.5 text-right font-medium">총액</th>
                <th className="px-3 py-2.5 font-medium">증빙</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-secondary/30">
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                    {r.purchase_date}
                  </td>
                  <td className="px-3 py-2.5">{r.supplier}</td>
                  <td className="max-w-[140px] truncate px-3 py-2.5">{r.product_name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.ordered_quantity}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatUnitPrice(r.unit_price)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                    {formatKRW(r.total_price)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {r.evidence_type ?? "—"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    조건에 맞는 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
