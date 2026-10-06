/** Staff file uploads (POST /api/files): photos are downscaled in the browser, PDFs sent as-is (≤ 8 MB). */
import { api } from './api';

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_SIDE = 1600;
const QUALITY = 0.8;

export interface UploadedFile { id: string; url: string; filename: string; mime: string; size: number }
export interface PreparedFile { name: string; contentType: string; data: string }

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/** Downscale to ≤1600 px JPEG (~0.8); falls back to the original when the browser cannot decode it. */
export async function prepareImage(file: File): Promise<PreparedFile> {
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', QUALITY);
    return { name: `${base}.jpg`, contentType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
  } catch {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('unsupported');
    const url = await readAsDataUrl(file);
    return { name: file.name || 'photo', contentType: file.type, data: url.slice(url.indexOf(',') + 1) };
  }
}

/** Image → downscaled JPEG; PDF → as-is. Throws Error('unsupported' | 'too_large'). */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > UPLOAD_MAX_BYTES) throw new Error('too_large');
    const url = await readAsDataUrl(file);
    return { name: file.name || 'document.pdf', contentType: 'application/pdf', data: url.slice(url.indexOf(',') + 1) };
  }
  if (!file.type.startsWith('image/') && !IMAGE_TYPES.includes(file.type)) throw new Error('unsupported');
  const p = await prepareImage(file);
  if (p.data.length * 0.75 > UPLOAD_MAX_BYTES) throw new Error('too_large');
  return p;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  return api.post<UploadedFile>('/files', await prepareFile(file));
}
