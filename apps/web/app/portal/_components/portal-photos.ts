'use client';
/** Customer photos (portal requests and messages): downscaled in the browser to ≤ 1.5 MB before upload. */
import { readAsDataUrl, type PreparedFile } from '@/lib/upload';
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
export async function preparePhoto(file: File): Promise<PreparedFile & { preview: string }> {
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

