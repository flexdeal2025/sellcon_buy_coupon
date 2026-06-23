// GCP 스토리지 연결/권한 점검 (민감정보 미출력)
// 실행: node --env-file=.env.local scripts/inspect-gcp.mjs
// - OCR 버킷: 존재확인 + 쓰기/삭제 테스트(임시 파일)
// - 기프티콘(발송) 버킷: 존재확인만 (실 발송 버킷이라 쓰기 안 함)
import { Storage } from "@google-cloud/storage";

const b64 = process.env.GCP_SA_KEY_B64;
const ocrBucket = process.env.GCP_OCR_BUCKET;
const gifBucket = process.env.GCP_GIFTICON_BUCKET;

if (!b64 || !ocrBucket || !gifBucket) {
  console.error("❌ GCP_SA_KEY_B64 / GCP_OCR_BUCKET / GCP_GIFTICON_BUCKET 중 누락이 .env.local 에 있습니다.");
  process.exit(1);
}

let creds;
try {
  creds = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
} catch {
  console.error("❌ GCP_SA_KEY_B64 디코딩 실패 — base64 값을 다시 확인하세요.");
  process.exit(1);
}

console.log("프로젝트:", creds.project_id);
console.log("서비스계정:", creds.client_email);

const storage = new Storage({ projectId: creds.project_id, credentials: creds });

// 1) 버킷 존재 확인
for (const name of [ocrBucket, gifBucket]) {
  try {
    const [exists] = await storage.bucket(name).exists();
    console.log(`버킷 ${name}: ${exists ? "✅ 접근 OK" : "❌ 없음/권한없음"}`);
  } catch (e) {
    console.log(`버킷 ${name}: ❌ 오류 - ${e.message}`);
  }
}

// 2) OCR 버킷 쓰기/삭제 테스트 (임시 파일, 즉시 삭제)
try {
  const f = storage.bucket(ocrBucket).file("__conn_test__/ping.txt");
  await f.save("ok", { resumable: false, contentType: "text/plain" });
  console.log("OCR 버킷 쓰기: ✅ OK");
  await f.delete();
  console.log("OCR 버킷 삭제: ✅ OK (임시파일 정리됨)");
} catch (e) {
  console.log("OCR 버킷 쓰기/삭제: ❌ - " + e.message);
}

// 3) 기프티콘 버킷 pending 폴더 상위 몇 개만 (읽기 확인, 민감정보 아님)
try {
  const [files] = await storage.bucket(gifBucket).getFiles({ prefix: "pending/", maxResults: 3, autoPaginate: false });
  console.log(`기프티콘 버킷 pending/ 읽기: ✅ OK (샘플 ${files.length}개 경로 확인)`);
} catch (e) {
  console.log("기프티콘 버킷 읽기: ❌ - " + e.message);
}
