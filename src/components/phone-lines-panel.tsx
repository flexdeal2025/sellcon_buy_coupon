"use client";

import { useState } from "react";
import { toast } from "sonner";
import { usePhoneLines } from "@/hooks/use-phone-lines";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { PhoneLine } from "@/lib/types";
import { Plus, Power, Pencil, Trash2, Loader2 } from "lucide-react";

export function PhoneLinesPanel() {
  const { lines, loading, upsert, update, remove } = usePhoneLines();
  const [editing, setEditing] = useState<PhoneLine | null>(null);
  const [adding, setAdding] = useState(false);

  const activeCount = lines.filter((l) => l.is_active).length;
  const nextSeq =
    lines.length > 0 ? Math.max(...lines.map((l) => l.sequence_number)) + 1 : 1;

  async function toggleActive(line: PhoneLine) {
    try {
      await update(line.id, { is_active: !line.is_active });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "변경 실패");
    }
  }

  async function handleDelete(line: PhoneLine) {
    if (!confirm(`#${line.sequence_number} 회선을 삭제할까요?`)) return;
    try {
      await remove(line.id);
      toast.success("삭제되었습니다.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제 실패");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-muted-foreground">보유 회선</p>
            <p className="text-2xl font-bold tabular-nums">
              {lines.length}개{" "}
              <span className="text-sm font-normal text-success">
                (활성 {activeCount})
              </span>
            </p>
          </div>
          <LineDialog
            open={adding}
            onOpenChange={setAdding}
            title="회선 추가"
            defaultSeq={nextSeq}
            onSubmit={async (data) => {
              await upsert(data);
              toast.success("회선이 추가되었습니다.");
              setAdding(false);
            }}
            trigger={
              <Button>
                <Plus className="h-4 w-4" />
                추가
              </Button>
            }
          />
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">회선 목록 (1~{nextSeq - 1 || 56}번)</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {lines.map((line) => (
              <div key={line.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums",
                    line.is_active
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {line.sequence_number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {line.alias || `회선 ${line.sequence_number}`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {line.phone_number || "번호 미등록"}
                  </p>
                </div>
                <button
                  onClick={() => toggleActive(line)}
                  className={cn(
                    "rounded-md p-2",
                    line.is_active ? "text-success" : "text-muted-foreground",
                  )}
                  aria-label="활성 토글"
                >
                  <Power className="h-4 w-4" />
                </button>
                <LineDialog
                  open={editing?.id === line.id}
                  onOpenChange={(o) => setEditing(o ? line : null)}
                  title={`#${line.sequence_number} 수정`}
                  defaultSeq={line.sequence_number}
                  initial={line}
                  onSubmit={async (data) => {
                    await update(line.id, data);
                    toast.success("수정되었습니다.");
                    setEditing(null);
                  }}
                  trigger={
                    <button className="rounded-md p-2 text-muted-foreground" aria-label="수정">
                      <Pencil className="h-4 w-4" />
                    </button>
                  }
                />
                <button
                  onClick={() => handleDelete(line)}
                  className="rounded-md p-2 text-muted-foreground hover:text-destructive"
                  aria-label="삭제"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {lines.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                회선이 없습니다. schema.sql 실행 시 1~56번이 자동 생성됩니다.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LineDialog({
  open,
  onOpenChange,
  title,
  defaultSeq,
  initial,
  onSubmit,
  trigger,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  defaultSeq: number;
  initial?: PhoneLine;
  onSubmit: (data: Partial<PhoneLine>) => Promise<void>;
  trigger: React.ReactNode;
}) {
  const [seq, setSeq] = useState(String(initial?.sequence_number ?? defaultSeq));
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [phone, setPhone] = useState(initial?.phone_number ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = Number(seq);
    if (!n || n < 1) {
      toast.error("순번을 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        sequence_number: n,
        alias: alias.trim() || null,
        phone_number: phone.trim() || null,
        is_active: initial?.is_active ?? true,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>순번 (sequence)</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={seq}
              onChange={(e) => setSeq(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>별칭 / 대역</Label>
            <Input
              placeholder="예: A대역, SKT-1"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>전화번호</Label>
            <Input
              inputMode="tel"
              placeholder="010-0000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">취소</Button>
          </DialogClose>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
