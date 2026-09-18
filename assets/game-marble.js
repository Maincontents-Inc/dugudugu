/* ============================================================================
   game-marble.js — 마블 레이스
   ----------------------------------------------------------------------------
   팀마다 구슬 하나가 코스를 굴러 내려가고, 결승선을 통과한 순서가 곧 발표 순서다.

   공정성
     물리 시뮬레이션은 출발 위치에 따라 유불리가 생긴다. 그래서 사다리와 같은
     원리를 쓴다 — 출발 슬롯에 팀을 배정할 때 crypto 기반 Fisher-Yates 로
     균등 셔플한다.
       · 구슬은 색과 이름만 다를 뿐 크기·질량·마찰이 완전히 동일하다
       · 따라서 "어느 슬롯이 몇 등으로 들어오는가"는 물리가 정하고,
         "그 슬롯에 어느 팀이 있는가"는 균등 난수가 정한다
       · 최종 순위 = (슬롯 도착 순서) ∘ (균등 셔플) → 모든 n! 순서가 같은 확률
     코스가 아무리 편향돼 있어도 결과는 완전 균등하다. 공은 진짜로 굴러간다.

   물리
     고정 시간 간격(1/240초) 적분, 원-선분 / 원-원 충돌, 회전 막대는 접점의
     표면 속도를 반영. 끼임 방지용 넛지 포함.
   ========================================================================= */
