/** Left is negative, right is positive. The field shows the magnitude. */
export function withSide(magnitude: number, side: -1 | 1): number {
  const size = Math.abs(magnitude);
  return side < 0 ? -size : size;
}
