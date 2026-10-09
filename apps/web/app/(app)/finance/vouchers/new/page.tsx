'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { PageHeader, Spinner } from '@/components/ui';
import { KIND_LABEL, VoucherForm, type VoucherKind } from '../_components/voucher-kit';

function NewVoucher() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const kind: VoucherKind = params.get('kind') === 'receipt' ? 'receipt' : 'payment';
  return (
    <>
      <PageHeader back="/finance/vouchers" title={`${locale === 'en' ? KIND_LABEL[kind][1] : KIND_LABEL[kind][0]} — ${bi('جديد', 'new')}`}
        subtitle={bi('يُحفظ كمسودة ويُرقّم تلقائيًا، ثم يعتمده ويختمه مسؤول آخر.', 'Saved as a numbered draft, then approved and stamped by a second person.')} />
      <VoucherForm kind={kind} voucher={null} onCancel={() => router.push('/finance/vouchers')}
        onSaved={(v) => { void qc.invalidateQueries({ queryKey: ['vouchers'] }); router.replace(`/finance/vouchers/${v.id}`); }} />
    </>
  );
}

export default function NewVoucherPage() {
  return <Suspense fallback={<Spinner />}><NewVoucher /></Suspense>;
}
