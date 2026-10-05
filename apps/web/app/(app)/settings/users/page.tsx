'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/lib/me';
import { api } from '@/lib/api';
import { PageHeader, Tabs } from '@/components/ui';
import { RequirePerm, type RoleRow } from '../_components/common';
import { UsersTab } from './users-tab';
import { RolesTab } from './roles-tab';
import { TeamsTab } from './teams-tab';

type Tab = 'users' | 'roles' | 'teams';

export default function UsersSettingsPage() {
  return <RequirePerm perm={['admin.users', 'admin.roles']} title="المستخدمون والصلاحيات"><UsersSettings /></RequirePerm>;
}

function UsersSettings() {
  const { can } = useMe();
  const canUsers = can('admin.users');
  const [tab, setTab] = useState<Tab>(canUsers ? 'users' : 'roles');
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ roles: RoleRow[]; permissions: string[]; templates: string[] }>('/users/roles') });
  const items: { value: Tab; label: string }[] = [
    ...(canUsers ? [{ value: 'users' as const, label: 'المستخدمون' }] : []),
    { value: 'roles', label: 'الأدوار والصلاحيات' },
    ...(canUsers ? [{ value: 'teams' as const, label: 'الفرق' }] : []),
  ];
  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" subtitle="الدعوات، الأدوار، نطاق الصلاحيات، والفرق" />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === 'users' && canUsers && <UsersTab roles={roles.data?.roles ?? []} />}
      {tab === 'roles' && <RolesTab data={roles.data} loading={roles.isLoading} error={roles.error} canEdit={can('admin.roles')} />}
      {tab === 'teams' && canUsers && <TeamsTab />}
    </>
  );
}
