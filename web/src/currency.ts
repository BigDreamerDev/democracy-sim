// The currency's name on screen. A law can rename the crown (config.currency); rather than thread the name through
// every string, this rewrites the page's text as it renders, with the same rule the digest uses (engine/core.ts).
import { useEffect } from 'preact/hooks';
import { currencyText } from '../../engine/index';

export function useCurrency(w: any) {
  const c = w?.config?.currency || null;
  const key = c ? `${c.one}/${c.many}` : '';
  useEffect(() => {
    if (!c) return;
    const cw = { config: { currency: c } };
    const fix = (n: Node) => {
      if (n.nodeType === 3) {
        if (n.parentElement?.closest('textarea, [contenteditable]')) return;
        const t = n.nodeValue || '';
        const r = currencyText(cw, t);
        if (r !== t) n.nodeValue = r;
      } else if (n.nodeType === 1) n.childNodes.forEach(fix);
    };
    fix(document.body);
    const mo = new MutationObserver((ms) => ms.forEach((m) => (m.type === 'characterData' ? fix(m.target) : m.addedNodes.forEach(fix))));
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  }, [key]);
}
