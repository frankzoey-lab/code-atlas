import { Controller, Get, SubscribeMessage } from './decorators';

@Controller('v1')
export class UsersController {
  @Get('users')
  list() {}

  @Get('users/:id')
  one() {}

  @Get('archive/:year?/:month?')
  archive() {}
}

declare class Server {
  emit(e: string, d?: unknown): void;
  to(r: string): { emit(e: string, d?: unknown): void };
}

export class PingGateway {
  io!: Server;

  @SubscribeMessage('ping-me')
  ping() {
    this.io.emit('pong-me');
  }
}
