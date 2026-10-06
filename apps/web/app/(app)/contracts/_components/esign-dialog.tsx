'use client';
import { useState } from 'react';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Checkbox, Dialog, Field, Input } from '@/components/ui';
import { CopyLink, errMsg } from '../../quotes/_components/common';
import type { ContractView } from './types';

const NID = /^[12]\d{9}$/;

/** Send the contract for Nafath-backed e-signature and show the signing URL. */
export function EsignDialog({ open, onClose, contract, beforeSend, onDone }: { open: boolean; onClose: () => void; contract: ContractView; beforeSend: () => Promise<ContractView | null>; onDone: (c: ContractView) => void }) {
  const { bi } = useI18n();
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
      toast.success(bi('أُرسل العقد للتوقيع الإلكتروني', 'Contract sent for e-signature'));
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
      title={bi(`توقيع إلكتروني — العقد ${contract.number}`, `E-signature — contract ${contract.number}`)}
      footer={url ? <Button onClick={close}>{bi('تم', 'Done')}</Button> : <><Button variant="outline" onClick={close}>{bi('إلغاء', 'Cancel')}</Button><Button icon={<PenLine className="size-4" />} loading={busy} disabled={!name.trim() || !nidOk} onClick={() => void send()}>{bi('إرسال للتوقيع', 'Send for signature')}</Button></>}
    >
      {url ? (
        <div className="space-y-3">
          <CopyLink url={url} label={bi('رابط التوقيع للعميل', 'Customer signing link')} />
          <p className="text-xs text-muted">{bi('تمت أرشفة نسخة PDF من العقد مع بصمتها (SHA-256). يتحول العقد إلى «بانتظار التوقيع».', 'A PDF copy of the contract was archived with its fingerprint (SHA-256). The contract moves to “Awaiting signature”.')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label={bi('اسم الموقّع *', 'Signer name *')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={bi('رقم الهوية / الإقامة', 'National ID / Iqama number')} error={nidOk ? null : bi('10 أرقام تبدأ بـ 1 أو 2', '10 digits starting with 1 or 2')} hint={bi('يُستخدم للتحقق عبر نفاذ', 'Used for verification via Nafath')}>
            <Input dir="ltr" inputMode="numeric" maxLength={10} value={nid} onChange={(e) => setNid(e.target.value.replace(/\D/g, ''))} placeholder="1XXXXXXXXX" />
          </Field>
          <Field label={bi('جوال الموقّع', 'Signer mobile')}><Input dir="ltr" type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="05XXXXXXXX" /></Field>
          <Checkbox label={bi('إرسال رابط التوقيع للعميل عبر واتساب', 'Send the signing link to the customer via WhatsApp')} checked={notify && !!mobile.trim()} disabled={!mobile.trim()} onChange={setNotify} />
        </div>
      )}
    </Dialog>
  );
}
