import type { MetadataRoute } from 'next';

/** Installable app (module 06 FSM-40): technicians add «يومي» to the home screen; it opens on /tech. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'المدى المبارك — الفني',
    short_name: 'يومي',
    description: 'Al-Mada Al-Mubarak — technician app: today’s jobs, checklists, photos, serials and signatures',
    start_url: '/tech',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F7F5EF',
    theme_color: '#0D4A2E',
    lang: 'ar',
    dir: 'rtl',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
