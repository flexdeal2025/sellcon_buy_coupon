import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// 순수 로직 유닛테스트. DB/네트워크 없는 함수만 대상으로 한다.
// @/* 별칭을 tsconfig 와 동일하게 매핑.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "src") },
  },
  test: {
    include: ["tests/**/*.test.{ts,mts,mjs}"],
    environment: "node",
  },
});
