import { SubscribeMessage } from '../decorators';

declare class ClientProxy {
  emit(e: string, d?: unknown): void;
}

export class LinesGateway {
  constructor(private readonly client: ClientProxy) {}

  @SubscribeMessage('space-attribute:lines')
  lines() {
    this.client.emit('order.created', {});
  }
}

export class AnglesGateway {
  @SubscribeMessage('space-attribute:angles')
  angles() {}
}
