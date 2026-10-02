// src/markdown/Markdown.tsx — mw-hy6f4.1: the one shared renderer for GitHub-
// flavoured Markdown (headings, lists, emphasis, links, tables, fenced code).
// No rehype-raw: raw HTML in the source is never parsed into elements, so a
// message body is always safe to render without sanitizing it first.
//
// mw-hy6f4.2: a fenced code block tagged ```mermaid draws as a diagram
// instead of as a code block. react-markdown always wraps a fenced code
// block's `code` element in a `pre`; overriding `pre` (rather than `code`)
// lets a mermaid block skip that wrapper entirely.
import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
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

const components: Components = {
  // mw-t64a3.21: a link to this app's own address is an in-app move (src/router.ts
  // takes the click), so Back returns to where it was tapped; any other opens a new tab.
  a: ({ href, children, ...props }) =>
    href && inAppHref(href) !== null ? (
      <a href={href} {...props}>
        {children}
      </a>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    ),
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

export function Markdown({ text, wrap = false, inline = false }: MarkdownProps) {
  const className = ['markdown', wrap && 'markdown-wrap', inline && 'markdown-item'].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBeadLinks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
