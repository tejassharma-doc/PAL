'use client';

/**
 * Renders PAL's Markdown answers (### headings, **bold**, * bullets, links, ---)
 * as real React elements. Parsing lives in lib/markdown.ts (shared with the
 * Android app); this file only decides how each block looks on the web.
 *
 * No HTML strings are produced, so there is nothing to sanitise.
 */

import React, { useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import { parseMarkdown, markdownToPlainText as markdownToPlainTextLocal, type Block, type Inline } from '@/lib/markdown';

const INK = '#0d1f24';
const MUTED = '#4a5a5f';
const JADE_DEEP = '#1f7d6b';
const SERIF = "'Newsreader', Georgia, serif";
const SANS = "'Space Grotesk', ui-sans-serif, system-ui, sans-serif";
const MONO = "'Space Mono', ui-monospace, monospace";

const HEADING_SIZE: Record<number, number> = { 1: 19, 2: 18, 3: 17 };

function renderInline(nodes: Inline[], keyPrefix = 'i'): React.ReactNode[] {
  return nodes.map((n, k) => {
    const key = `${keyPrefix}-${k}`;
    switch (n.t) {
      case 'text':
        return <React.Fragment key={key}>{n.v}</React.Fragment>;
      case 'b':
        return <strong key={key} style={{ fontWeight: 700 }}>{renderInline(n.c, key)}</strong>;
      case 'i':
        return <em key={key} style={{ fontStyle: 'italic' }}>{renderInline(n.c, key)}</em>;
      case 'code':
        return (
          <code key={key} style={{ fontFamily: MONO, fontSize: '0.88em', background: 'rgba(13,31,36,.06)', borderRadius: 5, padding: '1px 5px' }}>
            {n.v}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: JADE_DEEP, textDecoration: 'underline', textUnderlineOffset: 2, wordBreak: 'break-word', overflowWrap: 'anywhere' }}
          >
            {renderInline(n.c, key)}
          </a>
        );
      default:
        return null;
    }
  });
}

function plainStart(nodes: Inline[]): string {
  const first = nodes[0];
  if (!first) return '';
  if (first.t === 'text' || first.t === 'code') return first.v;
  return plainStart(first.c);
}

function isDisclaimer(b: Block): boolean {
  if (b.t !== 'p') return false;
  const first = b.c[0];
  return !!first && first.t === 'b' && /^\s*disclaimer/i.test(plainStart(first.c));
}

const para: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 16,
  lineHeight: 1.6,
  color: INK,
  margin: '0 0 10px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

export default function Markdown({ text, style }: { text: string; style?: React.CSSProperties }) {
  const blocks = useMemo(() => parseMarkdown(text || ''), [text]);

  return (
    <div
      className="pal-md"
      style={{ fontFamily: SANS, fontSize: 16, lineHeight: 1.6, color: INK, userSelect: 'text', WebkitUserSelect: 'text', ...style }}
    >
      {blocks.map((b, k) => {
        const key = `b-${k}`;
        switch (b.t) {
          case 'h': {
            const size = HEADING_SIZE[b.level] ?? 16;
            const Tag = (b.level <= 3 ? `h${b.level}` : 'h4') as 'h1' | 'h2' | 'h3' | 'h4';
            return (
              <Tag
                key={key}
                style={{ fontFamily: SERIF, fontSize: size, fontWeight: 600, lineHeight: 1.3, color: INK, margin: k === 0 ? '0 0 6px' : '14px 0 6px' }}
              >
                {renderInline(b.c, key)}
              </Tag>
            );
          }
          case 'p':
            if (isDisclaimer(b)) {
              return (
                <p
                  key={key}
                  style={{ ...para, fontSize: 14.5, lineHeight: 1.55, color: MUTED, background: 'rgba(13,31,36,.04)', borderRadius: 10, padding: '10px 12px' }}
                >
                  {renderInline(b.c, key)}
                </p>
              );
            }
            return <p key={key} style={para}>{renderInline(b.c, key)}</p>;
          case 'ul':
            return (
              <ul key={key} style={{ margin: '0 0 10px', paddingLeft: 22, listStyleType: 'disc' }}>
                {b.items.map((it, j) => (
                  <li key={j} style={{ ...para, margin: j === b.items.length - 1 ? 0 : '0 0 6px', paddingLeft: 2 }}>
                    {renderInline(it, `${key}-${j}`)}
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} start={b.start} style={{ margin: '0 0 10px', paddingLeft: 24, listStyleType: 'decimal' }}>
                {b.items.map((it, j) => (
                  <li key={j} style={{ ...para, margin: j === b.items.length - 1 ? 0 : '0 0 6px', paddingLeft: 2 }}>
                    {renderInline(it, `${key}-${j}`)}
                  </li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote key={key} style={{ ...para, borderLeft: '3px solid rgba(31,125,107,.35)', paddingLeft: 12, color: MUTED }}>
                {renderInline(b.c, key)}
              </blockquote>
            );
          case 'hr':
            return <hr key={key} style={{ border: 'none', borderTop: '1px solid rgba(13,31,36,.14)', margin: '12px 0' }} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

export { markdownToPlainText } from '@/lib/markdown';

/**
 * Small "Copy" button for an answer: copies the Markdown as plain text
 * (symbols removed) and shows "Copied" for 2 s.
 */
export function CopyAnswerButton({ text, style }: { text: string; style?: React.CSSProperties }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    const plain = markdownToPlainTextLocal(text);
    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(plain);
        ok = true;
      }
    } catch { /* fall back below */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = plain;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : 'Copy answer'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'none', border: '1px solid rgba(13,31,36,.14)', borderRadius: 9,
        padding: '6px 10px', minHeight: 32, cursor: 'pointer',
        fontFamily: SANS, fontSize: 13, fontWeight: 600,
        color: copied ? JADE_DEEP : '#2f3b40',
        ...style,
      }}
    >
      {copied ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={2} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
