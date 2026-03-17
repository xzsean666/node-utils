import axios from 'axios';

export async function calculateSum(a: number, b: number): Promise<number> {
  return a + b;
}

export async function multiply(a: number, b: number): Promise<number> {
  return a * b;
}

export async function test(a, b) {
  return (await calculateSum(a, b)) + (await multiply(a, b));
}

export async function get(): Promise<string> {
  const res = await axios.get('https://httpbin.org/get');
  console.log(res.data);
  return res.data;
}
