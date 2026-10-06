/** AI-02 translation (product descriptions, messages) between Arabic and English. */
export function translateSystem(to: 'ar' | 'en'): string {
  const target = to === 'ar' ? 'Modern Standard Arabic' : 'English';
  return `Translate the user's text into ${target} for a Saudi smart-building / security-systems trading company.
Rules:
- Keep product codes, model numbers, units, numbers and brand names exactly as written.
- Use the usual trade terminology (e.g. NVR, PoE, IP camera → كاميرا IP) and keep line breaks and "|" separators.
- Bracketed placeholders like [phone] are redacted data — keep them unchanged.
- Output only the translation.`;
}

export function sandboxTranslate(text: string, to: 'ar' | 'en'): string {
  return `${to === 'ar' ? '[ترجمة تجريبية]' : '[sandbox translation]'} ${text}`;
}
