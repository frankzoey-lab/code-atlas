import { Handler } from './handler';
import { StoreService } from './store.service';

class Helper {}

export class AppService {
  constructor(
    private readonly store: StoreService,
    private readonly handler: Handler,
  ) {}

  run() {
    this.store.save(1);
    this.handler.handle();
    return new Helper();
  }

  handle = () => this.run();
}