(() => {
'use strict';

/* ── 물리 상수 ──────────────────────────────────────────────────────── */
const W        = 760;      // 코스 가로 (월드 좌표)
const WALL     = 24;       // 좌우 벽 x
const GRAV     = 1900;     // 중력 (px/s²)
const REST     = 0.34;     // 반발 계수
const REST_M   = 0.30;     // 구슬끼리 반발
const FRIC     = 0.13;     // 접선 마찰
const AIR      = 0.9995;   // 공기 저항
const SUB      = 1/240;    // 물리 스텝
const MAXV     = 2600;     // 속도 상한
const SEC_H    = 600;      // 섹션 높이
const START_H  = 360;      // 출발 구역 높이
const RUNOUT   = 420;      // 결승 이후 여유
const TIMEOUT  = 95;       // 안전 종료(초)

let H=null, cv=null, cx=null, raf=0, lastT=0, acc=0;
let world=null, marbles=[], finished=[], running=false, elapsed=0;
let cam=0, camV=0, speed=1, elStart=null, elSpeed=null, elAgain=null;
let rankBox=null, rankRows=[], rankT=0;

/* ── 코스 생성 ──────────────────────────────────────────────────────── */
function seg(x1,y1,x2,y2,hw){ return {x1,y1,x2,y2,hw:hw||7}; }

function buildCourse(n){
  const walls=[], pegs=[], bars=[];
  const types=['pegs','zig','spin','funnel','bumper'];
  const secs=[];
  const count = n<=8 ? 5 : 6;
  // 종류가 연달아 겹치지 않게 섞는다
  let prev='';
  for(let i=0;i<count;i++){
    let t; let guard=0;
    do{ t=types[H.rndInt(types.length)]; }while(t===prev && ++guard<8);
    secs.push(t); prev=t;
  }
  let y = START_H;
  // 출발 구역 벽
  walls.push(seg(WALL,0,WALL,START_H,9));
  walls.push(seg(W-WALL,0,W-WALL,START_H,9));

  for(const t of secs){
    walls.push(seg(WALL,y,WALL,y+SEC_H,9));
    walls.push(seg(W-WALL,y,W-WALL,y+SEC_H,9));
    if(t==='pegs'){
      for(let r=0;r<4;r++){
        const yy=y+110+r*135, odd=r%2, cols=odd?5:6;
        for(let c=0;c<cols;c++){
          const x = 90 + (W-180)*(c+(odd?0.5:0))/(6-1);
          if(x>WALL+40 && x<W-WALL-40) pegs.push({x,y:yy,r:13});
        }
      }
    } else if(t==='zig'){
      /* 경사면 2장. 앞 경사면 끝점과 다음 경사면 사이에 구슬 지름의 몇 배가 되는
         낙하 공간을 반드시 남긴다 — 겹치면 틈이 좁아져 구슬이 낀다. */
      walls.push(seg(WALL,   y+70,  W*0.70, y+250, 8));
      walls.push(seg(W-WALL, y+380, W*0.30, y+560, 8));
    } else if(t==='spin'){
      walls.push(seg(WALL,y+60,W*0.32,y+250,8));
      walls.push(seg(W-WALL,y+60,W*0.68,y+250,8));
      bars.push({cx:W/2, cy:y+370, len:330, hw:11,
                 ang:H.rnd()*Math.PI, omega:(H.rnd()<0.5?-1:1)*(1.1+H.rnd()*0.8)});
      walls.push(seg(WALL,y+470,W*0.36,y+590,8));
      walls.push(seg(W-WALL,y+470,W*0.64,y+590,8));
    } else if(t==='funnel'){
      walls.push(seg(WALL,y+70,W/2-112,y+330,8));
      walls.push(seg(W-WALL,y+70,W/2+112,y+330,8));
      walls.push(seg(W/2-112,y+330,W/2-190,y+470,8));
      walls.push(seg(W/2+112,y+330,W/2+190,y+470,8));
      for(let c=0;c<4;c++) pegs.push({x:120+c*(W-240)/3, y:y+555, r:15});
    } else if(t==='bumper'){
      pegs.push({x:W*0.30,y:y+150,r:44});
      pegs.push({x:W*0.70,y:y+150,r:44});
      pegs.push({x:W*0.50,y:y+360,r:52});
      pegs.push({x:W*0.22,y:y+540,r:36});
      pegs.push({x:W*0.78,y:y+540,r:36});
    }
    y += SEC_H;
  }
  // 결승 구간
  walls.push(seg(WALL,y,WALL,y+RUNOUT,9));
  walls.push(seg(W-WALL,y,W-WALL,y+RUNOUT,9));
  const finishY = y+150;
  // 바닥과 완충 벽
  walls.push(seg(WALL,y+RUNOUT-20,W-WALL,y+RUNOUT-20,10));
  const courseH = y+RUNOUT;
  for(const b of bars){                       // 첫 프레임 렌더 전에도 형상이 있어야 한다
    const c=Math.cos(b.ang), s2=Math.sin(b.ang), h=b.len/2;
    b.seg={x1:b.cx-c*h,y1:b.cy-s2*h,x2:b.cx+c*h,y2:b.cy+s2*h,hw:b.hw};
  }
  return {walls,pegs,bars,finishY,courseH,secs};
}

/* ── 구슬 배치 (슬롯은 고정, 팀 배정만 균등 셔플) ───────────────────── */
function placeMarbles(n){
  const r = n<=10 ? 15 : (n<=15 ? 13 : 11.5);
  const perRow = Math.min(n, 10);
  const rows = Math.ceil(n/perRow);
  const slots=[];
  for(let i=0;i<n;i++){
    const rw=Math.floor(i/perRow), cl=i%perRow;
    const cnt = Math.min(perRow, n-rw*perRow);
    const spanW = W-2*(WALL+34);
    const x = (WALL+34) + spanW*(cnt===1?0.5:cl/(cnt-1));
    const y = 90 + rw*(r*2+16);
    slots.push({x,y});
  }
  const order = H.shuffle([...Array(n).keys()]);   // ★ 균등 셔플: 슬롯 i → 팀 order[i]
  return slots.map((s,i)=>({
    x:s.x, y:s.y, px:s.x, py:s.y, vx:(H.rnd()-.5)*8, vy:0, r,
    team:order[i], color:H.teams[order[i]].color, no:H.teams[order[i]].no,
    fin:-1, still:0, trail:[]
  }));
}

/* ── 충돌 ───────────────────────────────────────────────────────────── */
function hitPoint(m,px,py,rad,svx,svy){
  let nx=m.x-px, ny=m.y-py, d=Math.hypot(nx,ny);
  const R=m.r+rad;
  if(d>=R) return;
  if(d<1e-6){ nx=0; ny=-1; d=1e-6; } else { nx/=d; ny/=d; }
  m.x+=nx*(R-d); m.y+=ny*(R-d);
  svx=svx||0; svy=svy||0;
  const vn=(m.vx-svx)*nx+(m.vy-svy)*ny;
  if(vn>=0) return;
  const jn=-(1+REST)*vn;
  m.vx+=jn*nx; m.vy+=jn*ny;
  const tx=-ny, ty=nx;
  const vt=(m.vx-svx)*tx+(m.vy-svy)*ty;
  const fr=FRIC*Math.abs(jn);
  const dvt=Math.max(-fr,Math.min(fr,-vt));
  m.vx+=dvt*tx; m.vy+=dvt*ty;
}
function hitSeg(m,s,omega,cxp,cyp){
  const dx=s.x2-s.x1, dy=s.y2-s.y1, L2=dx*dx+dy*dy||1;
  let t=((m.x-s.x1)*dx+(m.y-s.y1)*dy)/L2;
  t=t<0?0:(t>1?1:t);
  const px=s.x1+dx*t, py=s.y1+dy*t;
  let svx=0, svy=0;
  if(omega){ svx=-omega*(py-cyp); svy=omega*(px-cxp); }
  hitPoint(m,px,py,s.hw,svx,svy);
}
function step(dt){
  const {walls,pegs,bars}=world;
  for(const b of bars){
    b.ang += b.omega*dt;
    const c=Math.cos(b.ang), s=Math.sin(b.ang), h=b.len/2;
    b.seg = {x1:b.cx-c*h, y1:b.cy-s*h, x2:b.cx+c*h, y2:b.cy+s*h, hw:b.hw};
  }
  for(const m of marbles){
    if(m.fin>=0) continue;
    m.vy += GRAV*dt;
    m.vx *= AIR; m.vy *= AIR;
    const sp=Math.hypot(m.vx,m.vy);
    if(sp>MAXV){ m.vx=m.vx/sp*MAXV; m.vy=m.vy/sp*MAXV; }
    m.x += m.vx*dt; m.y += m.vy*dt;
    if(m.x<WALL+m.r){ m.x=WALL+m.r; if(m.vx<0) m.vx=-m.vx*REST; }
    if(m.x>W-WALL-m.r){ m.x=W-WALL-m.r; if(m.vx>0) m.vx=-m.vx*REST; }
    for(const s of walls) hitSeg(m,s,0,0,0);
    for(const p of pegs)  hitPoint(m,p.x,p.y,p.r,0,0);
    for(const b of bars)  hitSeg(m,b.seg,b.omega,b.cx,b.cy);
    /* 끼임 방지 넛지 */
    if(sp<30){ m.still+=dt; if(m.still>0.9){ m.vx+=(H.rnd()-.5)*420; m.vy+=140; m.still=0; } }
    else m.still=0;
  }
  /* 구슬끼리 */
  for(let i=0;i<marbles.length;i++){
    const a=marbles[i]; if(a.fin>=0) continue;
    for(let j=i+1;j<marbles.length;j++){
      const b=marbles[j]; if(b.fin>=0) continue;
      let dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy), R=a.r+b.r;
      if(d>=R||d<1e-6) continue;
      dx/=d; dy/=d;
      const pen=(R-d)*0.5;
      a.x-=dx*pen; a.y-=dy*pen; b.x+=dx*pen; b.y+=dy*pen;
      const rvn=(b.vx-a.vx)*dx+(b.vy-a.vy)*dy;
      if(rvn>=0) continue;
      const jn=-(1+REST_M)*rvn*0.5;
      a.vx-=jn*dx; a.vy-=jn*dy; b.vx+=jn*dx; b.vy+=jn*dy;
    }
  }
  /* 결승선 통과 */
  for(const m of marbles){
    if(m.fin>=0) continue;
    if(m.y>=world.finishY){
      m.fin=finished.length; finished.push(m);
      H.setCounter(finished.length, marbles.length);
    }
  }
}

/* ── 렌더 ───────────────────────────────────────────────────────────── */
let CW=0,CH=0,DPR=1,scale=1;
function resize(){
  if(!cv) return;
  const r=cv.parentElement.getBoundingClientRect();
  CW=r.width; CH=r.height;
  DPR=Math.min(window.devicePixelRatio||1,2);
  cv.width=Math.round(CW*DPR); cv.height=Math.round(CH*DPR);
  scale=CW/W;
}
function draw(){
  if(!cv||!cx||!world) return;
  const g=cx, viewH=CH/scale;
  g.setTransform(DPR,0,0,DPR,0,0);
  g.clearRect(0,0,CW,CH);
  g.save();
  g.scale(scale,scale);
  g.translate(0,-cam);

  const top=cam-60, bot=cam+viewH+60;
  /* 벽 */
  g.lineCap='round';
  g.strokeStyle='rgba(255,255,255,.30)';
  for(const s of world.walls){
    if(Math.max(s.y1,s.y2)<top||Math.min(s.y1,s.y2)>bot) continue;
    g.lineWidth=s.hw*2; g.beginPath(); g.moveTo(s.x1,s.y1); g.lineTo(s.x2,s.y2); g.stroke();
  }
  /* 못 */
  for(const p of world.pegs){
    if(p.y<top||p.y>bot) continue;
    const gr=g.createRadialGradient(p.x-p.r*.3,p.y-p.r*.4,p.r*.1,p.x,p.y,p.r);
    gr.addColorStop(0,'rgba(255,255,255,.5)'); gr.addColorStop(1,'rgba(168,237,245,.22)');
    g.fillStyle=gr; g.beginPath(); g.arc(p.x,p.y,p.r,0,7); g.fill();
    g.strokeStyle='rgba(255,255,255,.4)'; g.lineWidth=2; g.stroke();
  }
  /* 회전 막대 */
  for(const b of world.bars){
    if(b.cy<top-260||b.cy>bot+260) continue;
    const s=b.seg;
    g.strokeStyle='rgba(168,237,245,.75)'; g.lineWidth=b.hw*2;
    g.beginPath(); g.moveTo(s.x1,s.y1); g.lineTo(s.x2,s.y2); g.stroke();
    g.fillStyle='rgba(255,255,255,.55)'; g.beginPath(); g.arc(b.cx,b.cy,7,0,7); g.fill();
  }
  /* 결승선 */
  const fy=world.finishY;
  if(fy>top&&fy<bot){
    g.save(); g.setLineDash([16,12]);
    g.strokeStyle='#A8EDF5'; g.lineWidth=5;
    g.beginPath(); g.moveTo(WALL,fy); g.lineTo(W-WALL,fy); g.stroke(); g.restore();
    g.fillStyle='rgba(168,237,245,.85)'; g.font='900 30px sans-serif'; g.textAlign='center';
    g.fillText('FINISH', W/2, fy-18); g.textAlign='left';
  }
  /* 꼬리 */
  if(H.settings.useFx){
    for(const m of marbles){
      if(m.trail.length<2) continue;
      g.strokeStyle=m.color; g.lineWidth=m.r*0.9; g.lineCap='round';
      g.globalAlpha=.28; g.beginPath();
      g.moveTo(m.trail[0].x,m.trail[0].y);
      for(let i=1;i<m.trail.length;i++) g.lineTo(m.trail[i].x,m.trail[i].y);
      g.stroke(); g.globalAlpha=1;
    }
  }
  /* 구슬 */
  for(const m of marbles){
    if(m.y<top-40||m.y>bot+40) continue;
    g.save();
    if(H.settings.useFx){ g.shadowColor=m.color; g.shadowBlur=18; }
    const gr=g.createRadialGradient(m.x-m.r*.35,m.y-m.r*.4,m.r*.1,m.x,m.y,m.r);
    gr.addColorStop(0,'#fff'); gr.addColorStop(.45,m.color); gr.addColorStop(1,H.lighten(m.color,-0.0));
    g.fillStyle=gr; g.beginPath(); g.arc(m.x,m.y,m.r,0,7); g.fill();
    g.restore();
    g.strokeStyle='rgba(255,255,255,.85)'; g.lineWidth=1.6; g.stroke();
    g.fillStyle='#161233'; g.font='900 '+Math.round(m.r*1.05)+'px sans-serif';
    g.textAlign='center'; g.textBaseline='middle';
    g.fillText(String(m.no), m.x, m.y+0.5);
    g.textAlign='left'; g.textBaseline='alphabetic';
  }
  g.restore();
}

/* ── 순위 패널 ──────────────────────────────────────────────────────── */
function buildRankPanel(){
  rankBox.innerHTML='';
  rankRows=[];
  for(let i=0;i<marbles.length;i++){
    const el=document.createElement('div'); el.className='rk';
    el.innerHTML='<div class="p"></div><div class="dot"></div><div class="nm"></div>';
    rankBox.appendChild(el); rankRows.push(el);
  }
}
function updateRank(){
  const list=marbles.slice().sort((a,b)=>{
    if(a.fin>=0&&b.fin>=0) return a.fin-b.fin;
    if(a.fin>=0) return -1;
    if(b.fin>=0) return 1;
    return b.y-a.y;
  });
  list.forEach((m,i)=>{
    const el=rankRows[i]; if(!el) return;
    const tm=H.teams[m.team];
    el.classList.toggle('fin',m.fin>=0);
    el.style.borderColor = m.fin>=0 ? tm.color+'99' : 'transparent';
    el.querySelector('.p').textContent=(i+1);
    el.querySelector('.dot').style.background=tm.color;
    el.querySelector('.nm').textContent=tm.name;
  });
}

/* ── 루프 ───────────────────────────────────────────────────────────── */
function tick(now){
  if(!world){ raf=0; return; }
  const dt=Math.min(0.05,(now-lastT)/1000); lastT=now;
  if(running){
    elapsed+=dt;
    acc+=dt*speed;
    let guard=0;
    while(acc>=SUB && guard++<600){ step(SUB); acc-=SUB; }
    for(const m of marbles){
      if(m.fin>=0) continue;
      m.trail.push({x:m.x,y:m.y});
      if(m.trail.length>9) m.trail.shift();
    }
    if(finished.length>=marbles.length || elapsed>TIMEOUT) endRace();
  }
  /* 카메라: 선두를 따라간다 */
  let lead=0;
  for(const m of marbles) if(m.fin<0 && m.y>lead) lead=m.y;
  if(!marbles.some(m=>m.fin<0)) lead=world.finishY;
  const viewH=CH/scale;
  let target=lead-viewH*0.42;
  target=Math.max(0,Math.min(world.courseH-viewH,target));
  cam += (target-cam)*Math.min(1,dt*6);
  draw();
  if(performance.now()-rankT>110){ rankT=performance.now(); updateRank(); }
  raf=requestAnimationFrame(tick);
}
function endRace(){
  if(!running) return;
  running=false;
  /* 미완주 구슬은 진행도(아래일수록 앞)로 순위 마감 */
  const rest=marbles.filter(m=>m.fin<0).sort((a,b)=>b.y-a.y);
  for(const m of rest){ m.fin=finished.length; finished.push(m); }
  H.setCounter(finished.length, marbles.length);
  updateRank();
  elStart.disabled=true; elAgain.style.display='';
  H.finish(finished.map(m=>m.team));
}

/* ── 시작/재시작 ────────────────────────────────────────────────────── */
function reset(){
  world=buildCourse(H.n);
  marbles=placeMarbles(H.n);
  finished=[]; running=false; elapsed=0; acc=0; cam=0;
  H.setCounter(0,H.n);
  buildRankPanel(); updateRank();
  elStart.disabled=false; elAgain.style.display='none';
  H.setTip('출발 버튼을 누르면 경주가 시작됩니다');
}
async function startRace(){
  if(running) return;
  elStart.disabled=true;
  H.setTip('경주 중…');
  await H.countdown(3);
  lastT=performance.now(); running=true;
}

/* 디버그용 읽기 전용 스냅샷 (콘솔에서 __marbleDebug() 로 진행 상황 확인) */
window.__marbleDebug = () => world ? {
  n:marbles.length, fin:finished.length, elapsed:+elapsed.toFixed(1),
  lead:Math.round(Math.max(...marbles.map(m=>m.y))),
  slow:Math.round(Math.min(...marbles.filter(m=>m.fin<0).map(m=>m.y))),
  courseH:world.courseH, finishY:world.finishY, secs:world.secs
} : null;

/* ── 등록 ───────────────────────────────────────────────────────────── */
Core.registerGame({
  id:'marble', icon:'🎱', name:'마블 레이스',
  desc:'팀마다 구슬이 코스를 굴러 내려갑니다. 결승선을 통과한 순서가 그대로 발표 순서가 됩니다.',

  optionsHtml(){
    return '<div class="field"><label>기본 재생 속도</label>'+
      '<div class="seg" id="mbSpeed">'+
      '<button data-v="1">보통<span class="sub">1배속</span></button>'+
      '<button data-v="2">빠르게<span class="sub">2배속</span></button>'+
      '</div></div>'+
      '<div class="hint">경주 중에도 화면 위 버튼으로 속도를 바꿀 수 있습니다. '+
      '코스는 매번 새로 생성되며, 출발 위치는 암호학적 난수로 균등하게 섞여 결과가 공정합니다.</div>';
  },
  bindOptions(root,o,save){
    if(!o.speed) o.speed=1;
    const paint=()=>root.querySelectorAll('#mbSpeed button')
      .forEach(b=>b.classList.toggle('on',+b.dataset.v===o.speed));
    root.querySelectorAll('#mbSpeed button').forEach(b=>
      b.addEventListener('click',()=>{ o.speed=+b.dataset.v; paint(); save(); }));
    paint();
  },

  start(h){
    H=h;
    speed = H.opts().speed || 1;
    H.stage.innerHTML =
      '<div class="marble-wrap">'+
        '<div class="marble-track"><canvas id="mbCv"></canvas></div>'+
        '<div class="rank-panel"><h3>순위</h3><div class="rank-list" id="mbRank"></div></div>'+
      '</div>';
    cv=document.getElementById('mbCv'); cx=cv.getContext('2d');
    rankBox=document.getElementById('mbRank');
    elStart = H.tool('<button class="btn sm primary">출발</button>');
    elSpeed = H.tool('<button class="btn sm ghost">'+speed+'배속</button>');
    elAgain = H.tool('<button class="btn sm ghost" style="display:none">코스 새로 만들기</button>');
    elStart.addEventListener('click',startRace);
    elSpeed.addEventListener('click',()=>{
      speed = speed>=4 ? 1 : speed*2;
      elSpeed.textContent = speed+'배속';
    });
    elAgain.addEventListener('click',()=>{ reset(); H.toast('코스를 새로 만들었습니다'); });
    resize(); reset();
    lastT=performance.now(); raf=requestAnimationFrame(tick);
  },
  onShow(){ if(!cv||!world) return; resize(); if(!raf){ lastT=performance.now(); raf=requestAnimationFrame(tick); } },
  onResize(){ resize(); },
  onKey(e){ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); if(!elStart.disabled) startRace(); } },
  stop(){ cancelAnimationFrame(raf); raf=0; running=false; marbles=[]; finished=[]; world=null; cv=null; cx=null; }
});
})();
