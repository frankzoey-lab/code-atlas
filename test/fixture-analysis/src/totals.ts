import { label } from './labels';

export function sumOrders(orders: { price: number; qty: number }[], discount: number) {
  let total = 0;
  for (const order of orders) {
    if (order.qty <= 0) continue;
    total += order.price * order.qty;
  }
  const discounted = total - total * discount;
  return discounted > 1000 ? Math.round(discounted) : Number(discounted.toFixed(2));
}

export function isEven(n: number): boolean {
  return n === 0 ? true : isOdd(n - 1);
}

export function isOdd(n: number): boolean {
  return n === 0 ? false : isEven(n - 1);
}

export function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

export const title = () => label('total');
