/* ============================================================================
   game-ladder.js — 사다리타기
   ----------------------------------------------------------------------------
   공정성
     가로줄을 무작위로 뿌리기만 하면 결과가 균등하지 않다. 사다리는 한 번에 옆으로
     한 칸씩만 움직이므로, 연결선이 유한하면 끝 줄은 끝에 머무를 확률이 높다.
     (5팀·14행 실측: 1번 줄 → 1번 도착 27.0% vs 5번 도착 12.7%)

     그래서 순서를 뒤집는다.
       ① 결과 순열 π 를 crypto 기반 Fisher-Yates 로 먼저 균등하게 뽑는다
       ② 위·아래에 자유 랜덤 블록 A, B 를 깐다
       ③ 가운데 보정 블록 C 를 odd-even transposition network 로 만들어
          B∘C∘A = π 가 되도록 맞춘다.  C = B⁻¹ ∘ π ∘ A⁻¹
     결과: 상단 팀 순서는 입력 그대로, 사다리는 매번 새로 그려지고,
           화면의 사다리를 실제로 타고 내려간 결과가 곧 균등 추첨 결과다.
   ========================================================================= */
(() => {
'use strict';

const RUN_SEC = 3.2;      // 구슬이 다 내려오는 데 걸리는 시간(초)
const H_SLOW  = 0.55;     // 옆으로 이동할 때 감속 비율
const BEZ_N   = 16;       // 대각 곡선 샘플 수
const DEF_GAP = 5;        // 칸(세로줄 사이)마다 보장할 최소 연결선 수

let H=null, G=null, cv=null, cx=null, CW=0, CH=0, DPR=1;
let raf=0, lastT=0, particles=[], running=false, doneCount=0;
let elAll=null, elShuffle=null, scroller=null, camX=0;

/* ── 연결선 ─────────────────────────────────────────────────────────────
   {a,b,h0,h1} : 이웃한 세로줄 a, b(=a+1) 를 잇는 선.
   h0==h1 이면 직선, 다르면 대각 곡선(기울기 방향 랜덤).            */
function mkRung(a,b,diag){
  const isDiag = (diag===undefined) ? (H.rnd()<0.55) : diag;
  if(!isDiag){ const h=0.12+H.rnd()*0.76; return {a,b,h0:h,h1:h}; }
  const d=0.74+H.rnd()*0.24, up=H.rnd()<0.5;
  return {a,b,h0:up?0.5-d/2:0.5+d/2, h1:up?0.5+d/2:0.5-d/2};
}
/* 자유 블록 — 칸마다 perGap 개를 등간격으로 흩어 배치.
   한 행에 이웃 칸을 같이 놓을 수 없으므로 짝수/홀수 칸의 목표 행 위상을 어긋내고,
   같은 칸끼리는 최소 2행 간격을 강제한다. 빈 행도 유지해 간격을 고르게 만든다. */
function buildFreeBlock(n,perGap){
  const Gn=n-1, R=2*perGap+3, step=R/perGap;
  const rows=Array.from({length:R},()=>[]);
  const used=Array.from({length:R},()=>new Set());
  for(const i of H.shuffle([...Array(Gn).keys()])){
    const kinds=[]; for(let k=0;k<perGap;k++) kinds.push(k%2===0);
    H.shuffle(kinds);
    const phase=(i%2)?0.72:0.22, mine=[];
    for(let k=0;k<perGap;k++){
      const t=Math.round((k+phase)*step+(H.rnd()*1.6-0.8));
      let best=-1;
      for(let pass=0;pass<2&&best<0;pass++){
        for(let d=0;d<R&&best<0;d++){
          for(const r of [t+d,t-d]){
            if(r<0||r>=R) continue;
            if(used[r].has(i)||used[r].has(i+1)) continue;
            if(pass===0 && mine.some(pr=>Math.abs(pr-r)<2)) continue;
            best=r; break;
          }
        }
      }
      if(best<0) continue;
      rows[best].push(mkRung(i,i+1,kinds[k]));
      used[best].add(i); used[best].add(i+1); mine.push(best);
    }
  }
  return rows;
}
function walk(rungs,c){
  for(let r=0;r<rungs.length;r++){
    const row=rungs[r];
    for(let k=0;k<row.length;k++){
      const g=row[k];
      if(g.a===c){ c=g.b; break; }
      if(g.b===c){ c=g.a; break; }
    }
  }
  return c;
}
const blockPerm=(rows,n)=>{ const p=[]; for(let c=0;c<n;c++) p[c]=walk(rows,c); return p; };
const invPerm=p=>{ const q=[]; p.forEach((v,i)=>q[v]=i); return q; };

/* odd-even transposition network: n 라운드면 어떤 순열이든 반드시 구현된다.
   각 행이 겹치지 않는 인접쌍만 쓰므로 사다리 한 행으로 그대로 사용 가능. */
function oddEvenRows(key,n){
  const k=key.slice(), rows=[];
  for(let r=0;r<n;r++){
    const row=[];
    for(let j=r%2;j+1<n;j+=2)
      if(k[j]>k[j+1]){ const t=k[j]; k[j]=k[j+1]; k[j+1]=t; row.push(mkRung(j,j+1)); }
    rows.push(row);
  }
  return rows;
}
function buildFairLadder(n,perGap){
  const half=Math.max(1,Math.ceil(perGap/2));
  const A=buildFreeBlock(n,half), B=buildFreeBlock(n,half);
  const pi=H.shuffle([...Array(n).keys()]);
  const Ai=invPerm(blockPerm(A,n)), Bi=invPerm(blockPerm(B,n));
  const C=[]; for(let x=0;x<n;x++) C[x]=Bi[pi[Ai[x]]];
  return { rungs:A.concat(oddEvenRows(C,n),B), pi };
}

function baseTip(){
  const wide = scroller && scroller.scrollWidth-scroller.clientWidth>2;
  const base = G.mode==='all' ? '전체 출발 버튼을 누르세요' : '팀 카드를 눌러 출발합니다';
  return base + (wide ? ' · 좌우로 밀어서 볼 수 있어요' : '');
}

/* ── DOM ─────────────────────────────────────────────────────────────── */
function buildDOM(){
  const n=G.n, dc = n>=13?'d2':(n>=8?'d1':'');
  H.stage.innerHTML =
    '<div class="ladder-scroll" id="ldScroll"><div class="ladder-inner" style="--ld-cols:'+n+'">'+
      '<div class="row-cards'+(dc?' '+dc:'')+'" id="ldTop"></div>'+
      '<div class="canvas-wrap"><canvas id="ldCv"></canvas></div>'+
      '<div class="row-cards'+(dc?' '+dc:'')+'" id="ldBot"></div>'+
    '</div></div>';
  scroller=document.getElementById('ldScroll');
  const top=document.getElementById('ldTop'), bot=document.getElementById('ldBot');
  for(let c=0;c<n;c++){
    const tm=G.teams[c];
    const el=document.createElement('div');
    el.className='tcard'+(G.mode==='one'?' click pulse':'');
    el.dataset.col=c;
    el.innerHTML='<div class="bar" style="background:linear-gradient(90deg,'+tm.color+','+tm.color+'00)"></div>'+
      (H.settings.showNo?'<div class="no">TEAM '+tm.no+'</div>':'')+
      '<div class="nm">'+H.esc(tm.name)+'</div>';
    el.style.borderColor=tm.color+'88';
    el.style.boxShadow='0 10px 30px '+tm.color+'22';
    if(G.mode==='one') el.addEventListener('click',()=>runOne(c));
    top.appendChild(el);
  }
  for(let j=0;j<n;j++){
    const el=document.createElement('div');
    el.className='dcard'; el.dataset.dest=j;
    el.innerHTML='<div class="ord">'+H.slot(j)+'</div><div class="q">? ? ?</div>';
    bot.appendChild(el);
  }
  cv=document.getElementById('ldCv'); cx=cv.getContext('2d');
}

/* ── 배치 ────────────────────────────────────────────────────────────── */
function layout(){
  if(!G||!cv) return;
  const wrap=cv.parentElement, r=wrap.getBoundingClientRect();
  CW=r.width; CH=r.height;
  DPR=Math.min(window.devicePixelRatio||1,2);
  cv.width=Math.round(CW*DPR); cv.height=Math.round(CH*DPR);
  cx.setTransform(DPR,0,0,DPR,0,0);
  const cards=Array.from(document.querySelectorAll('#ldTop .tcard'));
  G.cols=cards.map(el=>{ const b=el.getBoundingClientRect(); return b.left+b.width/2-r.left; });
  computeGeometry();
  G.orbs.forEach(o=>{
    const k=o.total?o.dist/o.total:0, p=buildPath(o.col);
    o.pts=p.pts; o.segs=p.segs; o.total=p.total; o.wtotal=p.wtotal;
    o.v=p.wtotal/RUN_SEC; o.dist=p.total*k;
  });
}
/* 행 높이는 균일하게 깔고, 대각선은 위아래 '빈 행'만큼 늘려 기울기를 살린다.
   이웃 칸(i-1,i,i+1)에 연결선이 없는 행으로만 확장하므로 결과에 영향이 없다. */
function computeGeometry(){
  const R=G.rows, rows=G.rungs;
  const pad=Math.max(8,CH*0.018), usable=CH-pad*2, gh=usable/R;
  G.rowY=[]; for(let r=0;r<R;r++) G.rowY.push(pad+r*gh);
  const occ=rows.map(row=>new Set(row.map(g=>g.a)));
  const hit=(r,i)=> r<0||r>=R||occ[r].has(i-1)||occ[r].has(i)||occ[r].has(i+1);
  const M=Math.min(7,gh*0.22), MAXH=gh*3.4;
  for(let r=0;r<R;r++){
    for(const g of rows[r]){
      const yc=pad+(r+0.5)*gh;
      if(Math.abs(g.h0-g.h1)<0.02){ g.ya=g.yb=yc; continue; }
      let up=r,dn=r;
      while(!hit(up-1,g.a)) up--;
      while(!hit(dn+1,g.a)) dn++;
      let top=pad+up*gh+M, bot=pad+(dn+1)*gh-M;
      if(bot-top>MAXH){ top=yc-MAXH/2; bot=yc+MAXH/2; }
      if(bot-top<gh*0.5){ top=yc-gh*0.25; bot=yc+gh*0.25; }
      const dnFirst=g.h0<g.h1;
      g.ya=dnFirst?top:bot; g.yb=dnFirst?bot:top;
    }
  }
}
function bezPts(x0,y0,x1,y1,out){
  const c=(x1-x0)*0.42;
  for(let i=1;i<=BEZ_N;i++){
    const t=i/BEZ_N, u=1-t;
    out.push({ x:u*u*u*x0+3*u*u*t*(x0+c)+3*u*t*t*(x1-c)+t*t*t*x1,
               y:u*u*u*y0+3*u*u*t*y0    +3*u*t*t*y1    +t*t*t*y1 });
  }
}
function buildPath(col){
  const x=G.cols, pts=[]; let c=col;
  pts.push({x:x[c],y:0});
  for(let r=0;r<G.rows;r++){
    for(const g of G.rungs[r]){
      let nc=-1, ya, yb;
      if(g.a===c){ nc=g.b; ya=g.ya; yb=g.yb; }
      else if(g.b===c){ nc=g.a; ya=g.yb; yb=g.ya; }
      if(nc<0) continue;
      pts.push({x:x[c],y:ya});
      bezPts(x[c],ya,x[nc],yb,pts);
      c=nc; break;
    }
  }
  pts.push({x:x[c],y:CH});
  const segs=[]; let total=0, wtotal=0;
  for(let i=1;i<pts.length;i++){
    const dx=pts[i].x-pts[i-1].x, dy=pts[i].y-pts[i-1].y;
    const len=Math.hypot(dx,dy), horiz=Math.abs(dx)>Math.abs(dy);
    segs.push({len,start:total,horiz});
    total+=len; wtotal+=len*(horiz?1/H_SLOW:1);
  }
  return {pts,segs,total,wtotal};
}
function posAt(o,d){
  let i=0;
  while(i<o.segs.length-1 && d>o.segs[i].start+o.segs[i].len) i++;
  const s=o.segs[i], a=o.pts[i], b=o.pts[i+1];
  const k=s.len?Math.min(1,Math.max(0,(d-s.start)/s.len)):1;
  return {x:a.x+(b.x-a.x)*k, y:a.y+(b.y-a.y)*k, seg:i, horiz:s.horiz};
}

/* ── 파티클 ──────────────────────────────────────────────────────────── */
function spark(x,y,color,count,power){
  if(!H.settings.useFx) return;
  for(let i=0;i<count;i++){
    const a=H.rnd()*Math.PI*2, sp=(0.4+H.rnd())*power;
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-0.4,life:1,
      decay:0.014+H.rnd()*0.022, size:1.3+H.rnd()*2.6, color});
  }
  if(particles.length>460) particles.splice(0,particles.length-460);
}
function stepParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.x+=p.vx*dt*60; p.y+=p.vy*dt*60;
    p.vy+=0.045*dt*60; p.vx*=0.985; p.vy*=0.985;
    p.life-=p.decay*dt*60;
    if(p.life<=0) particles.splice(i,1);
  }
}

