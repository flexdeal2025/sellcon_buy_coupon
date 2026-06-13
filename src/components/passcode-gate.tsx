"use client";

import { useEffect, useRef, useState } from "react";
import { Delete, LockKeyhole } from "lucide-react";
import { LS_KEYS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";

/**
 * 앱 최초 진입 시 4자리 Passcode 차단막.
 * 인증 성공 시 localStorage 에 세션을 저장하여 재방문 시 자동 통과합니다.
 */
export function PasscodeGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [digits, setDigits] = useState("");
  const [error, setError] = useState(false);
  const shakeRef = useRef<HTMLDivElement>(null);

  // 세션 복원
  useEffect(() => {
    try {
      const ok = window.localStorage.getItem(LS_KEYS.passcodeOk);
      if (ok === PASSCODE) setAuthed(true);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  // 4자리 입력 완료 시 검증
  useEffect(() => {
    if (digits.length !== 4) return;
    if (digits === PASSCODE) {
      try {
        window.localStorage.setItem(LS_KEYS.passcodeOk, PASSCODE);
      } catch {
        /* ignore */
      }
      setAuthed(true);
    } else {
      setError(true);
      setTimeout(() => {
        setDigits("");
        setError(false);
      }, 600);
    }
  }, [digits]);

  function press(n: string) {
    setDigits((d) => (d.length >= 4 ? d : d + n));
  }
  function backspace() {
    setDigits((d) => d.slice(0, -1));
  }

  if (!ready) {
    return <div className="min-h-screen bg-background" />;
  }

  if (authed) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LockKeyhole className="h-8 w-8" />
        </div>
        <h1 className="mt-2 text-xl font-bold">기프티콘 매입 관리</h1>
        <p className="text-sm text-muted-foreground">4자리 암호를 입력하세요</p>
      </div>

      {/* 점 표시 */}
      <div
        ref={shakeRef}
        className={cn(
          "my-8 flex gap-4",
          error && "animate-[shake_0.4s_ease-in-out]",
        )}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-4 w-4 rounded-full border-2 transition-colors",
              error
                ? "border-destructive bg-destructive"
                : i < digits.length
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/40",
            )}
          />
        ))}
      </div>

      {/* 키패드 */}
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
          <KeypadButton key={n} onClick={() => press(n)}>
            {n}
          </KeypadButton>
        ))}
        <div />
        <KeypadButton onClick={() => press("0")}>0</KeypadButton>
        <KeypadButton onClick={backspace} aria-label="지우기">
          <Delete className="h-6 w-6" />
        </KeypadButton>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%,60% { transform: translateX(-8px); }
          40%,80% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}

function KeypadButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="flex h-16 items-center justify-center rounded-2xl bg-secondary text-2xl font-semibold text-secondary-foreground transition-all active:scale-95 active:bg-accent"
      {...props}
    >
      {children}
    </button>
  );
}
