'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui';
import { EmployeeForm } from '../../_components/hr-kit';

export default function NewEmployeePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { bi } = useI18n();
  return (
    <>
      <PageHeader back="/hr/employees" title={bi('إضافة موظف', 'Add employee')}
        subtitle={bi('للموظفين الحاليين. للموظف الجديد أنشئ عرضًا وظيفيًا ثم حوّله إلى ملف موظف بعد قبوله.', 'For current staff. For a new hire, create a job offer and turn it into an employee once accepted.')} />
      <EmployeeForm employee={null} onCancel={() => router.push('/hr/employees')}
        onSaved={(e) => { void qc.invalidateQueries({ queryKey: ['hr-employees'] }); router.replace(`/hr/employees/${e.id}`); }} />
    </>
  );
}
