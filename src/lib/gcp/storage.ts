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