/* ── 렌더 ────────────────────────────────────────────────────────────── */
function drawBase(){
  const x=G.cols;
  cx.lineCap='round';
  cx.strokeStyle='rgba(255,255,255,.20)'; cx.lineWidth=3;
  cx.beginPath();
  for(let c=0;c<G.n;c++){ cx.moveTo(x[c],0); cx.lineTo(x[c],CH); }
  cx.stroke();
  cx.strokeStyle='rgba(255,255,255,.30)'; cx.lineWidth=3.4;
  cx.beginPath();
  for(let r=0;r<G.rows;r++) for(const g of G.rungs[r]){
    const xa=x[g.a], xb=x[g.b], c=(xb-xa)*0.42;
    cx.moveTo(xa,g.ya); cx.bezierCurveTo(xa+c,g.ya,xb-c,g.yb,xb,g.yb);
  }
  cx.stroke();
  cx.fillStyle='rgba(255,255,255,.34)';
  for(let r=0;r<G.rows;r++) for(const g of G.rungs[r]){
    cx.beginPath(); cx.arc(x[g.a],g.ya,3,0,7); cx.fill();
    cx.beginPath(); cx.arc(x[g.b],g.yb,3,0,7); cx.fill();
  }
}
function drawTrail(o){
  const d=o.dist, fin=o.finished;
  cx.lineCap='round'; cx.lineJoin='round'; cx.save();
  if(H.settings.useFx){ cx.shadowColor=o.color; cx.shadowBlur=fin?10:22; }
  cx.strokeStyle=o.color; cx.globalAlpha=fin?0.42:0.9; cx.lineWidth=fin?4:6;
  cx.beginPath(); cx.moveTo(o.pts[0].x,o.pts[0].y);
  for(let i=1;i<o.pts.length;i++){
    const s=o.segs[i-1];
    if(s.start+s.len<=d) cx.lineTo(o.pts[i].x,o.pts[i].y); else break;
  }
  if(!fin){ const p=posAt(o,d); cx.lineTo(p.x,p.y); }
  cx.stroke(); cx.restore();
}
function drawOrb(o){
  const p=posAt(o,o.dist), R=13;
  cx.save();
  if(H.settings.useFx){ cx.shadowColor=o.color; cx.shadowBlur=30; }
  const g=cx.createRadialGradient(p.x,p.y,0,p.x,p.y,R);
  g.addColorStop(0,'#ffffff'); g.addColorStop(.42,o.color); g.addColorStop(1,o.color+'00');
  cx.fillStyle=g; cx.beginPath(); cx.arc(p.x,p.y,R,0,7); cx.fill();
  cx.restore();
  cx.fillStyle='#fff'; cx.beginPath(); cx.arc(p.x,p.y,3.6,0,7); cx.fill();
}
function render(){
  if(!cx||!G) return;
  cx.clearRect(0,0,CW,CH);
  drawBase();
  G.orbs.filter(o=>o.finished).forEach(drawTrail);
  G.orbs.filter(o=>!o.finished).forEach(drawTrail);
  if(H.settings.useFx){
    cx.save(); cx.globalCompositeOperation='lighter';
    for(const p of particles){
      cx.globalAlpha=Math.max(0,p.life)*0.9; cx.fillStyle=p.color;
      cx.beginPath(); cx.arc(p.x,p.y,p.size,0,7); cx.fill();
    }
    cx.restore(); cx.globalAlpha=1;
  }
  G.orbs.filter(o=>!o.finished).forEach(drawOrb);
}

