// The copy desk's back end. Finds every piece of text a player can read, and writes reviewed wording back.
//
//   npm run copy:extract          → copy/strings.json (every player-facing string, with where it lives)
//   npm run copy:apply [file]     → writes the edits from copy/edits.json (exported by the desk) into the source
//
// "Player-facing" means: text inside JSX, user-facing props (title, intro, label, placeholder…), toasts and
// confirms, fail() messages, Gazette lines, Influence reasons, stamps, and the text fields of the engine's data
// tables (crises, the Red Box, tutorial missions…). Code-ish strings (ids, routes, class names) are skipped.
// Template strings keep their ${…} parts: an edit must keep every one of them, in any order.
import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { existsSync as has } from 'node:fs';
// the project root: where npm runs from (the dev server bundles this file elsewhere, so not import.meta.url)
const ROOT = has(join(process.cwd(), 'web/src')) ? process.cwd() : new URL('..', import.meta.url).pathname;
const DIRS = ['web/src', 'engine'];
const SKIP_FILES = ['engine/catalog.ts', 'engine/bots.ts', 'web/src/DemoPanel.tsx'];
const PROPS = new Set(['title', 'intro', 'sub', 'label', 'placeholder', 'hint', 'kicker', 'alt', 'aria-label', 'empty', 'confirm', 'head', 'castLabel', 'foot', 'caption']);
const KEYS = new Set(['text', 'title', 'label', 'what', 'blurb', 'q', 'a', 'sub', 'low', 'about', 'effects', 'give', 'get', 'wants', 'name', 'unit', 'hint', 'body', 'intro', 'reason', 'why', 'question', 'headline', 'tag', 'desc', 'description']);
// calls whose arguments are read by players: name → which argument indexes
const CALLS: Record<string, number[]> = { fail: [0], toast: [0], confirm: [0], gazette: [2], earn: [3], spend: [3], stamp: [2, 3], adminDid: [2], act: [2], Error: [0], setMsg: [], meter: [3], approve: [], moodShift: [2], armyLoyalty: [2], addCard: [] };

export type Str = { id: string; file: string; line: number; kind: string; where: string; text: string; template: boolean; start: number; end: number; ctx: string };

const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.(tsx?|ts)$/.test(d.name) ? [join(dir, d.name)] : []));
// does this look like words a person reads, rather than code?
const wordy = (s: string) => /[A-Za-z]/.test(s) && (/\s/.test(s.trim()) || /^[A-Z][a-z’']+[.!?]?$/.test(s.trim()) || /[.!?…]$/.test(s.trim())) && !/^#\//.test(s) && !/^[a-z0-9_.:-]+$/.test(s) && !/^(https?:|\/api)/.test(s) && !/[{};]\s*$/.test(s);

function extractFile(file: string): Str[] {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Str[] = [];
  const seen = new Set<number>();
  const where = (n: ts.Node) => {
    for (let p: ts.Node | undefined = n; p; p = p.parent) {
      if ((ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p)) && p.name) return p.name.text;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.parent.parent && ts.isVariableStatement(p.parent.parent)) return p.name.text;
    }
    return '';
  };
  const add = (n: ts.Node, kind: string) => {
    let text: string, start: number, end: number, template = false;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      text = n.text;
      start = n.getStart(sf) + 1;
      end = n.getEnd() - 1;
      template = ts.isNoSubstitutionTemplateLiteral(n);
    } else if (ts.isTemplateExpression(n)) {
      start = n.getStart(sf) + 1;
      end = n.getEnd() - 1;
      text = src.slice(start, end);
      template = true;
    } else if (ts.isJsxText(n)) {
      const raw = n.getText(sf);
      const lead = raw.length - raw.trimStart().length;
      text = raw.trim().replace(/\s+/g, ' ');
      start = n.getStart(sf) + lead;
      end = start + raw.trim().length;
      if (raw.trim() !== text) return; // multi-line JSX text: rare, and rewrapping it would be risky
    } else return;
    const probe = template ? text.replace(/\$\{[^}]*\}/g, ' x ') : text;
    if (!wordy(probe) || seen.has(start)) return;
    seen.add(start);
    const line = sf.getLineAndCharacterOfPosition(start).line + 1;
    const ctx = src.split('\n')[line - 1].trim().slice(0, 240);
    out.push({ id: '', file, line, kind, where: where(n), text, template, start, end, ctx });
  };
  const strings = (e: ts.Node | undefined, kind: string) => {
    if (!e) return;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return add(e, kind);
    if (ts.isConditionalExpression(e)) return (strings(e.whenTrue, kind), strings(e.whenFalse, kind));
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) return (strings(e.left, kind), strings(e.right, kind));
    if (ts.isParenthesizedExpression(e)) return strings(e.expression, kind);
    if (ts.isArrayLiteralExpression(e)) return e.elements.forEach((x) => strings(x, kind));
    if (ts.isArrowFunction(e) && !ts.isBlock(e.body)) return strings(e.body, kind);
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) add(n, 'screen');
    else if (ts.isJsxAttribute(n) && PROPS.has(n.name.getText(sf)) && n.initializer) {
      if (ts.isStringLiteral(n.initializer)) add(n.initializer, 'label');
      else if (ts.isJsxExpression(n.initializer)) strings(n.initializer.expression, 'label');
    } else if (ts.isJsxExpression(n) && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) strings(n.expression, 'screen');
    else if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      (Object.hasOwn(CALLS, name) ? CALLS[name] : []).forEach((i) => strings(n.arguments?.[i], name === 'gazette' || name === 'adminDid' ? 'gazette' : name === 'fail' || name === 'Error' ? 'message' : name === 'earn' || name === 'spend' ? 'influence' : name === 'stamp' ? 'stamp' : 'message'));
    } else if (ts.isPropertyAssignment(n) && KEYS.has(n.name.getText(sf).replace(/['"]/g, ''))) strings(n.initializer, 'data');
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // stable ids: file + text + which occurrence of that text in the file
  const count: Record<string, number> = {};
  out.sort((a, b) => a.start - b.start).forEach((s) => {
    const k = s.text;
    count[k] = (count[k] || 0) + 1;
    s.id = createHash('sha1').update(`${s.file}\n${k}\n${count[k]}`).digest('hex').slice(0, 12);
  });
  return out;
}

export function extract(): Str[] {
  return DIRS.flatMap(files).filter((f) => !SKIP_FILES.includes(f.replace(/\\/g, '/'))).map((f) => f.replace(/\\/g, '/')).flatMap(extractFile);
}

// writing an edit back: escape for the kind of literal it lives in, and keep every ${…} of a template
function encode(s: Str, text: string, src: string): string {
  const quote = src[s.start - 1];
  if (s.kind === 'screen' && quote !== "'" && quote !== '"' && quote !== '`') {
    // JSX text: braces and angle brackets would become code
    if (/[{}<>]/.test(text)) throw new Error('JSX text can’t contain { } < or >');
    return text;
  }
  if (quote === '`') {
    const want = (s.text.match(/\$\{[^}]*\}/g) || []).sort().join('|');
    const got = (text.match(/\$\{[^}]*\}/g) || []).sort().join('|');
    if (want !== got) throw new Error(`keep every placeholder exactly: ${want.split('|').filter(Boolean).join(' ') || '(none)'}`);
    return text.replace(/`/g, '\\`');
  }
  return text.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), '\\' + quote).replace(/\n/g, '\\n');
}

