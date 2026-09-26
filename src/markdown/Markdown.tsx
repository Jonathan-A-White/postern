// src/markdown/Markdown.tsx — mw-hy6f4.1: the one shared renderer for GitHub-
// flavoured Markdown (headings, lists, emphasis, links, tables, fenced code).
// No rehype-raw: raw HTML in the source is never parsed into elements, so a
// message body is always safe to render without sanitizing it first.
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ href, children, ...props }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
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
