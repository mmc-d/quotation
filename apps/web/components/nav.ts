/** Every staff route, grouped. `perm` hides entries the API would refuse anyway. */
export interface NavItem { href: string; label: string; en: string; perm?: string; icon: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'الرئيسية', items: [{ href: '/', label: 'لوحة القيادة', en: 'Cockpit', icon: 'LayoutDashboard', perm: 'quote.read' }] },
  {
    label: 'المبيعات', items: [
      { href: '/quotes', label: 'عروض الأسعار', en: 'Quotes', icon: 'FileText', perm: 'quote.read' },
      { href: '/contracts', label: 'العقود', en: 'Contracts', icon: 'FileSignature', perm: 'contract.read' },
      { href: '/customers', label: 'العملاء', en: 'Customers', icon: 'Building2', perm: 'party.read' },
      { href: '/products', label: 'المنتجات', en: 'Products', icon: 'Package', perm: 'product.read' },
    ],
  },
  {
    label: 'إدارة العملاء', items: [
      { href: '/crm/leads', label: 'العملاء المحتملون', en: 'Leads', icon: 'UserPlus', perm: 'lead.read' },
      { href: '/crm/pipeline', label: 'مسار الفرص', en: 'Pipeline', icon: 'KanbanSquare', perm: 'opportunity.read' },
      { href: '/crm/tasks', label: 'مهامي', en: 'My tasks', icon: 'ListChecks', perm: 'activity.read' },
      { href: '/crm/inbox', label: 'صندوق الرسائل', en: 'Inbox', icon: 'MessagesSquare', perm: 'message.read' },
      { href: '/crm/targets', label: 'المستهدفات', en: 'Targets', icon: 'Target', perm: 'report.sales' },
    ],
  },
  {
    label: 'المالية', items: [
      { href: '/finance/requests', label: 'طلبات الدفع', en: 'Payment requests', icon: 'HandCoins', perm: 'billing.read' },
      { href: '/finance/invoices', label: 'الفواتير', en: 'Invoices', icon: 'Receipt', perm: 'invoice.read' },
      { href: '/finance/aging', label: 'أعمار الذمم', en: 'AR aging', icon: 'Hourglass', perm: 'invoice.read' },
    ],
  },
  { label: 'التقارير', items: [{ href: '/reports', label: 'تقارير المبيعات', en: 'Sales reports', icon: 'BarChart3', perm: 'report.sales' }] },
  {
    label: 'الإعدادات', items: [
      { href: '/settings/company', label: 'بيانات المنشأة', en: 'Company', icon: 'Landmark', perm: 'admin.settings' },
      { href: '/settings/users', label: 'المستخدمون والصلاحيات', en: 'Users & roles', icon: 'Users', perm: 'admin.users' },
      { href: '/settings/documents', label: 'المستندات والترقيم', en: 'Documents', icon: 'Files', perm: 'admin.settings' },
      { href: '/settings/audit', label: 'سجل التدقيق', en: 'Audit log', icon: 'ShieldCheck', perm: 'admin.audit' },
      { href: '/settings/security', label: 'أمان حسابي', en: 'My security', icon: 'KeyRound' },
    ],
  },
];
