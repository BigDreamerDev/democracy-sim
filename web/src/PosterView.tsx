// One poster on the page: renders the SVG, loads the poster fonts, and fits every line to its width once they are in.
import { useEffect, useRef } from 'preact/hooks';
import { fitPosters, loadPosterFonts, posterById, posterData, renderPoster, renderCommission, warPostersFor } from './posters';
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

// a poster on the wall of some other page: picks one of `ids` for the day (the current war's own posters first, then a
// commissioned one if the High Commission has one up), shows any scrawls, and links to the war room
export function WallPoster({ ids, width = 160, caption, float, salt = 0 }: { ids: string[]; width?: number | string; caption?: string; float?: 'right' | 'left'; salt?: number }) {
  const { world: w } = useStore();
  if (!w?.phase || w.phase !== 'running') return null;
  const d = posterData(w);
  const war = warPostersFor(d).map((p) => p.id);
  const pool = [...war.filter(() => !!d.enemyId), ...ids.filter((id) => posterById(id))];
  if (!pool.length) return null;
  const day = Math.floor(w.now / 86400000) + salt;
  const com = w.commission && w.commission.until > w.now ? w.commission : null;
  const scrawls = (id: string) => (w.defaced?.[id] || []).map((x: any) => ({ text: x.text }));
  const useCom = com && day % 3 === 0;
  const id = useCom ? 'decree' : pool[day % pool.length];
  const svg = useCom ? renderCommission(d, com.slogan, nm(w, com.by), { font: com.font, pal: com.pal, graffiti: scrawls('decree') }) : renderPoster(posterById(id)!, d, { graffiti: scrawls(id) });
  return (
    <a href="#/war" class="wall-poster" style={{ display: 'block', width, textDecoration: 'none', color: 'inherit', ...(float ? { float, margin: float === 'right' ? '4px 0 12px 18px' : '4px 18px 12px 0' } : {}) }} title="On the walls: open the war room">
      <PosterSvg svg={svg} />
      {caption && <span class="small muted" style={{ display: 'block', marginTop: 6 }}>{caption}</span>}
    </a>
  );
}
