import { Storage } from "@google-cloud/storage";

/**
 * GCP Cloud Storage 클라이언트 (서버 전용).
 * GCP_SA_KEY_B64 = 서비스계정 JSON 키를 base64 인코딩한 값.
 */
let cached: Storage | null = null;

function client(): Storage {
  if (typeof window !== "undefined") throw new Error("GCP storage 는 서버에서만 사용 가능");
  if (cached) return cached;
  const b64 = process.env.GCP_SA_KEY_B64;
  if (!b64) throw new Error("GCP_SA_KEY_B64 미설정");
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  cached = new Storage({ projectId: creds.project_id, credentials: creds });
  return cached;
}

export const OCR_BUCKET = process.env.GCP_OCR_BUCKET ?? "ocr_image_storage_vivacon";
export const GIFTICON_BUCKET = process.env.GCP_GIFTICON_BUCKET ?? "flexdeal-gifticon";

/** OCR 업로드 버킷에 이미지 저장. destPath 예: 20260622/20260622_01/uuid.jpg */
export async function uploadOcrImage(destPath: string, buffer: Buffer, contentType: string): Promise<string> {
  await client().bucket(OCR_BUCKET).file(destPath).save(buffer, { resumable: false, contentType });
  return destPath;
}

/** 임시 열람용 서명 URL (기본 2시간) */
export async function getSignedReadUrl(bucket: string, path: string, minutes = 120): Promise<string> {
  if (!path) return "";
  const [url] = await client()
    .bucket(bucket)
    .file(path)
    .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + minutes * 60_000 });
  return url;
}

/** 매입 증빙 이미지 업로드 (OCR 버킷의 proof/ 경로) */
export async function uploadProofImage(destPath: string, buffer: Buffer, contentType: string): Promise<string> {
  await client().bucket(OCR_BUCKET).file(destPath).save(buffer, { resumable: false, contentType });
  return destPath;
}

/** OCR 버킷 이미지 바이트 다운로드 (편집기 캔버스용 — 동일출처 프록시로 제공해 canvas 오염 방지) */
export async function getOcrImageBytes(path: string): Promise<{ buffer: Buffer; contentType: string }> {
  const file = client().bucket(OCR_BUCKET).file(path);
  const [buffer] = await file.download();
  let contentType = "image/jpeg";
  try { const [meta] = await file.getMetadata(); if (meta.contentType) contentType = String(meta.contentType); } catch { /* 메타 실패 무시 */ }
  return { buffer, contentType };
}

/** OCR 버킷 이미지 삭제 (best-effort) */
export async function deleteOcrImage(path: string): Promise<void> {
  if (!path) return;
  try { await client().bucket(OCR_BUCKET).file(path).delete(); } catch { /* 이미 없거나 권한 — 무시 */ }
}

/** 이미지형 발행: OCR버킷 → 기프티콘버킷 pending/상품명/YYMMDD/파일 로 복사 (발송 대상) */
export async function copyOcrToPending(
  ocrPath: string,
  productName: string,
  yymmdd: string,
  fileName: string,
): Promise<string> {
  const dest = `pending/${productName}/${yymmdd}/${fileName}`;
  await client().bucket(OCR_BUCKET).file(ocrPath).copy(client().bucket(GIFTICON_BUCKET).file(dest));
  return dest;
}

/** GIFTICON_BUCKET의 {folder}/{상품명}/{YYMMDD}/{파일명} 구조를 스캔해 상품명별로 집계 */
async function scanGcpImageFolder(
  folder: "pending" | "completed" | "exchanged",
): Promise<Array<{ product: string; total: number; dates: Array<{ date: string; count: number }> }>> {
  const [files] = await client()
    .bucket(GIFTICON_BUCKET)
    .getFiles({ prefix: `${folder}/`, maxResults: 10000 });

  const map = new Map<string, Map<string, number>>();
  for (const f of files) {
    const parts = f.name.split("/");
    // [folder, 상품명, YYMMDD, 파일명] 구조만 허용
    // · 4개 미만 또는 파일명 없음 → 디렉터리 마커
    // · 숨김파일(.keep, .DS_Store 등) → 폴더 생성 부산물
    // · 0바이트 → GCP 폴더 마커 객체
    if (parts.length < 4 || !parts[3]) continue;
    if (parts[3].startsWith(".")) continue;
    const size = parseInt((f.metadata as { size?: string }).size ?? "0", 10);
    if (size === 0) continue;
    const product = parts[1];
    const date = parts[2];
    if (!map.has(product)) map.set(product, new Map());
    const dm = map.get(product)!;
    dm.set(date, (dm.get(date) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([product, dm]) => {
      const dates = Array.from(dm.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return { product, total: dates.reduce((s, d) => s + d.count, 0), dates };
    })
    .sort((a, b) => b.total - a.total);
}

/** {folder}/{product}/{date}/ 폴더의 파일 목록 (모달 상세용) */
async function listGcpImageFiles(
  folder: "pending" | "completed",
  product: string,
  date: string,
): Promise<Array<{ name: string; path: string; timeCreated: string }>> {
  const prefix = `${folder}/${product}/${date}/`;
  const [files] = await client().bucket(GIFTICON_BUCKET).getFiles({ prefix });
  return files
    .filter((f) => {
      const parts = f.name.split("/");
      if (parts.length < 4 || !parts[3]) return false;
      if (parts[3].startsWith(".")) return false;
      const size = parseInt((f.metadata as { size?: string }).size ?? "0", 10);
      return size > 0;
    })
    .map((f) => ({
      name: f.name.split("/").pop() ?? f.name,
      path: f.name,
      timeCreated: (f.metadata as { timeCreated?: string }).timeCreated ?? "",
    }))
    .sort((a, b) => a.timeCreated.localeCompare(b.timeCreated));
}

/** 판매 대기 이미지 재고 (pending/) 상품별 집계 */
export const listPendingStock = () => scanGcpImageFolder("pending");

/** 알림톡 발송 완료 이미지 재고 (completed/) 상품별 집계 */
export const listCompletedStock = () => scanGcpImageFolder("completed");

/** 교환 처리 완료 이미지 재고 (exchanged/) 상품별 집계 */
export const listExchangedStock = () => scanGcpImageFolder("exchanged");

/** pending/ 특정 상품+날짜의 파일 목록 */
export const listPendingFiles = (product: string, date: string) =>
  listGcpImageFiles("pending", product, date);

/** completed/ 특정 상품+날짜의 파일 목록 */
export const listCompletedFiles = (product: string, date: string) =>
  listGcpImageFiles("completed", product, date);
