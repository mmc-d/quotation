import { Fragment, type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Tiny, safe markdown renderer for knowledge-base articles (FSM-85). It understands only:
 * `#`/`##`/`###` headings, paragraphs, `-`/`*` and `1.` lists, `**bold**` and `[text](https://…)` links.
 * Everything is rendered as React text nodes — no HTML is ever injected, and links are limited to
 * http(s), mailto, tel and same-site paths (opened with rel="noopener noreferrer").
 */

type Block =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] };

function parse(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push({ kind: 'p', lines: para });
    para = [];
    if (list) out.push(list);
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = /^\s{0,3}(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: 'h', level: h[1]!.length as 1 | 2 | 3, text: h[2]!.replace(/\s+#+\s*$/, '') }); continue; }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = ul ? null : /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (para.length) { out.push({ kind: 'p', lines: para }); para = []; }
      if (list && list.kind !== kind) { out.push(list); list = null; }
      list ??= { kind, items: [] };
      list.items.push((ul ?? ol)![1]!);
      continue;
    }
    if (list) {
      // an indented line continues the previous list item
      if (/^\s{2,}\S/.test(raw) && list.items.length) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
      out.push(list);
      list = null;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^\/(?!\/)/.test(u)) return u; // same-site path, never protocol-relative
  return null;
}

/** Inline: **bold** and [text](url). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${key}-b${i}`} className="font-extrabold text-ink">{m[1]}</strong>);
    else {
      const href = safeHref(m[3]!);
      out.push(href
        ? <a key={`${key}-a${i}`} href={href} target={href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" className="font-bold text-primary underline decoration-gold/60 underline-offset-2 hover:text-gold-dark">{m[2]}</a>
        : m[2]);
    }
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string | null | undefined; className?: string }) {
  const blocks = parse(source ?? '');
  return (
    <div className={clsx('space-y-3 text-sm leading-relaxed text-ink', className)}>
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        if (b.kind === 'h') {
          if (b.level === 1) return <h2 key={k} className="pt-1 text-lg font-extrabold text-primary">{inline(b.text, k)}</h2>;
          if (b.level === 2) return <h3 key={k} className="pt-1 text-base font-extrabold text-primary">{inline(b.text, k)}</h3>;
          return <h4 key={k} className="text-sm font-extrabold text-gold-dark">{inline(b.text, k)}</h4>;
        }
        if (b.kind === 'p') return <p key={k}>{b.lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `${k}-${li}`)}</Fragment>)}</p>;
        const items = b.items.map((it, ii) => <li key={ii}>{inline(it, `${k}-${ii}`)}</li>);
        return b.kind === 'ul'
          ? <ul key={k} className="list-disc space-y-1 ps-5 marker:text-gold">{items}</ul>
          : <ol key={k} className="list-decimal space-y-1 ps-5 marker:font-bold marker:text-gold-dark">{items}</ol>;
      })}
    </div>
  );
}
