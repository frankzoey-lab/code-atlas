// interface 만 가져오는 순환 (type 표시 없음) → 실행할 때 사라지므로 import 순환이 아니다
import { Order } from './order';

export interface OrderDto { order: Order; note: string }
