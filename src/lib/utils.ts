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
