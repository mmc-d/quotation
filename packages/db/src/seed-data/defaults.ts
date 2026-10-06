/** Defaults carried over from the legacy tool (index.html) — editable in Settings afterwards. */
export const DEFAULT_TECH_NOTES = [
  '[ متطلبات الموقع ]',
  '1. نقطة كهرباء 220V ونقطة شبكة (Data) لوحدة التحكم المركزية (Gateway).',
  '2. نقطة كهرباء لوحدة التحكم بالمكيف ضمن نطاق الرؤية المباشرة.',
  '3. كابلات CAT6 ومبدلات (PoE Switch) لتشغيل نظام الإنتركوم.',
  '',
  '[ تقنية النظام ]',
  '4. أجهزة المنزل الذكي تعمل على تقنية ZigBee / RF بدون الاعتماد على الإنترنت.',
  '5. نظام الإنتركوم يعمل بتقنية TCP/IP مع دعم تطبيق الجوال.',
  '6. لوحة الجرس الخارجية تعمل بتيار 220V مع نظام جرس داخلي مستقل.',
].join('\n');

/**
 * NB: the legacy quote terms and contract article 7 promise different warranties (owner checklist
 * item 8). Both are kept verbatim until the owner decides; change them in Settings.
 */
export const DEFAULT_TERMS = [
  '[ الدفع ]  50% عند التعاقد — 40% قبل الشحن — 10% بعد التشغيل والاستلام.',
  '[ التوريد ]  45 إلى 60 يوم عمل من استلام الدفعة الأولى وإقرار التفاصيل الفنية.',
  '[ الأسعار ]  تقديرية وتُراجع بعد المعاينة الفعلية — أي تعديل في النطاق يُعدَّل معه السعر.',
  '[ الضمان ]  سنة كاملة شاملة القطع والعمالة، وسنة ثانية على القطع فقط.',
  '[ الصلاحية ]  هذا العرض ساري لمدة 15 يوماً من تاريخ إصداره.',
  '[ النطاق ]  التوريد والتركيب والبرمجة الأولية والتسليم الفعلي.',
].join('\n');

export const DEFAULT_MESSAGE_TEMPLATES = [
  { key: 'quote_sent', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_quote_sent', variables: ['name', 'number', 'link'],
    body: 'مرحبًا {{name}}، نشكر اهتمامكم. عرض السعر رقم {{number}} من المدى المبارك جاهز للاطلاع والقبول عبر الرابط: {{link}}' },
  { key: 'quote_otp', channel: 'whatsapp', category: 'authentication', language: 'ar', providerTemplateName: 'mmc_otp', variables: ['code'],
    body: 'رمز التحقق لقبول عرض السعر: {{code}} — صالح لمدة 10 دقائق. لا تشاركه مع أحد.' },
  { key: 'contract_sign', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_contract_sign', variables: ['name', 'number', 'link'],
    body: 'مرحبًا {{name}}، العقد رقم {{number}} جاهز للتوقيع الإلكتروني عبر نفاذ: {{link}}' },
  { key: 'payment_request', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_payment_request', variables: ['name', 'number', 'amount', 'due', 'link'],
    body: 'مرحبًا {{name}}، طلب الدفع رقم {{number}} بمبلغ {{amount}} ريال مستحق بتاريخ {{due}}. للدفع: {{link}}' },
  { key: 'payment_reminder', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_payment_reminder', variables: ['name', 'number', 'amount', 'due', 'link'],
    body: 'تذكير: طلب الدفع رقم {{number}} بمبلغ {{amount}} ريال مستحق بتاريخ {{due}}. للدفع: {{link}} — شكرًا لكم.' },
  { key: 'payment_received', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_payment_received', variables: ['name', 'amount', 'number'],
    body: 'شكرًا {{name}}، تم استلام مبلغ {{amount}} ريال. رقم الفاتورة: {{number}}.' },
  { key: 'service_report', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_service_report', variables: ['name', 'number', 'link'],
    body: 'مرحبًا {{name}}، تم إنجاز أمر العمل رقم {{number}} من المدى المبارك. تقرير الخدمة: {{link}}' },
  { key: 'quote_sent', channel: 'email', category: 'utility', language: 'ar', providerTemplateName: null, variables: ['name', 'number', 'link'],
    body: 'مرحبًا {{name}}،\n\nعرض السعر رقم {{number}} جاهز للاطلاع والقبول:\n{{link}}\n\nمع التحية،\nالمدى المبارك للتجارة والحلول الذكية' },
];
