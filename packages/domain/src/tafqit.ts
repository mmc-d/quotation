/**
 * Amount in Arabic words (تفقيط) for contracts and invoices — a faithful port of the legacy
 * `tafqit()` in index.html; the parity test runs both on the same inputs. Takes SAR (not halalas)
 * to keep the legacy signature; use `tafqitHalalas` from integer amounts.
 */
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
const SCALES = [
  { one: '', two: '', plural: '' },
  { one: 'ألف', two: 'ألفان', plural: 'آلاف' },
  { one: 'مليون', two: 'مليونان', plural: 'ملايين' },
  { one: 'مليار', two: 'ملياران', plural: 'مليارات' },
];

function three(n: number): string {
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h] as string);
  if (rem) {
    if (rem < 20) parts.push(ONES[rem] as string);
    else {
      const o = rem % 10;
      const t = Math.floor(rem / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : (TENS[t] as string));
    }
  }
  return parts.join(' و');
}

function convert(num: number): string {
  if (num === 0) return 'صفر';
  const groups: number[] = [];
  while (num > 0) {
    groups.push(num % 1000);
    num = Math.floor(num / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] as number;
    if (g === 0) continue;
    const s = SCALES[i] as (typeof SCALES)[number];
    if (i === 0) words.push(three(g));
    else if (g === 1) words.push(s.one);
    else if (g === 2) words.push(s.two);
    else if (g <= 10) words.push(`${three(g)} ${s.plural}`);
    else words.push(`${three(g)} ${s.one}`);
  }
  return words.join(' و');
}

export function tafqit(amount: number): string {
  amount = Math.round((amount + Number.EPSILON) * 100) / 100;
  const riyals = Math.floor(amount);
  const halalas = Math.round((amount - riyals) * 100);
  let result = `${convert(riyals)} ريال سعودي`;
  if (halalas > 0) result += ` و${convert(halalas)} هللة`;
  return result;
}

export function tafqitHalalas(h: number): string {
  const riyals = Math.floor(h / 100);
  const halalas = h % 100;
  let result = `${convert(riyals)} ريال سعودي`;
  if (halalas > 0) result += ` و${convert(halalas)} هللة`;
  return result;
}
