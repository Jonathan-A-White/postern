// src/markdown/Markdown.tsx — mw-hy6f4.1: the one shared renderer for GitHub-
// flavoured Markdown (headings, lists, emphasis, links, tables, fenced code).
// No rehype-raw: raw HTML in the source is never parsed into elements, so a
// message body is always safe to render without sanitizing it first.
//
// mw-hy6f4.2: a fenced code block tagged ```mermaid draws as a diagram
// instead of as a code block. react-markdown always wraps a fenced code
// block's `code` element in a `pre`; overriding `pre` (rather than `code`)
// lets a mermaid block skip that wrapper entirely.
import { isValidElement, memo, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { inAppHref } from '../router';
import { remarkBeadLinks } from './beadLinks';
import { CodeBlock } from '../ui/CodeBlock';
import { Mermaid } from './Mermaid';

function mermaidSource(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(child) ||
    typeof child.props.className !== 'string' ||
    !child.props.className.split(' ').includes('language-mermaid')
  ) {
    return null;
  }
  return String(child.props.children).replace(/\n$/, '');
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return String(node);
}

/** A scheme that runs script in this page or reads a local file: never kept, whatever the text says. */
const UNSAFE_SCHEMES = new Set(['javascript', 'vbscript', 'data', 'file', 'blob']);

const schemeOf = (url: string): string => /^\s*([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase() ?? '';

/** mw-ev7oyy.40: react-markdown blanks every scheme but http(s), mailto and a few more, so a kindle://, tel:, sms: or intent:
 * link lost its href and a tap re-opened the page it stood on ('That post is not on this phone'). A link to another app keeps
 * its href for the phone to hand over; only a scheme that runs script here, or reads a local file, is dropped. */
function keepLinkUrl(url: string): string {
  const scheme = schemeOf(url);
  if (UNSAFE_SCHEMES.has(scheme)) return '';
  return scheme ? url : defaultUrlTransform(url);
}

const components: Components = {
  // mw-t64a3.21: a link to this app's own address is an in-app move (src/router.ts
  // takes the click), so Back returns to where it was tapped; any other web page opens a new tab.
  // mw-ev7oyy.40: a link with another scheme (kindle:, tel:, sms:, intent:, mailto:) is a plain anchor: no new tab, and
  // src/router.ts leaves its click alone, so Android hands it to the app that owns the scheme.
  a: ({ href, children, ...props }) => {
    const scheme = href ? schemeOf(href) : '';
    return !href || inAppHref(href) !== null || (scheme !== 'http' && scheme !== 'https' && scheme !== '') ? (
      <a href={href} {...props}>
        {children}
      </a>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  pre: ({ children }) => {
    const source = mermaidSource(children);
    if (source !== null) {
      return <Mermaid source={source} />;
    }
    return <CodeBlock text={textOf(children).replace(/\n$/, '')}>{children}</CodeBlock>;
  },
};

export interface MarkdownProps {
  text: string;
  /** Wrap a fenced block's long lines instead of scrolling them (a thread message on a phone). */
  wrap?: boolean;
  /** Take the size, line height and colour of the surroundings and no space between paragraphs (a card's item). */
  inline?: boolean;
}

/** Memoized on its three props: a message is parsed once, however often its bubble or the channel around it redraws (mw-q6n8m0.6). */
export const Markdown = memo(function Markdown({ text, wrap = false, inline = false }: MarkdownProps) {
  const className = ['markdown', wrap && 'markdown-wrap', inline && 'markdown-item'].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBeadLinks]} components={components} urlTransform={keepLinkUrl}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
