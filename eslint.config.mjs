import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // 데이터 fetch-on-mount, Realtime 구독, localStorage 하이드레이션은
    // effect 안에서 setState 가 불가피한 정당한 외부 동기화 패턴이므로
    // 빌드를 막지 않도록 경고로 완화합니다.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      // React Compiler 가 수동 useMemo 를 보존하지 못할 때의 힌트.
      // 정확성이 아닌 성능 힌트이므로 빌드를 막지 않습니다.
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
