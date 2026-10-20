declare const socketClient: { socket?: { emit(e: string, d?: unknown): void; io: { on(e: string, f: () => void): void } } };

// event 를 매개변수로 받아 그대로 emit 하는 래퍼
export const emitAsMaster = <E extends string>(event: E, payload: unknown): boolean => {
  socketClient.socket?.emit(event, payload);
  return true;
};

export function syncLines() {
  emitAsMaster('space-attribute:lines', []);
  socketClient.socket?.io.on('close', () => {});
}
