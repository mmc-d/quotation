'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Cpu, Search, Send, X } from 'lucide-react';
import { Button, Field, Input, Select, Textarea, clsx } from '@/components/ui';
import { InlineError, PublicCard } from '@/app/_public/public-shell';
import { readAsDataUrl, type PreparedFile } from '@/lib/upload';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalDevice, type PortalTicketDetail, type Rows } from '../../_components/portal-api';
import { usePortalMe } from '../../_components/portal-shell';
import { CoverageBadge, ErrorBlock, Loading, Num, PageTitle } from '../../_components/portal-ui';

const MAX_PHOTOS = 3;
const MAX_BYTES = 1_500_000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/** Downscale in the browser (like lib/upload.ts) until the JPEG is ≤ 1.5 MB; undecodable images go as-is if small enough. */
async function preparePhoto(file: File): Promise<PreparedFile & { preview: string }> {
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
  try {
    const img = await loadImage(file);
    for (const [side, quality] of [[1600, 0.8], [1280, 0.75], [1024, 0.7], [800, 0.65]] as const) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', quality);
      const data = url.slice(url.indexOf(',') + 1);
      if (data.length * 0.75 <= MAX_BYTES) return { name: `${base}.jpg`, contentType: 'image/jpeg', data, preview: url };
    }
    throw new Error('too_large');
  } catch (e) {
    if ((e as Error).message === 'too_large') throw e;
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('unsupported');
    if (file.size > MAX_BYTES) throw new Error('too_large');
    const url = await readAsDataUrl(file);
    return { name: file.name || 'photo', contentType: file.type, data: url.slice(url.indexOf(',') + 1), preview: url };
  }
}

