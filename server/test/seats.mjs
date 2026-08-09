/* Prove the seats never overlap each other, the floor arc, or the edge. */
import fs from 'fs';
const src = fs.readFileSync(new URL('../../docs/app.js', import.meta.url), 'utf8');
const fn = src.slice(src.indexOf('function seatLayout'), src.indexOf('function hemicycle'));
const { seatLayout } = await import('data:text/javascript;base64,' + Buffer.from('export ' + fn).toString('base64'));

let fails = 0;
const ok = (c,m) => { console.log((c?'  ok  ':'FAIL  ')+m); if(!c) fails++; };
const W = 640, H = 300;

for (const n of [1,2,3,5,7,9,12,15,20,25,30,40,60]) {
  const L = seatLayout(n, W, H);
  const pts = [];
  L.radii.forEach((R,row) => {
    const c = L.counts[row];
    for (let i=0;i<c;i++){
      const deg = c===1 ? 90 : (90 + L.span/2) - i*(L.span/(c-1));
      const t = deg*Math.PI/180;
      pts.push([L.cx + R*Math.cos(t), L.cy - R*Math.sin(t)]);
    }
  });
  ok(pts.length === n, `n=${n}: ${n} seats placed in ${L.radii.length} row(s), r=${L.r.toFixed(1)}`);

  let minGap = Infinity;
  for (let a=0;a<pts.length;a++) for (let b=a+1;b<pts.length;b++){
    const d = Math.hypot(pts[a][0]-pts[b][0], pts[a][1]-pts[b][1]);
    minGap = Math.min(minGap, d - 2*L.r);
  }
  if (pts.length > 1) ok(minGap >= -0.01, `n=${n}: closest pair clear by ${minGap.toFixed(2)}px`);

  // no seat crosses the floor arc
  if (L.floor > 20) {
    let worst = Infinity;
    for (const [x,y] of pts) worst = Math.min(worst, Math.hypot(x-L.cx, y-L.cy) - L.r - L.floor);
    ok(worst >= -0.01, `n=${n}: floor arc clears every seat by ${worst.toFixed(2)}px`);
  }
  // everything inside the canvas
  const inside = pts.every(([x,y]) => x-L.r >= 0 && x+L.r <= W && y-L.r >= 0 && y+L.r <= H);
  ok(inside, `n=${n}: all seats inside the viewBox`);
}
console.log(fails ? `\n${fails} FAILURES` : '\nno overlaps at any seat count');
process.exit(fails?1:0);
