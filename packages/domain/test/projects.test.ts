import { describe, expect, it } from 'vitest';
import {
  addMonths, canTransitionWorkOrder, clockStartDate, decideCoverage, defaultChecklist, deliveryClock, gateFor, missingForCompletion,
  normalizeMac, REQUIRED_APPROVALS, warrantyEnds, type ProjectFacts,
} from '../src/index.js';

const cal = { workingDays: [0, 1, 2, 3, 4], holidays: ['2026-11-01'] };
const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  advancePaidOn: null, deliveryPaymentPaid: false, requiredApprovals: REQUIRED_APPROVALS, approvedOn: {}, materialsReady: false,
  assetCount: 0, assetsUntested: 0, finalInvoiced: false, openSnags: 0, acceptedOn: null, ...over,
});
const allApproved = { specs: '2026-10-05', door_directions: '2026-10-06', room_numbers: '2026-10-06', design: '2026-10-07' };

describe('project stage gates', () => {
  it('kick-off needs the advance and every required client approval', () => {
    expect(gateFor('kickoff', facts()).ok).toBe(false);
    const g = gateFor('kickoff', facts({ advancePaidOn: '2026-10-04', approvedOn: { specs: '2026-10-05' } }));
    expect(g.to).toBe('procurement');
    expect(g.checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(['approval:door_directions', 'approval:room_numbers', 'approval:design']);
    expect(gateFor('kickoff', facts({ advancePaidOn: '2026-10-04', approvedOn: allApproved })).ok).toBe(true);
    // approvals can be waived per project
    expect(gateFor('kickoff', facts({ advancePaidOn: '2026-10-04', requiredApprovals: [] })).ok).toBe(true);
  });

  it('procurement needs the 40% and materials; commissioning needs tests and the final request; handover needs snags + acceptance', () => {
    expect(gateFor('procurement', facts({ deliveryPaymentPaid: true })).ok).toBe(false);
    expect(gateFor('procurement', facts({ deliveryPaymentPaid: true, materialsReady: true })).ok).toBe(true);
    expect(gateFor('delivery', facts()).ok).toBe(true); // manual move
    expect(gateFor('installation', facts()).ok).toBe(false);
    expect(gateFor('commissioning', facts({ assetCount: 3, assetsUntested: 1, finalInvoiced: true })).ok).toBe(false);
    expect(gateFor('commissioning', facts({ assetCount: 3, assetsUntested: 0, finalInvoiced: true })).ok).toBe(true);
    expect(gateFor('handover', facts({ openSnags: 1, acceptedOn: '2026-12-01' })).ok).toBe(false);
    expect(gateFor('handover', facts({ openSnags: 0, acceptedOn: '2026-12-01' })).to).toBe('warranty');
  });
});

describe('delivery clock', () => {
  it('starts at the later of the advance and the last approval', () => {
    expect(clockStartDate(facts({ advancePaidOn: '2026-10-04', approvedOn: { specs: '2026-10-05' } }))).toBeNull();
    expect(clockStartDate(facts({ advancePaidOn: '2026-10-04', approvedOn: allApproved }))).toBe('2026-10-07');
    expect(clockStartDate(facts({ advancePaidOn: '2026-10-10', approvedOn: allApproved }))).toBe('2026-10-10');
  });

  it('counts working days only, skips holidays and pauses, warns at 70/90%', () => {
    // Sun 2026-10-04 start; 10 business days later (no holidays in Oct) = Sun 2026-10-18
    const c = deliveryClock({ startDate: '2026-10-04', today: '2026-10-18', minDays: 45, maxDays: 60, calendar: cal });
    expect(c.elapsed).toBe(10);
    expect(c.level).toBe('ok');
    expect(c.targetMax > c.targetMin!).toBe(true);
    const paused = deliveryClock({ startDate: '2026-10-04', today: '2026-10-18', minDays: 45, maxDays: 60, pauses: [{ from: '2026-10-11', to: '2026-10-15' }], calendar: cal });
    expect(paused.pausedDays).toBe(4);
    expect(paused.elapsed).toBe(6);
    const warn = deliveryClock({ startDate: '2026-10-04', today: '2026-10-18', minDays: 8, maxDays: 11, calendar: cal });
    expect(warn.level).toBe('warn90');
    const over = deliveryClock({ startDate: '2026-10-04', today: '2026-10-18', minDays: 5, maxDays: 8, calendar: cal });
    expect(over.level).toBe('overdue');
    const ext = deliveryClock({ startDate: '2026-10-04', today: '2026-10-18', minDays: 5, maxDays: 8, extensionDays: 10, calendar: cal });
    expect(ext.maxDays).toBe(18);
    expect(ext.level).toBe('ok');
    expect(deliveryClock({ startDate: null, today: '2026-10-18', minDays: 45, maxDays: 60, calendar: cal }).level).toBe('not_started');
  });

  it('skips the company holidays when counting', () => {
    // 2026-11-01 (Sun) is a holiday in this calendar
    const c = deliveryClock({ startDate: '2026-10-29', today: '2026-11-02', minDays: 45, maxDays: 60, calendar: cal });
    expect(c.elapsed).toBe(1); // Fri 30th and Sat 31st off, Sun 1st a holiday — only Mon 2nd counts
  });
});

describe('warranty dates', () => {
  it('adds months and clamps month ends', () => {
    expect(addMonths('2026-12-15', 12)).toBe('2027-12-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(warrantyEnds('2026-12-15', 12, 24)).toEqual({ labourEnd: '2027-12-15', partsEnd: '2028-12-15' });
  });
});

describe('field service', () => {
  it('follows the work-order lifecycle', () => {
    expect(canTransitionWorkOrder('new', 'scheduled')).toBe(true);
    expect(canTransitionWorkOrder('new', 'completed')).toBe(false);
    expect(canTransitionWorkOrder('on_site', 'completed')).toBe(true);
    expect(canTransitionWorkOrder('closed', 'new')).toBe(false);
  });

  it('blocks completion without evidence', () => {
    const checklist = defaultChecklist('installation');
    const missing = missingForCompletion({ type: 'installation', checklist, photoCount: 0, assetsRegistered: 0, signatureName: null, checkedIn: false });
    expect(missing.map((m) => m.key)).toEqual(['check_in', 'check:mounted', 'check:cabled', 'check:labelled', 'check:site_clean', 'photos', 'assets', 'signature']);
    const done = checklist.map((i) => ({ ...i, done: true }));
    expect(missingForCompletion({ type: 'installation', checklist: done, photoCount: 2, assetsRegistered: 4, signatureName: 'أحمد', checkedIn: true })).toEqual([]);
    // corrective jobs don't need registered devices
    expect(missingForCompletion({ type: 'corrective', checklist: defaultChecklist('corrective').map((i) => ({ ...i, done: true })), photoCount: 1, assetsRegistered: 0, signatureName: 'x', checkedIn: true })).toEqual([]);
  });

  it('decides coverage with a reason', () => {
    expect(decideCoverage({ today: '2026-10-06', projectInProgress: true }).coverage).toBe('project');
    const asset = { labourWarrantyEnd: '2027-01-01', partsWarrantyEnd: '2026-12-01' };
    expect(decideCoverage({ today: '2026-10-06', asset }).coverage).toBe('warranty');
    expect(decideCoverage({ today: '2026-12-15', asset }).reasonEn).toContain('parts out of warranty');
    expect(decideCoverage({ today: '2027-02-01', asset }).coverage).toBe('chargeable');
    expect(decideCoverage({ today: '2027-02-01', asset, amcEnd: '2027-06-30' }).coverage).toBe('amc');
    expect(decideCoverage({ today: '2027-02-01' }).coverage).toBe('chargeable');
  });

  it('normalises MAC addresses', () => {
    expect(normalizeMac('a4-bb-6d-01-02-0f')).toBe('A4:BB:6D:01:02:0F');
    expect(normalizeMac('xyz')).toBeNull();
  });
});
