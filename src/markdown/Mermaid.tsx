// src/markdown/Mermaid.tsx — mw-hy6f4.2: a fenced ```mermaid block draws as a
// diagram. mermaid is ~2.5 MB minified, so it is never imported until a
// diagram is actually on screen: Markdown.tsx only mounts this component for
// a code block whose language is mermaid, and the import happens here, once,
// on first mount. Vite splits the dynamic import into its own chunk, and
// pwa-precache.ts raises the service worker's precache size limit past it so
// it still works offline.
import { useEffect, useState } from 'react';

let initialized = false;
let renderCount = 0;

type MermaidResult = { svg: string } | { error: string };

async function renderDiagram(source: string): Promise<MermaidResult> {
  try {
    const mermaid = (await import('mermaid')).default;
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
      initialized = true;
    }
    renderCount += 1;
    const { svg } = await mermaid.render(`mermaid-diagram-${renderCount}`, source);
    return { svg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message.split('\n')[0] };
  }
}

export interface MermaidProps {
  source: string;
}

export function Mermaid({ source }: MermaidProps) {
  const [result, setResult] = useState<MermaidResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderDiagram(source).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (result && 'svg' in result) {
    return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: result.svg }} />;
  }

  if (result && 'error' in result) {
    return (
      <div className="mermaid-error" data-testid="mermaid-error">
        <pre>{source}</pre>
        <p>{result.error}</p>
      </div>
    );
  }

  return null;
}
