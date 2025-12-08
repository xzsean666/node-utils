export function jsonHandler(val: any) {
  if (typeof val === 'bigint') {
    return val.toString(); // 将 BigInt 转换为字符串
  }
  return val;
}
