/**
 * 객체 배열을 CSV 문자열로 변환하고 다운로드합니다.
 * Excel 한글 깨짐 방지를 위해 UTF-8 BOM 을 추가합니다.
 */
export function downloadCSV(
  filename: string,
  rows: Record<string, string | number | null | undefined>[],
  headers?: { key: string; label: string }[],
) {
  if (rows.length === 0) {
    rows = [{}];
  }
  const keys = headers ? headers.map((h) => h.key) : Object.keys(rows[0]);
  const labels = headers ? headers.map((h) => h.label) : keys;

  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [
    labels.map(escape).join(","),
    ...rows.map((row) => keys.map((k) => escape(row[k])).join(",")),
  ];

  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