/* ── 진행 ────────────────────────────────────────────────────────────── */
function tick(now){
  const dt=Math.min(0.05,(now-lastT)/1000); lastT=now;
  stepOrbs(dt); stepParticles(dt); render(); followOrbs(dt);
  raf=requestAnimationFrame(tick);
}
/* 가로 스크롤이 생긴 좁은 화면에서는 움직이는 구슬을 화면 안에 붙잡아 둔다 */
function followOrbs(dt){
  if(!scroller||!G) return;
  const over=scroller.scrollWidth-scroller.clientWidth;
  if(over<=2) return;
  const live=G.orbs.filter(o=>!o.finished && o.delay<=0);
  if(!live.length) return;
  let sum=0;
  for(const o of live) sum+=posAt(o,o.dist).x;
  const target=Math.max(0,Math.min(over, sum/live.length - scroller.clientWidth/2));
  camX += (target-camX)*Math.min(1,dt*3.5);
  scroller.scrollLeft=camX;
}
function stepOrbs(dt){
  if(!G) return;
  for(const o of G.orbs){
    if(o.finished) continue;
    if(o.delay>0){ o.delay-=dt; continue; }
    const cur=posAt(o,o.dist);
    o.dist += o.v*(cur.horiz?H_SLOW:1)*dt;
    const np=posAt(o,Math.min(o.dist,o.total));
    if(np.seg!==o.lastSeg){
      if(o.lastSeg>=0){ const j=o.pts[np.seg]; spark(j.x,j.y,o.color,np.horiz?11:9,2.5); }
      o.lastSeg=np.seg;
    }
    if(H.settings.useFx && H.rnd()<0.55)
      particles.push({x:np.x+(H.rnd()-.5)*5,y:np.y+(H.rnd()-.5)*5,
        vx:(H.rnd()-.5)*.7,vy:(H.rnd()-.5)*.7,life:1,decay:.05+H.rnd()*.03,
        size:1+H.rnd()*1.8,color:o.color});
    if(o.dist>=o.total){ o.dist=o.total; arrive(o); }
  }
}
function arrive(o){
  o.finished=true;
  const p=o.pts[o.pts.length-1];
  spark(p.x,p.y-6,o.color,30,4.2);
  spark(p.x,p.y-6,'#ffffff',12,3.0);
  const dj=G.dest[o.col], tm=G.teams[o.col];
  G.results[dj]=o.col;
  const card=document.querySelector('#ldBot .dcard[data-dest="'+dj+'"]');
  card.classList.add('filled','pop');
  card.style.borderColor=tm.color;
  card.style.borderWidth='3px';
  card.style.boxShadow='0 10px 34px '+tm.color+'66, 0 0 0 1px '+tm.color+'99, inset 0 0 26px rgba(8,6,26,.45)';
  card.innerHTML='<div class="ord" style="opacity:.9">'+H.slot(dj)+'</div>'+
                 '<div class="win" style="color:'+H.lighten(tm.color,0.3)+'">'+H.esc(tm.name)+'</div>';
  setTimeout(()=>card.classList.remove('pop'),700);
  const tc=document.querySelector('#ldTop .tcard[data-col="'+o.col+'"]');
  tc.classList.remove('active'); tc.classList.add('done');
  doneCount++; H.setCounter(doneCount,G.n);
  if(doneCount>=G.n){ running=false; H.finish(G.results); }
  else if(G.mode==='one'){ running=false; H.setTip(baseTip()); }
}
function launch(col,delay){
  const p=buildPath(col);
  G.orbs.push({col,color:G.teams[col].color,dist:0,pts:p.pts,segs:p.segs,
    total:p.total,wtotal:p.wtotal,v:p.wtotal/RUN_SEC,finished:false,lastSeg:-1,delay:delay||0});
}
async function runOne(col){
  if(!G||running) return;
  if(G.orbs.some(o=>o.col===col)) return;
  running=true;
  document.querySelector('#ldTop .tcard[data-col="'+col+'"]').classList.add('active');
  H.setTip('이동 중…');
  await H.countdown(2);
  launch(col,0);
}
async function runAll(){
  if(!G||running||G.orbs.length) return;
  running=true; elAll.disabled=true; H.setTip('이동 중…');
  await H.countdown(3);
  for(let c=0;c<G.n;c++) launch(c,c*0.16);
}
function newLadder(){
  const perGap = Math.max(2, Math.min(12, (H.opts().perGap|0) || DEF_GAP));
  const {rungs}=buildFairLadder(G.n, perGap);
  G.rungs=rungs; G.rows=rungs.length;
  G.dest=[]; for(let c=0;c<G.n;c++) G.dest[c]=walk(rungs,c);
  G.results=new Array(G.n).fill(-1);
  G.orbs=[]; particles=[]; doneCount=0; running=false;
  camX=0; if(scroller) scroller.scrollLeft=0;
  H.setCounter(0,G.n);
}

