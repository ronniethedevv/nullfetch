import { useCallback, useState } from 'react';

interface Props {
  /** Raw markdown source to copy to the clipboard. */
  markdown: string;
  /** Label shown in the default state. */
  label?: string;
}

/**
 * Small button that copies a markdown blob to the clipboard. Used at
 * the top of each docs page so devs can paste the page source into
 * AI assistants, offline notes, or their own forks. Transient
 * "copied ✓" feedback for 2 seconds, then resets.
 */
export function CopyMarkdownButton({ markdown, label = 'copy as markdown' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setState('copied');
      window.setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 2000);
    }
  }, [markdown]);

  return (
    <button
      type="button"
      className={`docs__copy-btn mono docs__copy-btn--${state}`}
      onClick={onCopy}
      aria-label="Copy page as markdown"
    >
      {state === 'copied' ? 'copied ✓' : state === 'error' ? 'copy failed' : `${label} ↗`}
    </button>
  );
}
