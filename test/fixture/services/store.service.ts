import { api } from '@/lib/api';
import { double } from '@/lib';

export class StoreService {
  save(x: number) {
    api.get();
    return double(x);
  }
}