/* 공정성 자체 검증 — 브라우저 콘솔에서 __ladderAudit(5) 처럼 실행하면
   "사다리를 실제로 타고 내려간 도착점"이 "뽑힌 결과"와 일치하는지, 그리고
   출발 줄 × 도착 줄 분포가 균등한지 직접 확인할 수 있다. */
window.__ladderAudit = function(n, perGap, trials){
  n=n||5; perGap=perGap||DEF_GAP; trials=trials||60000;
  if(!H) H={rnd:Core.rnd, rndInt:Core.rndInt, shuffle:Core.shuffle};
  const m=Array.from({length:n},()=>new Array(n).fill(0));
  let mismatch=0, rowSet=new Set();
  for(let k=0;k<trials;k++){
    const {rungs,pi}=buildFairLadder(n,perGap);
    rowSet.add(rungs.length);
    for(let c=0;c<n;c++){ const d=walk(rungs,c); if(d!==pi[c]) mismatch++; m[c][d]++; }
  }
  const exp=trials/n; let dev=0;
  m.forEach(r=>r.forEach(v=>dev=Math.max(dev,Math.abs(v-exp)/exp)));
  return { n, perGap, trials, mismatch,
           maxDevPct:+(dev*100).toFixed(2),
           sigmaPct:+(Math.sqrt(trials*(1/n)*(1-1/n))/exp*100).toFixed(2),
           rows:[...rowSet],
           matrix:m.map(r=>r.map(v=>+(v/trials*100).toFixed(1))) };
};

