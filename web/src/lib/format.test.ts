import { describe, expect, it } from 'vitest';
import { textLines } from './format';

describe('textLines', () => {
  it('splits on new lines and <br> tags', () => {
    expect(textLines('42 Marine Drive<br>Mumbai<BR />400002\nIndia')).toEqual(['42 Marine Drive', 'Mumbai', '400002', 'India']);
    expect(textLines(null)).toEqual(['']);
  });

  it('keeps other markup as plain text', () => {
    expect(textLines('<img src=x onerror=alert(1)><script>alert(1)</script>')).toEqual(['<img src=x onerror=alert(1)><script>alert(1)</script>']);
  });
});
