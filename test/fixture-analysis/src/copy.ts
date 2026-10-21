// sumOrders 를 이름만 바꿔 복사한 것
export function totalOfItems(items: { price: number; qty: number }[], rate: number) {
  let sum = 0;
  for (const item of items) {
    if (item.qty <= 0) continue;
    sum += item.price * item.qty;
  }
  const after = sum - sum * rate;
  return after > 5000 ? Math.round(after) : Number(after.toFixed(2));
}

// 한 줄을 더 넣은 것
export function totalWithTax(items: { price: number; qty: number }[], rate: number) {
  let sum = 0;
  for (const item of items) {
    if (item.qty <= 0) continue;
    sum += item.price * item.qty;
  }
  const after = sum - sum * rate;
  console.log(after);
  return after > 5000 ? Math.round(after) : Number(after.toFixed(2));
}

// 모양은 다른 함수
export function describe(items: { name: string }[]) {
  return items.map((i) => i.name.toUpperCase()).filter(Boolean).join(', ');
}
