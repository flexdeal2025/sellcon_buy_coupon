"use client";

import { useLocalStorage } from "./use-local-storage";
import { LS_KEYS, DEFAULT_WORKERS } from "@/lib/constants";

/**
 * 현재 작업자(부부 중 누구인지)를 localStorage 에 기억합니다.
 * 상태 변경/입고 로그에 작업자명을 자동으로 기록하는 데 사용됩니다.
 */
export function useWorker() {
  const [worker, setWorker, hydrated] = useLocalStorage<string>(
    LS_KEYS.worker,
    DEFAULT_WORKERS[0],
  );
  return { worker, setWorker, hydrated };
}
