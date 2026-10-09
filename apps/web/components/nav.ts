/** Every staff route, grouped. `perm` hides entries the API would refuse anyway. */
export interface NavItem { href: string; label: string; en: string; perm?: string; icon: string }
export interface NavGroup { label: string; en: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'الرئيسية', en: 'Home', items: [{ href: '/', label: 'لوحة القيادة', en: 'Cockpit', icon: 'LayoutDashboard', perm: 'quote.read' }] },
  {
    label: 'المبيعات', en: 'Sales', items: [
      { href: '/quotes', label: 'عروض الأسعار', en: 'Quotes', icon: 'FileText', perm: 'quote.read' },
      { href: '/contracts', label: 'العقود', en: 'Contracts', icon: 'FileSignature', perm: 'contract.read' },
      { href: '/customers', label: 'العملاء', en: 'Customers', icon: 'Building2', perm: 'party.read' },
      { href: '/products', label: 'المنتجات', en: 'Products', icon: 'Package', perm: 'product.read' },
      { href: '/products/price-lists', label: 'قوائم الأسعار', en: 'Price lists', icon: 'Tags', perm: 'product.read' },
      { href: '/ai/boq', label: 'من جدول الكميات إلى عرض (ذكاء اصطناعي)', en: 'BOQ → quote (AI)', icon: 'Sparkles', perm: 'ai.use' },
    ],
  },
  {
    label: 'إدارة العملاء', en: 'CRM', items: [
      { href: '/crm/leads', label: 'العملاء المحتملون', en: 'Leads', icon: 'UserPlus', perm: 'lead.read' },
      { href: '/crm/pipeline', label: 'مسار الفرص', en: 'Pipeline', icon: 'KanbanSquare', perm: 'opportunity.read' },
      { href: '/crm/tasks', label: 'مهامي', en: 'My tasks', icon: 'ListChecks', perm: 'activity.read' },
      { href: '/crm/inbox', label: 'صندوق الرسائل', en: 'Inbox', icon: 'MessagesSquare', perm: 'message.read' },
      { href: '/crm/targets', label: 'المستهدفات', en: 'Targets', icon: 'Target', perm: 'report.sales' },
    ],
  },
  {
    label: 'المشاريع والخدمة', en: 'Projects & service', items: [
      { href: '/projects', label: 'المشاريع', en: 'Projects', icon: 'FolderKanban', perm: 'project.read' },
      { href: '/field/dispatch', label: 'لوحة التوزيع', en: 'Dispatch board', icon: 'CalendarRange', perm: 'workorder.dispatch' },
      { href: '/field/work-orders', label: 'أوامر العمل', en: 'Work orders', icon: 'ClipboardList', perm: 'workorder.read' },
      { href: '/field/tickets', label: 'بلاغات الأعطال', en: 'Service calls', icon: 'LifeBuoy', perm: 'ticket.read' },
      { href: '/field/assets', label: 'الأجهزة المركبة', en: 'Installed devices', icon: 'Cpu', perm: 'asset.read' },
      { href: '/service/agreements', label: 'عقود الصيانة', en: 'Service agreements', icon: 'ShieldCheck', perm: 'agreement.read' },
      { href: '/service/reports', label: 'تقارير الخدمة', en: 'Service reports', icon: 'Gauge', perm: 'agreement.read' },
      { href: '/iot', label: 'تنبيهات الأجهزة (IoT)', en: 'Device alerts (IoT)', icon: 'Radio', perm: 'asset.read' },
      { href: '/kb', label: 'قاعدة المعرفة', en: 'Knowledge base', icon: 'BookOpen', perm: 'kb.read' },
      { href: '/tech', label: 'يومي (الفني)', en: 'My day (technician)', icon: 'Smartphone', perm: 'workorder.write' },
    ],
  },
  {
    label: 'المشتريات والمخزون', en: 'Purchasing & stock', items: [
      { href: '/inventory', label: 'المخزون', en: 'Stock', icon: 'Warehouse', perm: 'inventory.read' },
      { href: '/purchasing/requests', label: 'طلبات المواد', en: 'Material requests', icon: 'ClipboardCheck', perm: 'purchase.read' },
      { href: '/purchasing/rfqs', label: 'طلبات عروض الأسعار', en: 'RFQs', icon: 'FileQuestion', perm: 'purchase.read' },
      { href: '/purchasing/orders', label: 'أوامر الشراء', en: 'Purchase orders', icon: 'ShoppingCart', perm: 'purchase.read' },
      { href: '/purchasing/bills', label: 'فواتير المشتريات', en: 'Supplier bills', icon: 'ReceiptText', perm: 'purchase.read' },
      { href: '/purchasing/shipments', label: 'الشحنات المستوردة', en: 'Import shipments', icon: 'Ship', perm: 'purchase.read' },
      { href: '/inventory/transfers', label: 'التحويلات المخزنية', en: 'Stock transfers', icon: 'ArrowLeftRight', perm: 'inventory.write' },
      { href: '/inventory/counts', label: 'الجرد', en: 'Stock counts', icon: 'ListOrdered', perm: 'inventory.count' },
      { href: '/inventory/opening', label: 'الرصيد الافتتاحي', en: 'Opening stock', icon: 'PackagePlus', perm: 'inventory.count' },
    ],
  },
  {
    label: 'المالية', en: 'Finance', items: [
      { href: '/finance/requests', label: 'طلبات الدفع', en: 'Payment requests', icon: 'HandCoins', perm: 'billing.read' },
      { href: '/finance/invoices', label: 'الفواتير', en: 'Invoices', icon: 'Receipt', perm: 'invoice.read' },
      { href: '/finance/vouchers', label: 'سندات القبض والصرف', en: 'Receipt & payment vouchers', icon: 'FileStack', perm: 'voucher.read' },
      { href: '/finance/aging', label: 'أعمار الذمم', en: 'AR aging', icon: 'Hourglass', perm: 'invoice.read' },
      { href: '/purchasing/bills?view=payables', label: 'المستحق للموردين', en: 'Payables', icon: 'Banknote', perm: 'payment.record' },
    ],
  },
  {
    label: 'التقارير', en: 'Reports', items: [
      { href: '/reports', label: 'تقارير المبيعات', en: 'Sales reports', icon: 'BarChart3', perm: 'report.sales' },
      { href: '/reports/finance', label: 'التقارير المالية', en: 'Finance dashboard', icon: 'Wallet', perm: 'report.finance' },
      { href: '/reports/projects', label: 'ربحية المشاريع', en: 'Project profitability', icon: 'TrendingUp', perm: 'report.finance' },
      { href: '/commissions', label: 'العمولات والحوافز', en: 'Commissions & incentives', icon: 'BadgePercent', perm: 'commission.read' },
    ],
  },
  {
    label: 'الموارد البشرية', en: 'HR', items: [
      { href: '/hr/employees', label: 'الموظفون', en: 'Employees', icon: 'IdCard', perm: 'hr.read' },
      { href: '/hr/offers', label: 'العروض الوظيفية', en: 'Job offers', icon: 'FileUser', perm: 'hr.read' },
      { href: '/hr/leaves', label: 'الإجازات', en: 'Leave', icon: 'CalendarCheck', perm: 'hr.read' },
      { href: '/hr/payroll', label: 'مسير الرواتب', en: 'Payroll', icon: 'Wallet', perm: 'hr.read' },
      { href: '/hr/me', label: 'إجازاتي وطلباتي', en: 'My leave', icon: 'CalendarHeart' },
    ],
  },
  {
    label: 'الإعدادات', en: 'Settings', items: [
      { href: '/settings/company', label: 'بيانات المنشأة', en: 'Company', icon: 'Landmark', perm: 'admin.settings' },
      { href: '/settings/users', label: 'المستخدمون والصلاحيات', en: 'Users & roles', icon: 'Users', perm: 'admin.users' },
      { href: '/settings/documents', label: 'المستندات والترقيم', en: 'Documents', icon: 'Files', perm: 'admin.settings' },
      { href: '/settings/calendar', label: 'تقويم العمل', en: 'Work calendar', icon: 'CalendarDays', perm: 'admin.settings' },
      { href: '/settings/audit', label: 'سجل التدقيق', en: 'Audit log', icon: 'ShieldCheck', perm: 'admin.audit' },
      { href: '/settings/security', label: 'أمان حسابي', en: 'My security', icon: 'KeyRound' },
      { href: '/settings/ai', label: 'الذكاء الاصطناعي', en: 'AI & tokens', icon: 'Bot' },
    ],
  },
];