export type Edit = { id: string; text: string; original?: string };
export function applyEdits(edits: Edit[]) {
  const all = extract();
  const byId = new Map(all.map((s) => [s.id, s]));
  const byFile: Record<string, { s: Str; text: string; id: string }[]> = {};
  const problems: string[] = [];
  const done: string[] = [];
  edits.forEach((e) => {
    const s = byId.get(e.id);
    if (!s) return problems.push(`Not found, the source changed since: “${e.original ?? e.id}”`);
    if (e.original !== undefined && e.original !== s.text) return problems.push(`${s.file}:${s.line}: the original changed in the source; skipped`);
    if (e.text === s.text) return done.push(e.id);
    (byFile[s.file] ||= []).push({ s, text: e.text, id: e.id });
  });
  Object.entries(byFile).forEach(([file, list]) => {
    let src = readFileSync(join(ROOT, file), 'utf8');
    // from the end of the file backwards, so earlier offsets stay right
    list.sort((a, b) => b.s.start - a.s.start).forEach(({ s, text, id }) => {
      try {
        src = src.slice(0, s.start) + encode(s, text, src) + src.slice(s.end);
        done.push(id);
      } catch (err: any) {
        problems.push(`${s.file}:${s.line}: ${err.message}. Skipped “${text}”`);
      }
    });
    writeFileSync(join(ROOT, file), src);
  });
  return { applied: done.length, files: Object.keys(byFile).length, problems, done };
}
export function writeStrings() {
  const all = extract();
  if (!existsSync(join(ROOT, 'copy'))) mkdirSync(join(ROOT, 'copy'));
  writeFileSync(join(ROOT, 'copy/strings.json'), JSON.stringify({ at: new Date().toISOString(), strings: all.map(({ start, end, ...s }) => s) }, null, 1));
  return all;
}
export const EDITS = join(ROOT, 'copy/edits.json');
export const readEdits = () => (existsSync(EDITS) ? JSON.parse(readFileSync(EDITS, 'utf8')) : { edits: [], reviewed: [] });
export const saveEdits = (d: any) => (existsSync(join(ROOT, 'copy')) || mkdirSync(join(ROOT, 'copy')), writeFileSync(EDITS, JSON.stringify(d, null, 1)));

// the command line (only when run directly, not when the dev server imports this file)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  const [, , cmd, arg] = process.argv;
  if (cmd === 'extract') {
    const all = writeStrings();
    const kinds: Record<string, number> = {};
    all.forEach((s) => (kinds[s.kind] = (kinds[s.kind] || 0) + 1));
    console.log(`${all.length} strings → copy/strings.json`, kinds);
  } else if (cmd === 'apply') {
    const path = arg ? join(ROOT, arg) : EDITS;
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const r = applyEdits(data.edits || []);
    console.log(`Applied ${r.applied} edit${r.applied === 1 ? '' : 's'} across ${r.files} file${r.files === 1 ? '' : 's'}.`);
    r.problems.forEach((p) => console.log('  ! ' + p));
    if (!arg) saveEdits({ ...data, edits: (data.edits || []).filter((e: Edit) => !r.done.includes(e.id)) });
    writeStrings();
    console.log('Next: npm run typecheck && npm run smoke.');
  } else console.log('npm run copy:extract | npm run copy:apply [copy/edits.json]');
}
