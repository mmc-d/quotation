/**
 * Roles & permissions (module 01 §3.3–4). Roles are additive permission sets; every permission
 * carries a record scope. The API enforces these server-side; the UI only hides what the API
 * would refuse anyway.
 */
export type Scope = 'own' | 'team' | 'branch' | 'company' | 'all';
const SCOPE_RANK: Record<Scope, number> = { own: 1, team: 2, branch: 3, company: 4, all: 5 };

export const PERMISSIONS = [
  'admin.users', 'admin.roles', 'admin.settings', 'admin.audit',
  'party.read', 'party.write',
  'product.read', 'product.write', 'product.cost.read',
  'quote.read', 'quote.write', 'quote.approve', 'quote.send', 'quote.cost.read',
  'contract.read', 'contract.write', 'contract.sign', 'contract.stamp',
  'lead.read', 'lead.write', 'opportunity.read', 'opportunity.write',
  'activity.read', 'activity.write', 'message.read', 'message.send',
  'billing.read', 'billing.write', 'invoice.read', 'invoice.issue', 'payment.read', 'payment.record',
  'voucher.read', 'voucher.write', 'voucher.approve',
  'report.sales', 'report.finance',
  'project.read', 'project.write', 'project.override',
  'asset.read', 'asset.write', 'workorder.read', 'workorder.write', 'workorder.dispatch', 'ticket.read', 'ticket.write',
  'inventory.read', 'inventory.write', 'inventory.count', 'purchase.read', 'purchase.write', 'purchase.approve', 'purchase.cost.read',
  'agreement.read', 'agreement.write', 'portal.manage',
  'iot.manage', 'ai.use', 'ai.approve', 'commission.read', 'commission.manage',
  'kb.read', 'kb.write',
  'hr.read', 'hr.write', 'hr.approve',
  'ledger.read', 'ledger.write', 'ledger.post', 'ledger.close', 'einvoice.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type Grant = Partial<Record<Permission, Scope>>;

const all = (perms: readonly Permission[], scope: Scope): Grant => Object.fromEntries(perms.map((p) => [p, scope])) as Grant;

export const ROLE_TEMPLATES: Record<string, { name_ar: string; name_en: string; grants: Grant; maxDiscountPercent?: number }> = {
  owner: { name_ar: 'المالك / المدير العام للنظام', name_en: 'Owner / Admin', grants: all(PERMISSIONS, 'all'), maxDiscountPercent: 100 },
  general_manager: {
    name_ar: 'المدير العام', name_en: 'General Manager', maxDiscountPercent: 30,
    grants: { ...all(PERMISSIONS.filter((p) => !p.startsWith('admin.')), 'all'), 'admin.audit': 'all' },
  },
  sales_manager: {
    name_ar: 'مدير المبيعات', name_en: 'Sales Manager', maxDiscountPercent: 15,
    grants: {
      'party.read': 'company', 'party.write': 'company', 'product.read': 'all', 'product.cost.read': 'all',
      'quote.read': 'team', 'quote.write': 'team', 'quote.approve': 'team', 'quote.send': 'team', 'quote.cost.read': 'team',
      'contract.read': 'team', 'contract.write': 'team',
      'lead.read': 'team', 'lead.write': 'team', 'opportunity.read': 'team', 'opportunity.write': 'team',
      'activity.read': 'team', 'activity.write': 'team', 'message.read': 'team', 'message.send': 'team',
      'billing.read': 'team', 'invoice.read': 'team', 'payment.read': 'team', 'report.sales': 'team',
      'project.read': 'team', 'asset.read': 'company', 'ai.use': 'team', 'ai.approve': 'team', 'commission.read': 'team',
    },
  },
  sales_rep: {
    name_ar: 'مندوب مبيعات', name_en: 'Sales Rep', maxDiscountPercent: 10,
    grants: {
      'party.read': 'company', 'party.write': 'own', 'product.read': 'all',
      'quote.read': 'own', 'quote.write': 'own', 'quote.send': 'own',
      'contract.read': 'own', 'contract.write': 'own',
      'lead.read': 'own', 'lead.write': 'own', 'opportunity.read': 'own', 'opportunity.write': 'own',
      'activity.read': 'own', 'activity.write': 'own', 'message.read': 'own', 'message.send': 'own',
      'invoice.read': 'own', 'billing.read': 'own', 'project.read': 'own', 'ai.use': 'own', 'commission.read': 'own',
    },
  },
  presales: {
    name_ar: 'مهندس ما قبل البيع', name_en: 'Pre-sales Engineer', maxDiscountPercent: 0,
    grants: { 'party.read': 'company', 'product.read': 'all', 'product.cost.read': 'all', 'quote.read': 'company', 'quote.write': 'own', 'quote.cost.read': 'company', 'contract.read': 'company', 'activity.read': 'own', 'activity.write': 'own' },
  },
  accountant: {
    name_ar: 'محاسب / المدير المالي', name_en: 'Accountant / Finance', maxDiscountPercent: 0,
    grants: {
      'party.read': 'company', 'party.write': 'company', 'product.read': 'all', 'product.cost.read': 'all',
      'quote.read': 'company', 'contract.read': 'company', 'contract.stamp': 'company',
      'billing.read': 'company', 'billing.write': 'company', 'invoice.read': 'company', 'invoice.issue': 'company',
      'payment.read': 'company', 'payment.record': 'company', 'voucher.read': 'company', 'voucher.write': 'company', 'report.finance': 'company', 'report.sales': 'company',
      'inventory.read': 'company', 'purchase.read': 'company', 'purchase.cost.read': 'company', 'commission.read': 'company', 'commission.manage': 'company',
      'ledger.read': 'company', 'ledger.write': 'company', 'ledger.post': 'company',
    },
  },
  customer_service: {
    name_ar: 'خدمة العملاء', name_en: 'Customer Service', maxDiscountPercent: 0,
    grants: { 'party.read': 'company', 'party.write': 'company', 'quote.read': 'company', 'contract.read': 'company', 'lead.read': 'company', 'lead.write': 'company', 'activity.read': 'company', 'activity.write': 'own', 'message.read': 'company', 'message.send': 'company', 'invoice.read': 'company', 'payment.read': 'company', 'ticket.read': 'company', 'ticket.write': 'company', 'asset.read': 'company', 'workorder.read': 'company', 'workorder.write': 'company', 'project.read': 'company', 'agreement.read': 'company', 'portal.manage': 'company', 'kb.read': 'company', 'kb.write': 'company' },
  },
  project_manager: {
    name_ar: 'مدير المشاريع', name_en: 'Projects Manager', maxDiscountPercent: 0,
    grants: {
      'party.read': 'company', 'product.read': 'all', 'quote.read': 'company', 'contract.read': 'company', 'billing.read': 'company', 'invoice.read': 'company', 'payment.read': 'company',
      'project.read': 'company', 'project.write': 'company', 'project.override': 'company', 'asset.read': 'company', 'asset.write': 'company',
      'workorder.read': 'company', 'workorder.write': 'company', 'workorder.dispatch': 'company', 'ticket.read': 'company', 'ticket.write': 'company',
      'inventory.read': 'company', 'purchase.read': 'company',
      'activity.read': 'company', 'activity.write': 'own', 'message.read': 'company', 'message.send': 'company',
    },
  },
  service_coordinator: {
    name_ar: 'منسق الخدمة والصيانة', name_en: 'Service Coordinator', maxDiscountPercent: 0,
    grants: {
      'party.read': 'company', 'product.read': 'all', 'contract.read': 'company', 'project.read': 'company', 'asset.read': 'company', 'asset.write': 'company',
      'workorder.read': 'company', 'workorder.write': 'company', 'workorder.dispatch': 'company', 'ticket.read': 'company', 'ticket.write': 'company',
      'message.read': 'company', 'message.send': 'company', 'agreement.read': 'company', 'agreement.write': 'company', 'portal.manage': 'company',
      'kb.read': 'company', 'kb.write': 'company',
    },
  },
  storekeeper: {
    name_ar: 'أمين المستودع', name_en: 'Storekeeper', maxDiscountPercent: 0,
    grants: {
      'party.read': 'company', 'product.read': 'all', 'project.read': 'company', 'asset.read': 'company', 'workorder.read': 'company',
      'inventory.read': 'company', 'inventory.write': 'company', 'inventory.count': 'company', 'purchase.read': 'company',
    },
  },
  purchaser: {
    name_ar: 'مسؤول المشتريات', name_en: 'Purchaser', maxDiscountPercent: 0,
    grants: {
      'party.read': 'company', 'party.write': 'company', 'product.read': 'all', 'product.write': 'all', 'product.cost.read': 'all', 'contract.read': 'company', 'project.read': 'company',
      'inventory.read': 'company', 'purchase.read': 'company', 'purchase.write': 'company', 'purchase.approve': 'company', 'purchase.cost.read': 'company',
    },
  },
  technician: {
    name_ar: 'فني', name_en: 'Technician', maxDiscountPercent: 0,
    grants: { 'party.read': 'company', 'product.read': 'all', 'project.read': 'own', 'asset.read': 'company', 'asset.write': 'own', 'workorder.read': 'own', 'workorder.write': 'own', 'ticket.read': 'own', 'inventory.read': 'own', 'kb.read': 'company' },
  },
  hr_officer: {
    name_ar: 'مسؤول الموارد البشرية', name_en: 'HR Officer', maxDiscountPercent: 0,
    grants: { 'hr.read': 'company', 'hr.write': 'company', 'party.read': 'company', 'project.read': 'company' },
  },
  auditor: {
    name_ar: 'مدقق', name_en: 'Auditor', maxDiscountPercent: 0,
    grants: { ...all(PERMISSIONS.filter((p) => p.endsWith('.read')), 'all'), 'admin.audit': 'all', 'report.sales': 'all', 'report.finance': 'all' },
  },
};

/** Merge additive roles: the widest scope wins per permission. */
export function mergeGrants(grants: Grant[]): Grant {
  const out: Grant = {};
  for (const g of grants) {
    for (const [p, s] of Object.entries(g) as [Permission, Scope][]) {
      const cur = out[p];
      if (!cur || SCOPE_RANK[s] > SCOPE_RANK[cur]) out[p] = s;
    }
  }
  return out;
}

export interface Actor {
  userId: string;
  teamIds: string[];
  branchId: string | null;
  grants: Grant;
}

export interface OwnedRecord {
  ownerId?: string | null;
  teamId?: string | null;
  branchId?: string | null;
}

/** Can the actor exercise `perm` on this record? (company/all: any record of the tenant.) */
export function can(actor: Actor, perm: Permission, record?: OwnedRecord): boolean {
  const scope = actor.grants[perm];
  if (!scope) return false;
  if (!record) return true;
  switch (scope) {
    case 'all':
    case 'company':
      return true;
    case 'branch':
      return !record.branchId || record.branchId === actor.branchId;
    case 'team':
      return record.ownerId === actor.userId || (!!record.teamId && actor.teamIds.includes(record.teamId));
    case 'own':
      return record.ownerId === actor.userId;
  }
}

export function scopeOf(actor: Actor, perm: Permission): Scope | null {
  return actor.grants[perm] ?? null;
}