export default function NewRequestPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = use(searchParams);
  const presetAsset = typeof sp.assetId === 'string' ? sp.assetId : null;
  const { bi } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const me = usePortalMe();
  const devices = useQuery({ queryKey: ['portal', 'devices'], queryFn: () => portalFetch<Rows<PortalDevice>>('/devices'), retry: portalRetry });

  const [siteId, setSiteId] = useState('');
  const [assetId, setAssetId] = useState<string | null>(presetAsset);
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<(PreparedFile & { preview: string })[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sites = me.data?.sites ?? [];
  const asset = devices.data?.rows.find((d) => d.id === assetId) ?? null;

  // single site → preselect it; a preset device → its site
  useEffect(() => { if (!siteId && sites.length === 1) setSiteId(sites[0]!.id); }, [sites, siteId]);
  useEffect(() => { if (asset?.siteId) setSiteId(asset.siteId); }, [asset?.siteId]);
  useEffect(() => { if (asset && !subject) setSubject(bi(`مشكلة في الجهاز ${asset.code}`, `Problem with device ${asset.code}`)); }, [asset]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return (devices.data?.rows ?? [])
      .filter((d) => (!siteId || d.siteId === siteId) && [d.code, d.serial, d.description, d.locationPath, d.mac].some((v) => v?.toLowerCase().includes(needle)))
      .slice(0, 8);
  }, [devices.data, search, siteId]);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setPhotoBusy(true);
    try {
      const room = MAX_PHOTOS - photos.length;
      const picked = [...files].slice(0, room);
      if (files.length > room) setError(bi(`يمكن إرفاق ${MAX_PHOTOS} صور كحد أقصى.`, `You can attach up to ${MAX_PHOTOS} photos.`));
      const out: (PreparedFile & { preview: string })[] = [];
      for (const f of picked) {
        try { out.push(await preparePhoto(f)); } catch (e) {
          setError((e as Error).message === 'too_large' ? bi('الصورة كبيرة جدًا (الحد 1.5 ميجابايت).', 'The photo is too large (limit 1.5 MB).') : bi('نوع الملف غير مدعوم — أرفق صورة.', 'Unsupported file — please attach a photo.'));
        }
      }
      setPhotos((p) => [...p, ...out].slice(0, MAX_PHOTOS));
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const create = useMutation({
    mutationFn: () => portalFetch<PortalTicketDetail>('/tickets', {
      body: {
        // a device decides the site (the API rejects a device on another site)
        siteId: asset ? asset.siteId ?? null : siteId || null, assetId: asset?.id ?? null, subject: subject.trim(), description: description.trim() || null,
        photos: photos.map(({ name, contentType, data }) => ({ name, contentType, data })),
      },
    }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['portal', 'tickets'] });
      router.replace(`/portal/requests/${t.id}?created=1`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const subjectError = touched && subject.trim().length < 3 ? bi('اكتب عنوانًا من 3 أحرف على الأقل.', 'Write a subject of at least 3 characters.') : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (subject.trim().length < 3) return;
    create.mutate();
  }

  const back = { href: '/portal/requests', label: bi('طلبات الصيانة', 'Service requests') };
  if (me.isLoading) return <Loading />;
  if (me.error) return <ErrorBlock error={me.error} onRetry={() => me.refetch()} />;

  return (
    <div>
      <PageTitle back={back} title={bi('طلب صيانة جديد', 'New service request')} subtitle={bi('صف المشكلة وسيتواصل معك فريق الخدمة.', 'Describe the problem and our service team will contact you.')} />
      <PublicCard>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {sites.length > 0 && (
            <Field label={bi('الموقع', 'Site')}>
              <Select value={siteId} onChange={(e) => { setSiteId(e.target.value); if (asset && asset.siteId !== e.target.value) setAssetId(null); }}>
                <option value="">{bi('— اختر الموقع —', '— Choose the site —')}</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ''}</option>)}
              </Select>
            </Field>
          )}

          <div>
            <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('الجهاز (اختياري)', 'Device (optional)')}</span>
            {asset ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/60 bg-tint/50 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Cpu className="size-4 text-gold-dark" aria-hidden /><Num className="font-bold text-ink">{asset.code}</Num>{asset.serial && <span className="text-xs text-muted">SN <Num>{asset.serial}</Num></span>}</div>
                  <div className="text-xs text-muted">{[asset.siteName, asset.locationPath].filter(Boolean).join(' · ')}</div>
                  <div className="mt-1"><CoverageBadge coverage={asset.coverageToday.coverage} reasonAr={asset.coverageToday.reasonAr} reasonEn={asset.coverageToday.reasonEn} /></div>
                </div>
                <button type="button" onClick={() => setAssetId(null)} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-xs font-bold text-ink hover:bg-tint" aria-label={bi('إزالة الجهاز', 'Remove the device')}><X className="size-3.5" aria-hidden />{bi('إزالة', 'Remove')}</button>
              </div>
            ) : (
              <div>
                <label className="relative block">
                  <span className="sr-only">{bi('ابحث عن الجهاز', 'Search for the device')}</span>
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={bi('ابحث بالموديل أو الرقم التسلسلي أو المكان…', 'Search by model, serial or location…')} className="ps-9" disabled={devices.isLoading} />
                </label>
                {search.trim() && (
                  <ul className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-white" role="listbox" aria-label={bi('نتائج البحث', 'Search results')}>
                    {matches.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{bi('لا توجد أجهزة مطابقة', 'No matching devices')}</li> : matches.map((d) => (
                      <li key={d.id} role="option" aria-selected={false}>
                        <button type="button" onClick={() => { setAssetId(d.id); setSearch(''); }} className="w-full px-3 py-2 text-start hover:bg-tint/50 focus-visible:bg-tint/50">
                          <span className="flex flex-wrap items-center gap-2"><Num className="font-bold text-ink">{d.code}</Num>{d.serial && <span className="text-xs text-muted">SN <Num>{d.serial}</Num></span>}</span>
                          <span className="block text-xs text-muted">{[d.siteName, d.locationPath].filter(Boolean).join(' · ') || d.description}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-muted">{bi('اختيار الجهاز يساعدنا على معرفة الضمان والتغطية بسرعة.', 'Choosing the device helps us check warranty and coverage quickly.')}</p>
              </div>
            )}
          </div>

          <Field label={bi('عنوان المشكلة', 'Subject')} error={subjectError}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => setTouched(true)} maxLength={300} required aria-invalid={!!subjectError} placeholder={bi('مثال: القفل لا يستجيب للبطاقة', 'e.g. The lock does not respond to the card')} />
          </Field>

          <Field label={bi('وصف المشكلة (اختياري)', 'Description (optional)')}>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} placeholder={bi('متى بدأت المشكلة؟ ماذا يظهر؟ أي تفاصيل تساعد الفني.', 'When did it start? What do you see? Any detail that helps the technician.')} />
          </Field>

          <div>
            <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('صور (حتى 3)', 'Photos (up to 3)')}</span>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative size-20 overflow-hidden rounded-xl border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt={bi(`صورة ${i + 1}`, `Photo ${i + 1}`)} className="size-full object-cover" />
                  <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="absolute end-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label={bi(`إزالة الصورة ${i + 1}`, `Remove photo ${i + 1}`)}><X className="size-3.5" aria-hidden /></button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <label className={clsx('grid size-20 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line text-muted transition hover:border-gold hover:text-gold-dark focus-within:border-gold', photoBusy && 'animate-pulse')}>
                  <span className="flex flex-col items-center gap-1 text-[11px] font-bold"><Camera className="size-5" aria-hidden />{bi('إضافة', 'Add')}</span>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} disabled={photoBusy} aria-label={bi('إرفاق صور', 'Attach photos')} />
                </label>
              )}
            </div>
          </div>

          <InlineError message={error} />
          <Button type="submit" className="w-full py-3 text-base sm:w-auto" loading={create.isPending || create.isSuccess} disabled={photoBusy} icon={<Send className="size-4" aria-hidden />}>{bi('إرسال الطلب', 'Send the request')}</Button>
        </form>
      </PublicCard>
    </div>
  );
}
