/* The Republic — Scriptable widget for iOS.

   Draws natively rather than showing an image, so text is rendered at the
   phone's own density and stays sharp at any size. An image widget is always a
   compromise: iOS uses roughly three device pixels per point, so a PNG has to
   be sent at 3x and is still softer than real type.

   Setup
     1. Install Scriptable from the App Store
     2. New script, paste this in, name it "Republic"
     3. Change BASE and SITE below
     4. Long-press the home screen → + → Scriptable → pick this script
        Small and medium widgets both work.

   No login. It shows only what the front page shows to anyone.  */

const BASE = 'https://YOUR-SERVICE.onrender.com';
const SITE = 'https://YOUR-USERNAME.github.io/YOUR-REPO/';

const INK = Color.dynamic(new Color('14161c'), new Color('f2f3f5'));
const PAPER = Color.dynamic(new Color('f5f6f7'), new Color('15171c'));
const hex = h => new Color(String(h || '#888888').replace('#', ''));
const small = config.widgetFamily === 'small';

async function load() {
  const r = new Request(BASE + '/api/widget.json');
  r.timeoutInterval = 25;              // a sleeping free instance takes its time
  return r.loadJSON();
}

function offline() {
  const w = new ListWidget();
  w.backgroundColor = PAPER;
  w.url = SITE;
  const t = w.addText('The Republic');
  t.font = Font.semiboldSystemFont(15);
  t.textColor = INK;
  w.addSpacer(4);
  const s = w.addText('Not reachable — it may be waking up.');
  s.font = Font.systemFont(11);
  s.textColor = Color.gray();
  return w;
}

/* The flag, drawn rather than stacked: DrawContext gives exact band widths at
   any widget size, which nested stacks do not. */
function flagStrip(bands) {
  const W = 600, H = 10;
  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const total = bands.reduce((n, b) => n + (b.weight || 1), 0) || 1;
  let x = 0;
  for (const b of bands) {
    const bw = W * ((b.weight || 1) / total);
    ctx.setFillColor(hex(b.colour));
    ctx.fillRect(new Rect(x, 0, bw + 1, H));
    x += bw;
  }
  return ctx.getImage();
}

function officeLine(stack, label, value) {
  const col = stack.addStack();
  col.layoutVertically();
  const l = col.addText(label);
  l.font = Font.systemFont(9);
  l.textColor = Color.gray();
  const v = col.addText(value || 'Vacant');
  v.font = Font.semiboldSystemFont(small ? 12 : 13);
  v.textColor = INK;
  v.lineLimit = 1;
  return col;
}

function build(d) {
  const w = new ListWidget();
  w.url = SITE;
  w.backgroundColor = PAPER;
  w.setPadding(0, 0, 12, 0);

  if (d.bands && d.bands.length) {
    const img = w.addImage(flagStrip(d.bands));
    img.imageSize = new Size(400, 6);
    img.applyFillingContentMode();
  }

  const body = w.addStack();
  body.layoutVertically();
  body.setPadding(10, 14, 0, 14);

  const name = body.addText(d.nation || 'The Republic');
  name.font = Font.boldSystemFont(small ? 15 : 18);
  name.textColor = INK;
  name.lineLimit = 1;

  body.addSpacer(3);
  const head = body.addText(d.headline || '');
  head.font = Font.semiboldSystemFont(small ? 9 : 10);
  head.textColor = hex(d.accent);
  head.lineLimit = 1;

  if (d.subtitle) {
    body.addSpacer(4);
    const sub = body.addText(d.subtitle);
    sub.font = Font.systemFont(small ? 10 : 12);
    sub.textColor = Color.gray();
    sub.lineLimit = small ? 2 : 1;
  }

  body.addSpacer();

  if (small) {
    officeLine(body, 'President', d.president);
  } else {
    const cols = body.addStack();
    cols.layoutHorizontally();
    cols.spacing = 26;
    officeLine(cols, 'President', d.president);
    officeLine(cols, 'Speaker', d.speaker);
    cols.addSpacer();
  }

  body.addSpacer(6);
  const c = d.counts || {};
  const foot = body.addText(small
    ? `${c.laws ?? 0} laws · ${c.citizens ?? 0} citizens`
    : `${c.mps ?? 0} sitting · ${c.laws ?? 0} laws · ${c.citizens ?? 0} citizens`);
  foot.font = Font.systemFont(9);
  foot.textColor = Color.gray();

  // Look again sooner when something is actually happening.
  w.refreshAfterDate = new Date(Date.now() + (d.urgent ? 10 : 30) * 60 * 1000);
  return w;
}

let widget;
try {
  widget = build(await load());
} catch (e) {
  widget = offline();
}

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  small ? widget.presentSmall() : widget.presentMedium();
}
Script.complete();
