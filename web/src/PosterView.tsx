// One poster on the page: renders the SVG, loads the poster fonts, and fits every line to its width once they are in.
import { useEffect, useRef } from 'preact/hooks';
import { fitPosters, loadPosterFonts, posterById, posterData, renderPoster, renderCommission } from './posters';
import { useStore } from './store';
import { nm } from '../../engine/index';

export function PosterSvg({ svg, onOpen, label, width }: { svg: string; onOpen?: () => void; label?: string; width?: number | string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitPosters(el);
    let live = true;
    loadPosterFonts().then(() => live && ref.current && fitPosters(ref.current));
    return () => void (live = false);
  }, [svg]);
  const html = svg.replace('<svg ', '<svg style="display:block;width:100%;height:auto" ');
  return onOpen
    ? <button type="button" aria-label={label} onClick={onOpen} style={{ padding: 0, border: 0, background: 'none', cursor: 'zoom-in', width: width ?? '100%', boxShadow: '3px 3px 0 var(--shadow)' }}><div ref={ref} dangerouslySetInnerHTML={{ __html: html }} /></button>
    : <div ref={ref} style={{ width: width ?? '100%', boxShadow: '3px 3px 0 var(--shadow)' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

// a poster that went up in the Gazette (g.poster): the war's first poster, or a commissioned one
export function GazettePoster({ p, width = 140 }: { p: { id: string; slogan?: string; by?: string; font?: string; pal?: string }; width?: number }) {
  const { world: w } = useStore();
  const d = posterData(w);
  const svg = p.id === 'decree' && p.slogan ? renderCommission(d, p.slogan, nm(w, p.by), { font: p.font, pal: p.pal }) : posterById(p.id) ? renderPoster(posterById(p.id)!, d) : null;
  if (!svg) return null;
  return <a href="#/war" style={{ display: 'block', width, marginTop: 8 }}><PosterSvg svg={svg} /></a>;
}
