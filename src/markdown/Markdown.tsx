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

const components: Components = {
  a: ({ href, children, ...props }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
  pre: ({ children, ...props }) => {
    const source = mermaidSource(children);
    if (source !== null) {
      return <Mermaid source={source} />;
    }
    return <pre {...props}>{children}</pre>;
  },
};

export interface MarkdownProps {
  text: string;
}

export function Markdown({ text }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
