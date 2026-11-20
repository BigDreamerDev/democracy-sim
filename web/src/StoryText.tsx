// Stories as written in the group chat: WhatsApp-style formatting, so a story can be pasted straight in.
//   *bold*  **bold**  _italic_  ~strike~
//   a blank line starts a new paragraph; a single line break stays a line break
//   a paragraph that is all *bold* is a subheading; one that is all _italic_ is a dateline or sign-off
//   "# " or "## " starts a heading line, "- " or "• " a bullet, "> " a quotation
// It builds elements, never HTML, so nothing a player writes can inject markup.
import type { ComponentChildren } from 'preact';

// marks must hug their text (*like this*, not * like this *); _ only counts at a word boundary, so snake_case stays
const MARK_SRC = /(\*\*([^*\n]+?)\*\*|\*(\S(?:[^*\n]*?\S)?)\*|_(\S(?:[^_\n]*?\S)?)_|~(\S(?:[^~\n]*?\S)?)~)/g;
const wordy = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
export function inline(s: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let last = 0;
  // a fresh copy each call: inline() recurses for marks inside marks, and a shared /g regex would lose its place
  const MARK = new RegExp(MARK_SRC.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = MARK.exec(s))) {
    const before = s[m.index - 1], after = s[m.index + m[0].length];
    if (m[4] !== undefined && (wordy(before) || wordy(after))) continue;
    if (m.index > last) out.push(s.slice(last, m.index));
    const inner = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    out.push(m[2] !== undefined || m[3] !== undefined ? <b>{inline(inner)}</b> : m[4] !== undefined ? <i>{inline(inner)}</i> : <s>{inline(inner)}</s>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
// a headline: the marks are dropped (headlines are already set in heavy type)
export const plainHeadline = (s: string) => String(s || '').replace(/^\s*[*_~]+|[*_~]+\s*$/g, '').replace(/\*\*?([^*]+)\*\*?/g, '$1');

const whole = (p: string, mark: string) => p.length > 2 && p.startsWith(mark) && p.endsWith(mark) && !p.slice(mark.length, -mark.length).includes(mark);
export function StoryText({ text, small }: { text: string; small?: boolean }) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div class={'story-text' + (small ? ' small' : '')}>
      {paras.map((p) => {
        const lines = p.split('\n');
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return <ul>{lines.map((l) => <li>{inline(l.replace(/^\s*[-•]\s+/, ''))}</li>)}</ul>;
        if (lines.every((l) => /^\s*>\s?/.test(l))) return <blockquote>{lines.map((l, i) => <>{i ? <br /> : null}{inline(l.replace(/^\s*>\s?/, ''))}</>)}</blockquote>;
        if (lines.length === 1 && /^#{1,3}\s+/.test(p)) return <h4 class="story-sub">{inline(p.replace(/^#{1,3}\s+/, ''))}</h4>;
        if (lines.length === 1 && (whole(p, '**') || whole(p, '*'))) return <h4 class="story-sub">{inline(p.replace(/^\*\*?|\*\*?$/g, ''))}</h4>;
        if (whole(p, '_') && !p.includes('\n')) return <p class="story-dateline"><i>{inline(p.slice(1, -1))}</i></p>;
        return <p>{lines.map((l, i) => <>{i ? <br /> : null}{/^#{1,3}\s+/.test(l) ? <b>{inline(l.replace(/^#{1,3}\s+/, ''))}</b> : inline(l)}</>)}</p>;
      })}
    </div>
  );
}
