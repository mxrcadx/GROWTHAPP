// Age: red (young/leading edge) -> orange -> yellow -> blue (old/trailing edge)
export function ageColor(age: number, maxAge: number): [number, number, number, number] {
  const t = maxAge > 0 ? Math.min(1, age / maxAge) : 0;
  let r: number, g: number, b: number;
  if (t < 0.33) {
    // Bright red (#FF3300) -> orange (#FF8800)
    const s = t / 0.33;
    r = 255;
    g = Math.round(51 + s * 85);  // 51 -> 136
    b = Math.round(0 + s * 0);
  } else if (t < 0.66) {
    // Orange (#FF8800) -> yellow (#FFCC00)
    const s = (t - 0.33) / 0.33;
    r = 255;
    g = Math.round(136 + s * 68); // 136 -> 204
    b = 0;
  } else {
    // Yellow (#FFCC00) -> blue (#3366FF)
    const s = (t - 0.66) / 0.34;
    r = Math.round(255 - s * 204); // 255 -> 51
    g = Math.round(204 - s * 102); // 204 -> 102
    b = Math.round(0 + s * 255);   // 0 -> 255
  }
  return [r, g, b, 220];
}
