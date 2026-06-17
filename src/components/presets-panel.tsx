"use client";

import { useState } from "react";
import { usePresets } from "@/hooks/use-presets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

export function PresetsPanel() {
  const {
    suppliers,
    products,
    addSupplier,
    removeSupplier,
    addProduct,
    removeProduct,
  } = usePresets();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        매입 입력 화면에서 원터치로 선택할 매입처/상품명을 관리합니다. (모든 기기 공유)
      </p>
      <PresetCard
        title="매입처 프리셋"
        items={suppliers}
        onAdd={addSupplier}
        onRemove={removeSupplier}
        placeholder="예: 지에스쿠폰"
      />
      <PresetCard
        title="상품명 프리셋"
        items={products}
        onAdd={addProduct}
        onRemove={removeProduct}
        placeholder="예: 메가박스 2인패키지"
      />
    </div>
  );
}

function PresetCard({
  title,
  items,
  onAdd,
  onRemove,
  placeholder,
}: {
  title: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");

  function add() {
    if (!value.trim()) return;
    onAdd(value);
    setValue("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button onClick={add} size="icon" className="shrink-0">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((it) => (
            <span
              key={it}
              className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1.5 text-sm"
            >
              {it}
              <button
                onClick={() => onRemove(it)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="삭제"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {items.length === 0 && (
            <span className="text-sm text-muted-foreground">등록된 프리셋이 없습니다.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
