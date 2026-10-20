/*! Copyright 2026 Example — license header */
// ===== helpers =====

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function noDoc(x: any) {
  return x;
}

// 첫 줄 설명
// 둘째 줄 설명
export function lineDoc() {
  return 1;
}

/** 앞 블록 */
// 사이 주석
/**
 * 마지막 JSDoc 이 이긴다.
 */
export function lastJsdoc() {
  return 2;
}

/** Renders the copyright footer */
export function copyrightFooter() {
  return 3;
}

// 위 설명
/* 사이 블록 */
// 아래 설명
export function splitDoc() {
  return 4;
}
