import { OrderDto } from './dto';
export { type OrderDto as Dto } from './dto';

export interface Order { id: string; dto?: OrderDto }
