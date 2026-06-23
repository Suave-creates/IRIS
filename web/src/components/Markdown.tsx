import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.css';

/**
 * Renders Claude's markdown (headings, bold, lists, GFM tables) as styled HTML.
 * Raw HTML in the model output is skipped, never injected.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `${styles.md} ${className}` : styles.md}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
