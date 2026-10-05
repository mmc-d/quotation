// Fake "المنتجات" sheet rows — same column layout loadSheet() expects:
// A code · B description · C price · D install cost · E purchase cost (USD).
// All codes/names/prices are synthetic; none of this is real company data.
'use strict';

const HEADER_ROW = ['كود', 'الوصف', 'السعر', 'أجرة التركيب', 'سعر الشراء (دولار)'];

const PRODUCTS = {
  GATEWAY: ['GW-100', 'بوابة التحكم الذكي ZigBee', '1500', '150', '40'],
  AC: ['AC-200', 'وحدة تحكم تكييف', '800', '80', '25'],
  FREE: ['FREE-1', 'هدية ترويجية', '0', '0', '0'],
  XSS: ['XSS-1', 'منتج تجريبي <img src=x onerror="window.__xssFired=true">', '100', '0', '10'],
};

function rows(extra = []) {
  return [HEADER_ROW, ...Object.values(PRODUCTS), ...extra];
}

module.exports = { HEADER_ROW, PRODUCTS, rows };
