'use client';
import { use } from 'react';
import { InboxShell } from '../../_components/inbox';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <InboxShell selectedId={id} />;
}
