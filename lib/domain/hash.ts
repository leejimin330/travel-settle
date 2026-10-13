/** FNV-1a 32bit. 나머지 배분 시작점처럼 "결정적이지만 고르게" 필요한 곳에만 쓴다 */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
