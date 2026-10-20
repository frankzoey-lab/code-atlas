import { Controller, Post, SubscribeMessage } from '../decorators';

declare const server: { to(room: string): { emit(e: string, d?: unknown): void } };

@Controller({ path: 'chat' })
export class ChatController {
  @Post('messages')
  create() {}
}

export class RoomGateway {
  @SubscribeMessage('join-room')
  join() {
    server.to('a').emit('user-change', []);
    server.to('a').emit('only-server-emits', []);
  }
}
