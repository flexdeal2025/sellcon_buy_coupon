import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 숫자를 한국 원화 형식으로 포맷 (₩1,234,567) */
export function formatKRW(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "₩0";
  return "₩" + Math.round(value).toLocaleString("ko-KR");
}

/** 소수점을 포함할 수 있는 단가 포맷 (₩1,234.56) */
export function formatUnitPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "₩0";
  return (
    "₩" +
    value.toLocaleString("ko-KR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

/** YYYY-MM-DD 문자열 (로컬 기준) */
export function toDateInput(d: Date = new Date()): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

/** YYYY년 M월 표시 */
export function formatYearMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

/**
 * timestamptz(ISO·UTC 저장값) → KST 표시 문자열. 브라우저 타임존과 무관하게 항상 KST(UTC+9).
 * dateOnly=true 면 'YYYY-MM-DD', 아니면 'YYYY-MM-DD HH:mm'. (DATE 컬럼은 변환 불필요 — 그대로 표시)
 */
export function toKST(iso: string | null | undefined, dateOnly = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
  return dateOnly ? date : `${date} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
