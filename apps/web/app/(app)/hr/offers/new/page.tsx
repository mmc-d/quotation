'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui';
import { OfferForm } from '../../_components/hr-kit';

export default function NewOfferPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { bi } = useI18n();
  return (
    <>
      <PageHeader back="/hr/offers" title={bi('عرض وظيفي جديد', 'New job offer')}
        subtitle={bi('يُحفظ كمسودة ويُرقّم تلقائيًا، ثم يصدره مسؤول آخر بعد مراجعة نظام العمل.', 'Saved as a numbered draft, then issued by a second person after the Labor Law check.')} />
      <OfferForm offer={null} onCancel={() => router.push('/hr/offers')}
        onSaved={(o) => { void qc.invalidateQueries({ queryKey: ['hr-offers'] }); router.replace(`/hr/offers/${o.id}`); }} />
    </>
  );
}
