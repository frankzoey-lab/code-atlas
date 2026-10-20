declare const socket: { emit(e: string, d?: unknown): void; on(e: string, f: () => void): void };

export function sendEvent(event: string, data?: unknown) {
  socket.emit(event, data);
}

export function receiveEvent(event: string, handler: () => void) {
  socket.on(event, handler);
}

export function joinRoom() {
  sendEvent('join-room', { room: 'a' });
  receiveEvent('user-change', () => {});
  receiveEvent('only-client-listens', () => {});
}
