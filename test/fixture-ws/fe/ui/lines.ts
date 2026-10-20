import { emitAsMaster } from './role';

// 래퍼를 다른 파일에서 import 해 부르는 경우
export function syncAngles() {
  emitAsMaster('space-attribute:angles', []);
}