/* ── 등록 ────────────────────────────────────────────────────────────── */
Core.registerGame({
  id:'ladder', icon:'🪜', name:'사다리타기',
  desc:'팀마다 구슬이 사다리를 타고 내려가 순서를 정합니다. 한 팀씩 또는 전체 동시 진행.',

  optionsHtml(){
    return '<div class="field"><label>진행 방식</label>'+
      '<div class="seg" id="ldMode">'+
      '<button data-v="one">팀별 개별 추첨<span class="sub">한 팀씩 클릭해서 출발</span></button>'+
      '<button data-v="all">전체 동시 추첨<span class="sub">한 번에 전부 출발</span></button>'+
      '</div></div>'+
      '<div class="field"><label>연결선 밀도 <span class="dim">칸마다 최소 개수</span></label>'+
      '<div class="stepper"><button id="ldGapM">−</button><div class="val" id="ldGapV">5</div>'+
      '<button id="ldGapP">＋</button><div class="unit">개 <span class="dim">(2–12)</span></div></div></div>'+
      '<div class="hint">밀도를 바꿔도 추첨 공정성에는 영향이 없습니다. 팀이 많으면 낮추는 편이 보기 좋습니다.</div>';
  },
  bindOptions(root,o,save){
    if(!o.mode) o.mode='one';
    if(!o.perGap) o.perGap=DEF_GAP;
    const paint=()=>{
      root.querySelectorAll('#ldMode button').forEach(b=>b.classList.toggle('on',b.dataset.v===o.mode));
      root.querySelector('#ldGapV').textContent=o.perGap;
    };
    root.querySelectorAll('#ldMode button').forEach(b=>
      b.addEventListener('click',()=>{ o.mode=b.dataset.v; paint(); save(); }));
    root.querySelector('#ldGapM').addEventListener('click',()=>{ if(o.perGap>2){o.perGap--;paint();save();} });
    root.querySelector('#ldGapP').addEventListener('click',()=>{ if(o.perGap<12){o.perGap++;paint();save();} });
    paint();
  },

  start(h){
    H=h;
    const o=H.opts();
    G={ n:H.n, teams:H.teams, mode:o.mode||'one', cols:[], rowY:[], orbs:[] };
    buildDOM();
    newLadder();
    elAll=H.tool('<button class="btn sm">전체 출발</button>');
    elShuffle=H.tool('<button class="btn sm ghost">다시 섞기</button>');
    elAll.style.display = G.mode==='all' ? '' : 'none';
    elAll.addEventListener('click',runAll);
    elShuffle.addEventListener('click',()=>{
      if(running) return;
      newLadder(); buildDOM(); layout();
      elAll.disabled=false;
      H.setTip(baseTip());
      H.toast('사다리를 새로 만들었습니다');
    });
    H.setTip(baseTip());
    requestAnimationFrame(()=>{ layout(); lastT=performance.now(); raf=requestAnimationFrame(tick); });
  },
  onShow(){ if(cv && G && !raf){ layout(); lastT=performance.now(); raf=requestAnimationFrame(tick); } },
  onResize(){ layout(); },
  onKey(e){
    if(e.key===' '||e.key==='Enter'){
      e.preventDefault();
      if(G && G.mode==='all') runAll();
      else { const nx=Array.from(document.querySelectorAll('#ldTop .tcard')).find(el=>!el.classList.contains('done')); if(nx) nx.click(); }
    }
    if(e.key==='r'||e.key==='R') elShuffle && elShuffle.click();
  },
  stop(){ cancelAnimationFrame(raf); raf=0; G=null; cv=null; cx=null; scroller=null;
          particles=[]; running=false; camX=0; }
});
})();
