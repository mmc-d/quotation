'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { ContractEditor } from '../_components/contract-editor';
import type { ContractView } from '../_components/types';

export default function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['contract', id], queryFn: () => api.get<ContractView>(`/contracts/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <><PageHeader back="/contracts" title="العقد" /><ErrorBox error={q.error} /></>;
  return <ContractEditor key={q.data.id} contract={q.data} />;
}
