'use client';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui';
import { InfoNote, RequirePerm } from '../../../settings/_components/common';
import { JournalEditor } from '../../_components/journal-kit';

export default function NewEntryPage() {
  const { bi } = useI18n();
  const router = useRouter();
  return (
    <RequirePerm perm="ledger.write" title="قيد يومية جديد">
      <PageHeader back="/accounting/journal" title={bi('قيد يومية جديد', 'New journal entry')} subtitle={bi('يُحفظ كمسودة ثم يرحّله شخص آخر لديه صلاحية الترحيل.', 'Saved as a draft; someone else with posting permission posts it.')} />
      <div className="mb-4"><InfoNote>{bi('بعد الترحيل لا يمكن تعديل القيد أو حذفه — يُصحَّح فقط بقيد عكسي. لا يمكن الترحيل في فترة مقفلة.', 'Once posted an entry cannot be edited or deleted — only reversed. Locked periods cannot be posted to.')}</InfoNote></div>
      <JournalEditor entry={null} onSaved={(e) => router.push(`/accounting/journal/${e.id}`)} />
    </RequirePerm>
  );
}
