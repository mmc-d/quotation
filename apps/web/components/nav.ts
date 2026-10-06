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
      { href: '/tech', label: 'يومي (الفني)', en: 'My day (technician)', icon: 'Smartphone', perm: 'workorder.write' },
    ],
  },
  {
    label: 'المشتريات والمخزون', en: 'Purchasing & stock', items: [
      { href: '/inventory', label: 'المخزون', en: 'Stock', icon: 'Warehouse', perm: 'inventory.read' },
      { href: '/purchasing/requests', label: 'طلبات المواد', en: 'Material requests', icon: 'ClipboardCheck', perm: 'purchase.read' },
      { href: '/purchasing/orders', label: 'أوامر الشراء', en: 'Purchase orders', icon: 'ShoppingCart', perm: 'purchase.read' },
      { href: '/purchasing/shipments', label: 'الشحنات المستوردة', en: 'Import shipments', icon: 'Ship', perm: 'purchase.read' },
      { href: '/inventory/transfers', label: 'التحويلات المخزنية', en: 'Stock transfers', icon: 'ArrowLeftRight', perm: 'inventory.write' },
      { href: '/inventory/counts', label: 'الجرد', en: 'Stock counts', icon: 'ListOrdered', perm: 'inventory.count' },
    ],
  },
  {
    label: 'المالية', en: 'Finance', items: [
      { href: '/finance/requests', label: 'طلبات الدفع', en: 'Payment requests', icon: 'HandCoins', perm: 'billing.read' },
      { href: '/finance/invoices', label: 'الفواتير', en: 'Invoices', icon: 'Receipt', perm: 'invoice.read' },
      { href: '/finance/aging', label: 'أعمار الذمم', en: 'AR aging', icon: 'Hourglass', perm: 'invoice.read' },
    ],
  },
  { label: 'التقارير', en: 'Reports', items: [{ href: '/reports', label: 'تقارير المبيعات', en: 'Sales reports', icon: 'BarChart3', perm: 'report.sales' }] },
  {
    label: 'الإعدادات', en: 'Settings', items: [
      { href: '/settings/company', label: 'بيانات المنشأة', en: 'Company', icon: 'Landmark', perm: 'admin.settings' },
      { href: '/settings/users', label: 'المستخدمون والصلاحيات', en: 'Users & roles', icon: 'Users', perm: 'admin.users' },
      { href: '/settings/documents', label: 'المستندات والترقيم', en: 'Documents', icon: 'Files', perm: 'admin.settings' },
      { href: '/settings/calendar', label: 'تقويم العمل', en: 'Work calendar', icon: 'CalendarDays', perm: 'admin.settings' },
      { href: '/settings/audit', label: 'سجل التدقيق', en: 'Audit log', icon: 'ShieldCheck', perm: 'admin.audit' },
      { href: '/settings/security', label: 'أمان حسابي', en: 'My security', icon: 'KeyRound' },
    ],
  },
];
