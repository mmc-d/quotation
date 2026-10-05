'use client';
import { useState } from 'react';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, Checkbox, Dialog, Field, Input } from '@/components/ui';
import { CopyLink, errMsg } from '../../quotes/_components/common';
import type { ContractView } from './types';

const NID = /^[12]\d{9}$/;

/** Send the contract for Nafath-backed e-signature and show the signing URL. */
export function EsignDialog({ open, onClose, contract, beforeSend, onDone }: { open: boolean; onClose: () => void; contract: ContractView; beforeSend: () => Promise<ContractView | null>; onDone: (c: ContractView) => void }) {
  const b = contract.clientBlock ?? {};
  const [name, setName] = useState(b.representative || b.name || '');
  const [nid, setNid] = useState(b.idNumber ?? '');
  const [mobile, setMobile] = useState(b.mobile ?? '');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const nidOk = !nid.trim() || NID.test(nid.trim());
  const send = async () => {
    setBusy(true);
    try {
      const c = await beforeSend();
      if (!c) return;
      const r = await api.post<{ signingUrl: string; contract: ContractView }>(`/contracts/${c.id}/esign`, { signerName: name.trim(), signerNationalId: nid.trim() || null, signerMobile: mobile.trim() || null, notify: notify && !!mobile.trim() });
      setUrl(r.signingUrl);
      onDone(r.contract);
      toast.success('أُرسل العقد للتوقيع الإلكتروني');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setUrl(null); onClose(); };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`توقيع إلكتروني — العقد ${contract.number}`}
      footer={url ? <Button onClick={close}>تم</Button> : <><Button variant="outline" onClick={close}>إلغاء</Button><Button icon={<PenLine className="size-4" />} loading={busy} disabled={!name.trim() || !nidOk} onClick={() => void send()}>إرسال للتوقيع</Button></>}
    >
      {url ? (
        <div className="space-y-3">
          <CopyLink url={url} label="رابط التوقيع للعميل" />
          <p className="text-xs text-muted">تمت أرشفة نسخة PDF من العقد مع بصمتها (SHA-256). يتحول العقد إلى «بانتظار التوقيع».</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="اسم الموقّع *"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="رقم الهوية / الإقامة" error={nidOk ? null : '10 أرقام تبدأ بـ 1 أو 2'} hint="يُستخدم للتحقق عبر نفاذ">
            <Input dir="ltr" inputMode="numeric" maxLength={10} value={nid} onChange={(e) => setNid(e.target.value.replace(/\D/g, ''))} placeholder="1XXXXXXXXX" />
          </Field>
          <Field label="جوال الموقّع"><Input dir="ltr" type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="05XXXXXXXX" /></Field>
          <Checkbox label="إرسال رابط التوقيع للعميل عبر واتساب" checked={notify && !!mobile.trim()} disabled={!mobile.trim()} onChange={setNotify} />
        </div>
      )}
    </Dialog>
  );
}
