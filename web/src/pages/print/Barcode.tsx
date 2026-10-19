/** Minimal Code 128 (set B) barcode as SVG — replaces the old vue-barcode/JsBarcode dependency. */

// Bar patterns for values 0..106 (106 = stop), same table JsBarcode uses.
const BARS = [
  11011001100, 11001101100, 11001100110, 10010011000, 10010001100, 10001001100, 10011001000, 10011000100, 10001100100, 11001001000,
  11001000100, 11000100100, 10110011100, 10011011100, 10011001110, 10111001100, 10011101100, 10011100110, 11001110010, 11001011100,
  11001001110, 11011100100, 11001110100, 11101101110, 11101001100, 11100101100, 11100100110, 11101100100, 11100110100, 11100110010,
  11011011000, 11011000110, 11000110110, 10100011000, 10001011000, 10001000110, 10110001000, 10001101000, 10001100010, 11010001000,
  11000101000, 11000100010, 10110111000, 10110001110, 10001101110, 10111011000, 10111000110, 10001110110, 11101110110, 11010001110,
  11000101110, 11011101000, 11011100010, 11011101110, 11101011000, 11101000110, 11100010110, 11101101000, 11101100010, 11100011010,
  11101111010, 11001000010, 11110001010, 10100110000, 10100001100, 10010110000, 10010000110, 10000101100, 10000100110, 10110010000,
  10110000100, 10011010000, 10011000010, 10000110100, 10000110010, 11000010010, 11001010000, 11110111010, 11000010100, 10001111010,
  10100111100, 10010111100, 10010011110, 10111100100, 10011110100, 10011110010, 11110100100, 11110010100, 11110010010, 11011011110,
  11011110110, 11110110110, 10101111000, 10100011110, 10001011110, 10111101000, 10111100010, 11110101000, 11110100010, 10111011110,
  10111101110, 11101011110, 11110101110, 11010000100, 11010010000, 11010011100, 1100011101011,
];
const START_B = 104;
const STOP = 106;

export function code128B(text: string): string {
  const values = [...text].map((c) => {
    const code = c.charCodeAt(0);
    return code >= 32 && code <= 127 ? code - 32 : 0;
  });
  let sum = START_B;
  values.forEach((v, i) => (sum += v * (i + 1)));
  const all = [START_B, ...values, sum % 103, STOP];
  return all.map((v) => String(BARS[v])).join('');
}

export function Barcode({ value, height = 40, module = 1.4, className }: { value: string; height?: number; module?: number; className?: string }) {
  if (!value) return null;
  const bits = code128B(value);
  const quiet = 10;
  const width = (bits.length + quiet * 2) * module;
  const rects: { x: number; w: number }[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let j = i;
      while (j < bits.length && bits[j] === '1') j++;
      rects.push({ x: (i + quiet) * module, w: (j - i) * module });
      i = j;
    } else i++;
  }
  return (
    <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={value} shapeRendering="crispEdges">
      <rect width={width} height={height} fill="#fff" />
      {rects.map((r, k) => (
        <rect key={k} x={r.x} y={0} width={r.w} height={height} fill="#000" />
      ))}
    </svg>
  );
}
