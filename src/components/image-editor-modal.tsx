"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Loader2, Square, Crop, Undo2, RotateCcw, Save, X } from "lucide-react";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };

type Mode = "mask" | "crop";

/**
 * 재고 쿠폰 이미지 편집기 — 유효기간 등 특정 영역 가리기(박스) + 자르기(크롭).
 * 저장 시 편집본으로 재고 이미지 교체(원본은 서버에서 original_image_path 로 보존).
 */
export function ImageEditorModal({
  registrationId,
  onClose,
  onSaved,
}: {
  registrationId: string;
  onClose: () => void;
  onSaved: (imageUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<string>(""); // 최초 로드 상태(초기화용)
  const historyRef = useRef<string[]>([]); // 되돌리기 스택(op 직전 상태)
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const baseRef = useRef<ImageData | null>(null); // 드래그 중 미리보기 복원용

  const [mode, setMode] = useState<Mode>("mask");
  const [maskColor, setMaskColor] = useState<"#ffffff" | "#000000">("#ffffff");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyLen, setHistoryLen] = useState(0);

  // 배경 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // 이미지 로드 (동일출처 프록시 → blob → canvas, 오염 방지)
  useEffect(() => {
    let objUrl = "";
    (async () => {
      try {
        const res = await fetch(`/api/stock/image-raw?id=${registrationId}`, { headers: AUTH, cache: "no-store" });
        if (!res.ok) { toast.error("이미지 로드 실패"); onClose(); return; }
        const blob = await res.blob();
        objUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          originalRef.current = canvas.toDataURL("image/png");
          historyRef.current = [];
          setHistoryLen(0);
          setLoading(false);
          URL.revokeObjectURL(objUrl);
        };
        img.onerror = () => { toast.error("이미지 디코드 실패"); onClose(); };
        img.src = objUrl;
      } catch (e) {
        toast.error("로드 오류: " + (e instanceof Error ? e.message : ""));
        onClose();
      }
    })();
    return () => { if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [registrationId, onClose]);

  const ctxOf = () => canvasRef.current?.getContext("2d") ?? null;

  const toPoint = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x: Math.max(0, Math.min(canvas.width, x)), y: Math.max(0, Math.min(canvas.height, y)) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (loading) return;
    const ctx = ctxOf(); const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = toPoint(e);
    baseRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !baseRef.current) return;
    const ctx = ctxOf(); if (!ctx) return;
    const s = dragRef.current; const p = toPoint(e);
    ctx.putImageData(baseRef.current, 0, 0);
    const x = Math.min(s.x, p.x), y = Math.min(s.y, p.y), w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
    if (mode === "mask") {
      ctx.fillStyle = maskColor === "#ffffff" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)";
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = Math.max(2, canvas0() / 300);
      ctx.setLineDash([canvas0() / 60, canvas0() / 60]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  };

  const canvas0 = () => canvasRef.current?.width ?? 800;

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current || !baseRef.current) return;
    const ctx = ctxOf(); const canvas = canvasRef.current;
    if (!ctx || !canvas) { dragRef.current = null; return; }
    const s = dragRef.current; const p = toPoint(e);
    dragRef.current = null;
    const base = baseRef.current; baseRef.current = null;
    ctx.putImageData(base, 0, 0); // 미리보기 제거, 원상복원
    const x = Math.round(Math.min(s.x, p.x)), y = Math.round(Math.min(s.y, p.y));
    const w = Math.round(Math.abs(p.x - s.x)), h = Math.round(Math.abs(p.y - s.y));
    if (w < 5 || h < 5) return; // 탭/미세 드래그 무시

    // op 직전 상태를 히스토리에 저장(되돌리기용)
    pushHistory();
    if (mode === "mask") {
      ctx.fillStyle = maskColor;
      ctx.fillRect(x, y, w, h);
    } else {
      const cropped = ctx.getImageData(x, y, w, h);
      canvas.width = w; canvas.height = h;
      ctx.putImageData(cropped, 0, 0);
    }
  };

  const pushHistory = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const h = historyRef.current;
    h.push(canvas.toDataURL("image/png"));
    if (h.length > 20) h.shift();
    setHistoryLen(h.length);
  };

  const loadDataUrl = useCallback((url: string) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d"); if (ctx) ctx.drawImage(img, 0, 0);
    };
    img.src = url;
  }, []);

  const undo = () => {
    const h = historyRef.current;
    if (!h.length) return;
    loadDataUrl(h.pop()!);
    setHistoryLen(h.length);
  };
  const reset = () => {
    if (!originalRef.current) return;
    loadDataUrl(originalRef.current);
    historyRef.current = []; setHistoryLen(0);
  };

  const save = async () => {
    const canvas = canvasRef.current; if (!canvas) return;
    setSaving(true);
    try {
      const blob: Blob | null = await new Promise((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.92));
      if (!blob) { toast.error("이미지 생성 실패"); return; }
      const fd = new FormData();
      fd.append("id", registrationId);
      fd.append("file", blob, "edited.jpg");
      const res = await fetch("/api/stock/replace-image", { method: "POST", headers: AUTH, body: fd });
      const json = await res.json();
      if (!json.ok) { toast.error("저장 실패: " + json.error); return; }
      toast.success(json.original_saved ? "편집본 저장 · 원본 보존됨" : "편집본 저장됨(원본보존 컬럼 미생성)");
      onSaved(json.image_url as string);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/90" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
        <div className="flex rounded-lg bg-white/10 p-0.5 text-sm">
          <button onClick={() => setMode("mask")} className={cn("flex items-center gap-1 rounded-md px-3 py-1.5 font-medium", mode === "mask" ? "bg-white text-slate-900" : "text-white/80")}>
            <Square className="h-4 w-4" /> 가리기
          </button>
          <button onClick={() => setMode("crop")} className={cn("flex items-center gap-1 rounded-md px-3 py-1.5 font-medium", mode === "crop" ? "bg-white text-slate-900" : "text-white/80")}>
            <Crop className="h-4 w-4" /> 자르기
          </button>
        </div>
        {mode === "mask" && (
          <div className="flex items-center gap-1">
            <button onClick={() => setMaskColor("#ffffff")} title="흰색으로 가리기"
              className={cn("h-8 w-8 rounded border-2", maskColor === "#ffffff" ? "border-primary" : "border-white/30", "bg-white")} />
            <button onClick={() => setMaskColor("#000000")} title="검정으로 가리기"
              className={cn("h-8 w-8 rounded border-2", maskColor === "#000000" ? "border-primary" : "border-white/30", "bg-black")} />
          </div>
        )}
        <button onClick={undo} disabled={historyLen === 0} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white disabled:opacity-40">
          <Undo2 className="h-4 w-4" /> 되돌리기
        </button>
        <button onClick={reset} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white">
          <RotateCcw className="h-4 w-4" /> 초기화
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={save} disabled={saving || loading} className="flex items-center gap-1 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 저장
          </button>
          <button onClick={onClose} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white">
            <X className="h-4 w-4" /> 닫기
          </button>
        </div>
      </div>

      {/* 안내 */}
      <p className="px-3 py-1.5 text-center text-xs text-white/70">
        {mode === "mask" ? "유효기간 등 가릴 영역을 드래그하세요." : "남길 영역을 드래그한 뒤 손을 떼면 잘립니다."} · 저장 후 카드에서 짧은 유효기간을 입력하세요.
      </p>

      {/* 캔버스 */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-3">
        {loading && <Loader2 className="h-8 w-8 animate-spin text-white" />}
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={cn("max-h-full max-w-full touch-none rounded-lg bg-white", loading && "hidden")}
          style={{ cursor: "crosshair" }}
        />
      </div>
    </div>
  );
}
