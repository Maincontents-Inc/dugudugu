/* ============================================================================
   game-marble.js — 마블 레이스
   ----------------------------------------------------------------------------
   팀마다 구슬 하나가 코스를 굴러 내려가고, 결승선을 통과한 순서가 곧 결과다.

   공정성
     물리 시뮬레이션은 출발 위치에 따라 유불리가 생긴다. 그래서 사다리와 같은
     원리를 쓴다 — 출발 슬롯에 팀을 배정할 때 crypto 기반 Fisher-Yates 로
     균등 셔플한다.
       · 구슬은 색과 번호만 다를 뿐 크기·질량·마찰이 완전히 동일하다
       · 따라서 "어느 슬롯이 몇 등으로 들어오는가"는 물리가 정하고,
         "그 슬롯에 어느 팀이 있는가"는 균등 난수가 정한다
       · 최종 순위 = (슬롯 도착 순서) ∘ (균등 셔플) → 모든 n! 순서가 같은 확률
     코스가 아무리 복잡하고 편향돼 있어도 결과는 완전 균등하다.
     그래서 코스는 마음껏 복잡하게 만들어도 된다.

   코스 구조 — 세로 통 하나가 아니라 '방'을 이어붙인 덕트
     각 방은 위에 입구 게이트, 아래에 출구 게이트가 있고, 다음 방은 그 출구
     아래에 붙는다. 방마다 x 위치가 달라서 코스가 내려가며 좌우로 꺾인다.
     바닥은 항상 게이트 쪽으로 기울어 있어 구슬이 고이지 않는다(끼임 방지).

   물리
     고정 시간 간격(1/240초) 적분, 원-선분 / 원-원 충돌.
     회전체·왕복체는 접점의 표면 속도를 반영. 장애물은 방 단위로 나눠 두고
     구슬이 속한 방과 앞뒤 방만 검사한다(브로드페이즈).
   ========================================================================= */
(() => {
'use strict';

/* ── 코스 치수 ──────────────────────────────────────────────────────── */
const W_ROOM   = 640;      // 방 가로
const H_ROOM   = 560;      // 방 세로
const FLOOR_H  = 94;       // 바닥 경사 높이 (게이트 쪽으로 기울어짐)
const GATE     = 176;      // 게이트 폭 — 구슬 지름의 5배 이상 (끼임 방지)
const WORLD_W  = 1380;     // 월드 가로
const EDGE     = 156;      // 게이트가 방 가장자리에서 떨어져야 할 최소 거리
const START_H  = 330;      // 출발 구역
const FIN_H    = 430;      // 결승 구역
const HW       = 10;       // 벽 두께(반)

/* ── 물리 ───────────────────────────────────────────────────────────── */
const GRAV     = 1900;
const REST     = 0.34;     // 보통 면
const REST_BMP = 0.98;     // 범퍼 — 탄성만 살림(에너지 추가 없음)
const BOOST    = 960;      // 점프대가 밀어내는 고정 속도(px/s)
                           // 반발계수>1 은 부딪힐 때마다 에너지가 늘어 발산한다.
                           // 대신 '튕긴 뒤 법선 속도를 이 값까지 올려준다'로 처리한다.
const REST_M   = 0.30;     // 구슬끼리
const FRIC     = 0.13;
const AIR      = 0.9995;
const SUB      = 1/240;
const MAXV     = 3200;
const TIMEOUT  = 150;      // 안전 종료(초)

let H=null, cv=null, cx=null, raf=0, lastT=0, acc=0;
let world=null, marbles=[], finished=[], running=false, elapsed=0, simT=0;
let camX=0, camY=0, speed=1, elStart=null, elSpeed=null, elAgain=null;
let rankBox=null, rankRows=[], rankT=0;

/* ── 기본 도형 ──────────────────────────────────────────────────────── */
function seg(x1,y1,x2,y2,hw,rest,boost){ return {x1,y1,x2,y2,hw:hw||HW,rest:rest||REST,boost:boost||0}; }
function circ(x,y,r,rest){ return {x,y,r,rest:rest||REST,flash:0}; }

/* 회전 막대 — 중심 (cx,cy) 둘레를 도는 선분 */
function rot(cx,cy,len,hw,omega,rest,phase){
  return {kind:'rot',cx,cy,len,hw:hw||11,omega,rest:rest||REST,ang:phase||0,seg:null};
}
/* 왕복 선분 — 기준 위치에서 (ax,ay) 만큼 사인 왕복 */
function osc(x1,y1,x2,y2,hw,ax,ay,period,phase,rest){
  return {kind:'osc',x1,y1,x2,y2,hw:hw||11,ax,ay,w:2*Math.PI/period,ph:phase||0,
          rest:rest||REST,seg:null,vx:0,vy:0};
}
function stepDyn(d,t){
  if(d.kind==='rot'){
    d.ang=d.ang0+d.omega*t;
    const c=Math.cos(d.ang), s=Math.sin(d.ang), h=d.len/2;
    d.seg={x1:d.cx-c*h,y1:d.cy-s*h,x2:d.cx+c*h,y2:d.cy+s*h,hw:d.hw,rest:d.rest};
  } else {
    const k=Math.sin(d.w*t+d.ph), dk=Math.cos(d.w*t+d.ph)*d.w;
    const ox=d.ax*k, oy=d.ay*k;
    d.vx=d.ax*dk; d.vy=d.ay*dk;
    d.seg={x1:d.x1+ox,y1:d.y1+oy,x2:d.x2+ox,y2:d.y2+oy,hw:d.hw,rest:d.rest};
  }
}

/* ============================================================================
   방 껍데기
   ----------------------------------------------------------------------------
   바닥은 양쪽에서 출구 게이트를 향해 기울어 있다. 평평한 바닥이 없으므로
   구슬이 고일 자리가 생기지 않는다 — 끼임 방지의 1차 방어선.
   ========================================================================= */
function shell(o,x0,y0,gIn,gOut,first){
  const W=W_ROOM, H=H_ROOM, fy=y0+H-FLOOR_H;
  o.walls.push(seg(x0,   y0, x0,   fy));
  o.walls.push(seg(x0+W, y0, x0+W, fy));
  if(!first){
    o.walls.push(seg(x0,y0, gIn-GATE/2, y0));
    o.walls.push(seg(gIn+GATE/2, y0, x0+W, y0));
  }
  o.walls.push(seg(x0,   fy, gOut-GATE/2, y0+H));
  o.walls.push(seg(x0+W, fy, gOut+GATE/2, y0+H));
}
/* 장애물을 놓을 수 있는 안쪽 영역 — 벽·천장·바닥에서 충분히 띄운다 */
const box = (x0,y0) => ({
  x0:x0+62, x1:x0+W_ROOM-62,
  y0:y0+92, y1:y0+H_ROOM-FLOOR_H-52
});

/* ============================================================================
   방 종류 12가지
   ========================================================================= */
const ROOMS = {

/* ── 튀어오르는 것 ──────────────────────────────────────────────────── */
/* 핀볼 범퍼 — 닿으면 사방으로 강하게 튕긴다 */
pinball(o,x0,y0){
  const b=box(x0,y0), R=27;
  const pts=[[.18,.12],[.82,.12],[.35,.50],[.70,.52],[.18,.88],[.82,.88]];
  for(const [fx,fy] of pts)
    o.circles.push(circ(b.x0+(b.x1-b.x0)*fx, b.y0+(b.y1-b.y0)*fy, R, REST_BMP));
},
/* 점프대 — 위로 쏘아올린다. 순위가 가장 크게 뒤집히는 구간 */
jump(o,x0,y0){
  const b=box(x0,y0), w=b.x1-b.x0, h=b.y1-b.y0, left=H.rnd()<0.5;
  /* 점프대는 한쪽에만. 양쪽에 두면 구슬이 사이를 오가며 못 빠져나온다.
     모든 면은 기울여 둔다(수평면 금지). */
  if(left) o.walls.push(seg(b.x0, b.y0+h*0.94, b.x0+w*0.58, b.y0+h*0.58, 13, 0.45, BOOST));
  else     o.walls.push(seg(b.x1, b.y0+h*0.94, b.x1-w*0.58, b.y0+h*0.58, 13, 0.45, BOOST));
  o.walls.push(seg(left?b.x1:b.x0, b.y0+h*0.14, left?b.x0+w*0.34:b.x1-w*0.34, b.y0+h*0.38, 11));
  o.circles.push(circ(left? b.x1-46 : b.x0+46, b.y0+h*0.66, 26, REST_BMP));
},
/* 물레방아 — 날개 네 장이 돌며 구슬을 퍼올려 옮긴다 */
wheel(o,x0,y0){
  const b=box(x0,y0), cxp=(b.x0+b.x1)/2, cyp=(b.y0+b.y1)/2;
  const om=(H.rnd()<0.5?-1:1)*(1.3+H.rnd()*0.7), L=248;
  o.dyn.push(rot(cxp,cyp,L,12,om,REST,0));
  o.dyn.push(rot(cxp,cyp,L,12,om,REST,Math.PI/2));
  o.circles.push(circ(b.x0+24,b.y1-24,22,REST_BMP));
  o.circles.push(circ(b.x1-24,b.y1-24,22,REST_BMP));
},

/* ── 벽 장치 ────────────────────────────────────────────────────────── */
/* 톱니 벽 — 스치면 안쪽으로 튕겨 들어온다 */
saw(o,x0,y0){
  const b=box(x0,y0), n=5, d=38, span=(b.y1-b.y0)/n;
  for(let i=0;i<n;i++){
    const ya=b.y0+span*i, yb=ya+span;
    o.walls.push(seg(x0+HW, ya, x0+HW+d, (ya+yb)/2, 8));
    o.walls.push(seg(x0+HW+d,(ya+yb)/2, x0+HW, yb, 8));
    o.walls.push(seg(x0+W_ROOM-HW, ya, x0+W_ROOM-HW-d, (ya+yb)/2, 8));
    o.walls.push(seg(x0+W_ROOM-HW-d,(ya+yb)/2, x0+W_ROOM-HW, yb, 8));
  }
  o.circles.push(circ((b.x0+b.x1)/2, b.y0+(b.y1-b.y0)*0.32, 30, REST_BMP));
  o.circles.push(circ((b.x0+b.x1)/2, b.y0+(b.y1-b.y0)*0.74, 30, REST_BMP));
},
/* 벽 범퍼 — 벽에 박힌 반구가 튕겨낸다 */
wallbump(o,x0,y0){
  const b=box(x0,y0), n=4, span=(b.y1-b.y0)/n;
  for(let i=0;i<n;i++){
    const y=b.y0+span*(i+0.5);
    o.circles.push(circ(x0+HW,          y,            32, REST_BMP));
    o.circles.push(circ(x0+W_ROOM-HW,   y+span*0.5,   32, REST_BMP));
  }
},
/* 좁힘 게이트 — 통로가 좁아졌다 넓어진다 */
narrow(o,x0,y0){
  const b=box(x0,y0), midY=(b.y0+b.y1)/2, half=96;
  const cxp=(b.x0+b.x1)/2;
  o.walls.push(seg(x0+HW, b.y0, cxp-half, midY, 11));
  o.walls.push(seg(cxp-half, midY, x0+HW, b.y1, 11));
  o.walls.push(seg(x0+W_ROOM-HW, b.y0, cxp+half, midY, 11));
  o.walls.push(seg(cxp+half, midY, x0+W_ROOM-HW, b.y1, 11));
  o.circles.push(circ(cxp, b.y0+18, 22, REST_BMP));
},

/* ── 경로 ───────────────────────────────────────────────────────────── */
/* 갈림길 — 쐐기로 두 갈래, 한쪽엔 못밭. 아래에서 다시 합류 */
split(o,x0,y0){
  const b=box(x0,y0), cxp=(b.x0+b.x1)/2, h=b.y1-b.y0;
  /* 쐐기 꼭짓점이 뾰족하면 구슬이 그 위에 얹혀 균형을 잡는다.
     꼭짓점 자리에는 둥근 범퍼를 두고, 갈라지는 면은 그 아래에서 시작한다. */
  o.circles.push(circ(cxp, b.y0+h*0.10, 34, REST_BMP));
  o.walls.push(seg(cxp-30, b.y0+h*0.20, cxp-132, b.y0+h*0.52, 11));
  o.walls.push(seg(cxp+30, b.y0+h*0.20, cxp+132, b.y0+h*0.52, 11));
  o.walls.push(seg(cxp-132, b.y0+h*0.52, cxp-118, b.y0+h*0.80, 11));
  o.walls.push(seg(cxp+132, b.y0+h*0.52, cxp+118, b.y0+h*0.80, 11));
  o.circles.push(circ(b.x0+46, b.y0+h*0.58, 22, REST_BMP));
  o.circles.push(circ(b.x1-46, b.y0+h*0.58, 22, REST_BMP));
},
/* 낙차 — 아무것도 없는 자유낙하. 속도가 붙어 다음 구간이 격렬해진다 */
drop(o,x0,y0){
  const b=box(x0,y0), cxp=(b.x0+b.x1)/2, h=b.y1-b.y0;
  o.walls.push(seg(cxp-150, b.y1, cxp+150, b.y1-58, 13, 0.45, BOOST));
  o.circles.push(circ(b.x0+40, b.y0+h*0.22, 21, REST_BMP));
  o.circles.push(circ(b.x1-40, b.y0+h*0.22, 21, REST_BMP));
},
/* 지그재그 슬로프 — 좌우로 크게 흘려보낸다 */
zigzag(o,x0,y0){
  const b=box(x0,y0), h=b.y1-b.y0, cxp=(b.x0+b.x1)/2, flip=H.rnd()<0.5;
  /* 경사면은 두 장만. 세 장을 넣으면 위 경사면의 끝단과 아래 경사면 사이가
     구슬 지름보다 좁아져 끼인다. 또 폭 전체를 가로지르면 기울기가 10도도
     안 돼 구슬이 굴러내려오지 못한다 — 폭의 3/4만 쓰고 낙차를 크게 준다. */
  const s=flip?1:-1;
  o.walls.push(seg(cxp-s*(W_ROOM/2-HW), b.y0+h*0.02, cxp+s*150, b.y0+h*0.40, 11));
  o.walls.push(seg(cxp+s*(W_ROOM/2-HW), b.y0+h*0.56, cxp-s*150, b.y0+h*0.90, 11));
},
/* 얕은 그릇 + 회전 날개 — 구슬을 휘저어 뱉어낸다 (얕게 만들어 고이지 않는다) */
bowl(o,x0,y0){
  const b=box(x0,y0), cxp=(b.x0+b.x1)/2, hh=b.y1-b.y0;
  const cyp=b.y0+hh*0.02, R=240, N=12, flip=H.rnd()<0.5;
  /* 호 안에 최저점이 들어가면 그 자리가 웅덩이가 되어 구슬이 고인다.
     4분원만 쓴다 — 바깥쪽 높은 끝에서 안쪽 낮은 끝으로 한 방향으로만 흐르고,
     낮은 끝은 허공이라 반드시 떨어진다. */
  const a0=flip?Math.PI*0.98:Math.PI*0.02, a1=flip?Math.PI*0.56:Math.PI*0.44;
  let px=cxp+R*Math.cos(a0), py=cyp+R*Math.sin(a0);
  for(let i=1;i<=N;i++){
    const a=a0+(a1-a0)*i/N, qx=cxp+R*Math.cos(a), qy=cyp+R*Math.sin(a);
    o.walls.push(seg(px,py,qx,qy,10)); px=qx; py=qy;
  }
  /* 범퍼는 호가 없는 반대쪽에만 — 호 위에 겹치면 그 사이에 틈이 생긴다 */
  o.circles.push(circ(flip? cxp+142 : cxp-142, b.y0+hh*0.30, 26, REST_BMP));
  o.circles.push(circ(flip? cxp+96  : cxp-96,  b.y0+hh*0.74, 24, REST_BMP));
},

/* ── 움직이는 것 ────────────────────────────────────────────────────── */
/* 좌우 왕복 발판 */
shuttle(o,x0,y0){
  const b=box(x0,y0), cxp=(b.x0+b.x1)/2, h=b.y1-b.y0;
  /* 발판은 반드시 기울여 둔다 — 수평이면 구슬이 실려서 안 내려온다 */
  o.dyn.push(osc(cxp-98, b.y0+h*0.36, cxp+98, b.y0+h*0.50, 12,
                 104, 0, 2.4+H.rnd()*1.0, H.rnd()*6.28));
  o.dyn.push(osc(cxp+92, b.y0+h*0.70, cxp-92, b.y0+h*0.84, 12,
                 96, 0, 2.2+H.rnd()*1.0, H.rnd()*6.28));
  o.walls.push(seg(x0+HW, b.y0+h*0.02, b.x0+120, b.y0+h*0.18, 10));
  o.walls.push(seg(x0+W_ROOM-HW, b.y0+h*0.02, b.x1-120, b.y0+h*0.18, 10));
},
/* 셔터 — 위아래로 오르내리며 길을 열었다 막았다 한다 */
shutter(o,x0,y0){
  const b=box(x0,y0), cxp=(b.x0+b.x1)/2, h=b.y1-b.y0, p=3.0+H.rnd()*1.4;
  o.dyn.push(osc(b.x0,    b.y0+h*0.26, cxp-54, b.y0+h*0.40, 12, 0, h*0.20, p, 0));
  o.dyn.push(osc(cxp+54,  b.y0+h*0.72, b.x1,   b.y0+h*0.58, 12, 0, h*0.20, p, Math.PI));
  o.circles.push(circ(cxp, b.y0+h*0.06, 24, REST_BMP));
}
};
const ROOM_KEYS = Object.keys(ROOMS);

/* ============================================================================
   코스 조립
   ----------------------------------------------------------------------------
   방을 위에서 아래로 이어붙인다. 다음 방의 x 위치는 "이전 방의 출구가
   새 방 안쪽 EDGE 범위에 들어오도록" 고른다 → 벽이 반드시 맞물리고,
   코스는 좌우로 꺾이며 내려간다.
   ========================================================================= */
function buildCourse(n, roomCount){
  const rooms=[];
  const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
  const pick=(a,b)=>a+H.rnd()*(b-a);

  /* 출발 구역 */
  let x0=clamp(pick(180,WORLD_W-W_ROOM-180),0,WORLD_W-W_ROOM);
  let y0=0;
  let gOut=clamp(pick(x0+EDGE,x0+W_ROOM-EDGE),x0+EDGE,x0+W_ROOM-EDGE);
  const start={x0,y0,h:START_H,type:'start',walls:[],circles:[],dyn:[],gIn:gOut,gOut};
  {
    const fy=y0+START_H-FLOOR_H;
    start.walls.push(seg(x0,y0,x0,fy));
    start.walls.push(seg(x0+W_ROOM,y0,x0+W_ROOM,fy));
    start.walls.push(seg(x0,fy,gOut-GATE/2,y0+START_H));
    start.walls.push(seg(x0+W_ROOM,fy,gOut+GATE/2,y0+START_H));
  }
  rooms.push(start);
  start.startBox={x0:x0+70,x1:x0+W_ROOM-70,y:y0+96};

  /* 본 구간 — 같은 종류가 연달아 나오지 않게, 계열도 골고루 */
  y0=START_H;
  let prev='', prev2='';
  for(let i=0;i<roomCount;i++){
    const gIn=gOut;
    const lo=clamp(gIn-W_ROOM+EDGE,0,WORLD_W-W_ROOM);
    const hi=clamp(gIn-EDGE,0,WORLD_W-W_ROOM);
    x0=clamp(pick(lo,hi),lo,hi);
    gOut=clamp(pick(x0+EDGE,x0+W_ROOM-EDGE),x0+EDGE,x0+W_ROOM-EDGE);
    let type,guard=0;
    do{ type=ROOM_KEYS[H.rndInt(ROOM_KEYS.length)]; }
    while((type===prev||type===prev2)&&++guard<24);
    prev2=prev; prev=type;
    const o={x0,y0,h:H_ROOM,type,walls:[],circles:[],dyn:[],gIn,gOut};
    shell(o,x0,y0,gIn,gOut,false);
    ROOMS[type](o,x0,y0);
    rooms.push(o);
    y0+=H_ROOM;
  }

  /* 결승 구역 — 게이트 없이 바닥까지 */
  {
    const gIn=gOut;
    const lo=clamp(gIn-W_ROOM+EDGE,0,WORLD_W-W_ROOM);
    const hi=clamp(gIn-EDGE,0,WORLD_W-W_ROOM);
    x0=clamp(pick(lo,hi),lo,hi);
    const o={x0,y0,h:FIN_H,type:'finish',walls:[],circles:[],dyn:[],gIn,gOut:x0+W_ROOM/2};
    o.walls.push(seg(x0,y0,x0,y0+FIN_H-20));
    o.walls.push(seg(x0+W_ROOM,y0,x0+W_ROOM,y0+FIN_H-20));
    o.walls.push(seg(x0,y0,gIn-GATE/2,y0));
    o.walls.push(seg(gIn+GATE/2,y0,x0+W_ROOM,y0));
    o.walls.push(seg(x0,y0+FIN_H-20,x0+W_ROOM,y0+FIN_H-20,12));
    rooms.push(o);
    y0+=FIN_H;
  }

  const finishY = rooms[rooms.length-1].y0 + 168;
  /* 방마다 dyn 의 기준 각도를 고정해 둔다 */
  rooms.forEach(r=>r.dyn.forEach(d=>{ if(d.kind==='rot') d.ang0=d.ang; }));
  return { rooms, courseH:y0, finishY,
           types:rooms.slice(1,-1).map(r=>r.type) };
}

/* ── 구슬 배치 (슬롯은 고정, 팀 배정만 균등 셔플) ───────────────────── */
function placeMarbles(n){
  const r = n<=10 ? 15 : (n<=15 ? 13 : 11.5);
  const sb = world.rooms[0].startBox;
  const per = Math.min(n,7), rows=Math.ceil(n/per);
  const slots=[];
  for(let i=0;i<n;i++){
    const rw=Math.floor(i/per), cl=i%per;
    const cnt=Math.min(per,n-rw*per);
    const x = sb.x0 + (sb.x1-sb.x0)*(cnt===1?0.5:cl/(cnt-1));
    const y = sb.y + rw*(r*2+14);
    slots.push({x,y});
  }
  const order=H.shuffle([...Array(n).keys()]);   // ★ 균등 셔플
  return slots.map((s,i)=>{
    const tm=H.teams[order[i]] || {color:'#9aa', no:order[i]+1};   // 검증 실행 대비
    return {
      x:s.x, y:s.y, vx:(H.rnd()-.5)*8, vy:0, r,
      team:order[i], color:tm.color, no:tm.no,
      fin:-1, best:s.y, stuck:0, cool:0, boostT:-9, trail:[]
    };
  });
}

/* ============================================================================
   충돌
   ========================================================================= */
function hitPoint(m,px,py,rad,rest,svx,svy,obj,boost){
  let nx=m.x-px, ny=m.y-py, d=Math.hypot(nx,ny);
  const R=m.r+rad;
  if(d>=R) return;
  if(d<1e-6){ nx=0; ny=-1; d=1e-6; } else { nx/=d; ny/=d; }
  m.x+=nx*(R-d); m.y+=ny*(R-d);
  svx=svx||0; svy=svy||0;
  const vn=(m.vx-svx)*nx+(m.vy-svy)*ny;
  if(vn>=0) return;
  const e=rest||REST;
  const jn=-(1+e)*vn;
  m.vx+=jn*nx; m.vy+=jn*ny;
  if(boost && simT-m.boostT>1.2){              // 점프대 — 항상 같은 세기로 밀어낸다
    /* 쿨다운을 두지 않으면 쏘아올린 구슬이 같은 점프대로 떨어져 무한히 반복된다 */
    const out=(m.vx-svx)*nx+(m.vy-svy)*ny;
    if(out<boost){ const add=boost-out; m.vx+=add*nx; m.vy+=add*ny; m.boostT=simT; if(obj)obj.flash=1; }
  }
  const tx=-ny, ty=nx;
  const vt=(m.vx-svx)*tx+(m.vy-svy)*ty;
  const fr=FRIC*Math.abs(jn);
  const dvt=Math.max(-fr,Math.min(fr,-vt));
  m.vx+=dvt*tx; m.vy+=dvt*ty;
  if(obj && e>1) obj.flash=1;
}
function hitSeg(m,s,svx,svy,om,ocx,ocy){
  const dx=s.x2-s.x1, dy=s.y2-s.y1, L2=dx*dx+dy*dy||1;
  let t=((m.x-s.x1)*dx+(m.y-s.y1)*dy)/L2;
  t=t<0?0:(t>1?1:t);
  const px=s.x1+dx*t, py=s.y1+dy*t;
  let ax=svx||0, ay=svy||0;
  if(om){ ax=-om*(py-ocy); ay=om*(px-ocx); }
  hitPoint(m,px,py,s.hw,s.rest,ax,ay,s,s.boost);
}
/* 구슬이 속한 방 번호 — 브로드페이즈용 */
function roomIndex(y){
  if(y<START_H) return 0;
  const i=1+Math.floor((y-START_H)/H_ROOM);
  return Math.max(0,Math.min(world.rooms.length-1,i));
}

/* ============================================================================
   한 스텝
   ----------------------------------------------------------------------------
   끼임 안전망 (3단계) — 위로 갈수록 강해진다. 구슬은 서로 완전히 동일하고
   출발 슬롯만 균등 셔플하므로, 안전망이 개입해도 공정성은 영향받지 않는다.
     1단계 0.8초  약한 흔들기
     2단계 2.5초  출구 게이트 쪽으로 밀기
     3단계 6.0초  게이트 바로 위로 옮기기 (최후의 수단 — 발동 횟수를 계측한다)
   ========================================================================= */
let rescue=[0,0,0], rescueAt={};
function step(dt){
  simT+=dt;
  const rooms=world.rooms;
  for(const rm of rooms) for(const d of rm.dyn) stepDyn(d,simT);
  for(const c of world.allCircles) if(c.flash>0) c.flash=Math.max(0,c.flash-dt*3);

  for(const m of marbles){
    if(m.fin>=0) continue;
    m.vy += GRAV*dt;
    m.vx *= AIR; m.vy *= AIR;
    const sp0=Math.hypot(m.vx,m.vy);
    if(sp0>MAXV){ m.vx=m.vx/sp0*MAXV; m.vy=m.vy/sp0*MAXV; }
    m.x += m.vx*dt; m.y += m.vy*dt;

    const ri=roomIndex(m.y);
    for(let k=Math.max(0,ri-1); k<=Math.min(rooms.length-1,ri+1); k++){
      const rm=rooms[k];
      for(const s of rm.walls)   hitSeg(m,s,0,0,0,0,0);
      for(const c of rm.circles) hitPoint(m,c.x,c.y,c.r,c.rest,0,0,c);
      for(const d of rm.dyn){
        if(d.kind==='rot') hitSeg(m,d.seg,0,0,d.omega,d.cx,d.cy);
        else               hitSeg(m,d.seg,d.vx,d.vy,0,0,0);
      }
    }
    /* 월드 밖으로 새어나가지 않게 (혹시 모를 이중 안전) */
    if(m.x<m.r){ m.x=m.r; if(m.vx<0) m.vx=-m.vx*REST; }
    if(m.x>WORLD_W-m.r){ m.x=WORLD_W-m.r; if(m.vx>0) m.vx=-m.vx*REST; }

    /* ── 끼임 안전망 ──
       깊이 진전이 없으면서 '느릴 때'만 끼임으로 본다. 활발히 튀는 중인
       구슬은 정상이므로 건드리지 않는다. */
    if(m.y > m.best+2){ m.best=m.y; m.stuck=0; m.cool=0; }
    else m.stuck+=dt;
    m.cool+=dt;
    /* 흔든 뒤에도 타이머는 계속 흐르게 둔다. 0으로 되돌리면 1단계만 무한 반복되고
       2·3단계로 올라가지 못한다. */
    if(m.stuck>3.0 && m.cool>0.7){
      const rm=rooms[roomIndex(m.y)];
      m.cool=0;
      if(m.stuck>10.0){
        m.x=rm.gOut; m.y=rm.y0+rm.h-FLOOR_H-m.r-6;
        m.vx=(H.rnd()-.5)*60; m.vy=320;
        m.stuck=0; m.best=m.y; rescue[2]++;
        rescueAt[rm.type+'#3']=(rescueAt[rm.type+'#3']||0)+1;
      } else if(m.stuck>6.0){
        m.vx += (rm.gOut-m.x)*2.0 + (H.rnd()-.5)*180;
        m.vy += 340; rescue[1]++;
        rescueAt[rm.type+'#2']=(rescueAt[rm.type+'#2']||0)+1;
      } else {
        m.vx += (H.rnd()-.5)*480; m.vy += 220; rescue[0]++;
      }
    }
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
  /* 결승선 */
  for(const m of marbles){
    if(m.fin>=0) continue;
    if(m.y>=world.finishY){
      m.fin=finished.length; finished.push(m);
      H.setCounter(finished.length, marbles.length);
    }
  }
}

/* ============================================================================
   렌더
   ========================================================================= */
let CW=0,CH=0,DPR=1,scale=1,viewW=860,viewH=0;
function resize(){
  if(!cv) return;
  const r=cv.parentElement.getBoundingClientRect();
  CW=r.width; CH=r.height;
  DPR=Math.min(window.devicePixelRatio||1,2);
  cv.width=Math.round(CW*DPR); cv.height=Math.round(CH*DPR);
  viewW = CW>=900 ? 880 : (CW>=620 ? 740 : 580);   // 좁은 화면일수록 더 확대
  scale = CW/viewW;
  viewH = CH/scale;
}
function drawWorldTo(g,rooms,top,bot){
  g.lineCap='round';
  for(const rm of rooms){
    if(rm.y0+rm.h<top||rm.y0>bot) continue;
    g.strokeStyle='rgba(255,255,255,.32)';
    for(const s of rm.walls){
      g.lineWidth=s.hw*2;
      g.strokeStyle = s.boost ? 'rgba(255,214,120,.92)' : 'rgba(255,255,255,.32)';
      g.beginPath(); g.moveTo(s.x1,s.y1); g.lineTo(s.x2,s.y2); g.stroke();
    }
    for(const c of rm.circles){
      const bump=c.rest>=0.8;
      const gr=g.createRadialGradient(c.x-c.r*.3,c.y-c.r*.4,c.r*.1,c.x,c.y,c.r);
      if(bump){
        const f=c.flash;
        gr.addColorStop(0,'rgba(255,255,255,'+(0.75+f*0.25)+')');
        gr.addColorStop(1,'rgba(255,150,90,'+(0.45+f*0.5)+')');
      } else {
        gr.addColorStop(0,'rgba(255,255,255,.5)');
        gr.addColorStop(1,'rgba(168,237,245,.22)');
      }
      g.fillStyle=gr; g.beginPath(); g.arc(c.x,c.y,c.r,0,7); g.fill();
      g.strokeStyle= bump ? 'rgba(255,190,120,.9)' : 'rgba(255,255,255,.4)';
      g.lineWidth=2; g.stroke();
    }
    for(const d of rm.dyn){
      const s=d.seg; if(!s) continue;
      g.strokeStyle='rgba(168,237,245,.8)'; g.lineWidth=d.hw*2;
      g.beginPath(); g.moveTo(s.x1,s.y1); g.lineTo(s.x2,s.y2); g.stroke();
      if(d.kind==='rot'){ g.fillStyle='rgba(255,255,255,.6)'; g.beginPath(); g.arc(d.cx,d.cy,7,0,7); g.fill(); }
    }
  }
}
function draw(){
  if(!cv||!cx||!world) return;
  const g=cx;
  g.setTransform(DPR,0,0,DPR,0,0);
  g.clearRect(0,0,CW,CH);
  g.save();
  g.scale(scale,scale);
  g.translate(-camX,-camY);

  const top=camY-80, bot=camY+viewH+80;
  drawWorldTo(g,world.rooms,top,bot);

  /* 결승선 */
  const fy=world.finishY, fr=world.rooms[world.rooms.length-1];
  if(fy>top&&fy<bot){
    g.save(); g.setLineDash([16,12]);
    g.strokeStyle='#A8EDF5'; g.lineWidth=5;
    g.beginPath(); g.moveTo(fr.x0,fy); g.lineTo(fr.x0+W_ROOM,fy); g.stroke(); g.restore();
    g.fillStyle='rgba(168,237,245,.9)'; g.font='900 34px sans-serif'; g.textAlign='center';
    g.fillText('FINISH', fr.x0+W_ROOM/2, fy-20); g.textAlign='left';
  }
  /* 꼬리 */
  if(H.settings.useFx){
    for(const m of marbles){
      if(m.trail.length<2) continue;
      g.strokeStyle=m.color; g.lineWidth=m.r*0.9; g.lineCap='round';
      g.globalAlpha=.28; g.beginPath(); g.moveTo(m.trail[0].x,m.trail[0].y);
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
    gr.addColorStop(0,'#fff'); gr.addColorStop(.45,m.color); gr.addColorStop(1,m.color);
    g.fillStyle=gr; g.beginPath(); g.arc(m.x,m.y,m.r,0,7); g.fill();
    g.restore();
    g.strokeStyle='rgba(255,255,255,.85)'; g.lineWidth=1.6; g.stroke();
    g.fillStyle='#161233'; g.font='900 '+Math.round(m.r*1.05)+'px sans-serif';
    g.textAlign='center'; g.textBaseline='middle';
    g.fillText(String(m.no), m.x, m.y+0.5);
    g.textAlign='left'; g.textBaseline='alphabetic';
  }
  g.restore();
  drawMinimap(g);
}
/* ── 미니맵 — 전체 코스와 현재 보고 있는 위치 ─────────────────────── */
function drawMinimap(g){
  const mw=Math.min(96, CW*0.13), pad=10;
  const mh=Math.min(CH-pad*2, mw*(world.courseH/WORLD_W));
  const s=Math.min(mw/WORLD_W, mh/world.courseH);
  const ox=CW-pad-WORLD_W*s, oy=pad;
  g.save();
  g.globalAlpha=.9;
  g.fillStyle='rgba(9,7,32,.5)';
  g.fillRect(ox-6,oy-6,WORLD_W*s+12,world.courseH*s+12);
  g.strokeStyle='rgba(255,255,255,.18)'; g.lineWidth=1;
  g.strokeRect(ox-6,oy-6,WORLD_W*s+12,world.courseH*s+12);
  g.translate(ox,oy); g.scale(s,s);
  g.strokeStyle='rgba(255,255,255,.34)'; g.lineWidth=Math.max(6,1/s*1.4);
  g.beginPath();
  for(const rm of world.rooms) for(const w of rm.walls){ g.moveTo(w.x1,w.y1); g.lineTo(w.x2,w.y2); }
  g.stroke();
  for(const m of marbles){
    g.fillStyle=m.color;
    g.beginPath(); g.arc(m.x,m.y,Math.max(9,1/s*4),0,7); g.fill();
  }
  g.strokeStyle='#A8EDF5'; g.lineWidth=Math.max(7,1/s*2);
  g.strokeRect(camX,camY,viewW,viewH);
  g.restore();
}

/* ============================================================================
   순위 패널
   ========================================================================= */
function buildRankPanel(){
  rankBox.innerHTML=''; rankRows=[];
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

/* ============================================================================
   루프 · 카메라
   ========================================================================= */
function tick(now){
  if(!world){ raf=0; return; }
  const dt=Math.min(0.05,(now-lastT)/1000); lastT=now;
  if(running){
    elapsed+=dt;
    acc+=dt*speed;
    let guard=0;
    while(acc>=SUB && guard++<900){ step(SUB); acc-=SUB; }
    for(const m of marbles){
      if(m.fin>=0) continue;
      m.trail.push({x:m.x,y:m.y});
      if(m.trail.length>9) m.trail.shift();
    }
    if(finished.length>=marbles.length || elapsed>TIMEOUT) endRace();
  }
  /* 카메라 — 선두를 가로·세로 모두 따라간다 */
  let lead=null;
  for(const m of marbles) if(m.fin<0 && (!lead||m.y>lead.y)) lead=m;
  const tx = lead ? lead.x : world.rooms[world.rooms.length-1].x0+W_ROOM/2;
  const ty = lead ? lead.y : world.finishY;
  let targetX=Math.max(0,Math.min(WORLD_W-viewW, tx-viewW/2));
  let targetY=Math.max(0,Math.min(world.courseH-viewH, ty-viewH*0.42));
  const k=Math.min(1,dt*5);
  camX+=(targetX-camX)*k; camY+=(targetY-camY)*k;
  draw();
  if(performance.now()-rankT>110){ rankT=performance.now(); updateRank(); }
  raf=requestAnimationFrame(tick);
}
function endRace(){
  if(!running) return;
  running=false;
  const rest=marbles.filter(m=>m.fin<0).sort((a,b)=>b.y-a.y);
  for(const m of rest){ m.fin=finished.length; finished.push(m); }
  H.setCounter(finished.length, marbles.length);
  updateRank();
  elStart.disabled=true; elAgain.style.display='';
  H.finish(finished.map(m=>m.team));
}
function reset(){
  const rc = H.n<=8 ? 8 : (H.n<=14 ? 9 : 10);
  world=buildCourse(H.n, rc);
  world.allCircles=[]; world.rooms.forEach(r=>r.circles.forEach(c=>world.allCircles.push(c)));
  marbles=placeMarbles(H.n);
  finished=[]; running=false; elapsed=0; simT=0; acc=0;
  rescue=[0,0,0];
  camX=Math.max(0,Math.min(WORLD_W-viewW, marbles[0].x-viewW/2));
  camY=0;
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

/* 코스 검증용 — 화면 없이 한 판을 끝까지 돌려 결과를 돌려준다.
   콘솔에서 __marbleStress(20, 200) 처럼 실행하면 끼임 여부를 직접 확인할 수 있다. */
window.__marbleStress = function(n, runs, roomCount){
  n=n||12; runs=runs||100;
  const save={teams:H&&H.teams};
  if(!H) { console.warn('게임을 한 번 연 뒤에 실행하세요'); return; }
  let worst=0, sum=0, fail=0, resc=[0,0,0], types={}, stuckAt={};
  rescueAt={};
  for(let k=0;k<runs;k++){
    const rc = roomCount || (n<=8?8:(n<=14?9:10));
    world=buildCourse(n,rc);
    world.allCircles=[]; world.rooms.forEach(r=>r.circles.forEach(c=>world.allCircles.push(c)));
    world.types.forEach(t=>types[t]=(types[t]||0)+1);
    marbles=placeMarbles(n); finished=[]; simT=0; rescue=[0,0,0];
    let t=0;
    while(finished.length<n && t<TIMEOUT){ step(SUB); t+=SUB; }
    if(finished.length<n){
      fail++;
      for(const m of marbles) if(m.fin<0){
        const ri=roomIndex(m.y), t=(world.rooms[ri]||{}).type||'?';
        stuckAt[t]=(stuckAt[t]||0)+1;
      }
    }
    sum+=t; worst=Math.max(worst,t);
    resc[0]+=rescue[0]; resc[1]+=rescue[1]; resc[2]+=rescue[2];
  }
  const out={n,runs,미완주:fail,평균초:+(sum/runs).toFixed(1),최장초:+worst.toFixed(1),
             구조1_흔들기:resc[0],구조2_게이트로밀기:resc[1],구조3_옮기기:resc[2],
             막힌곳:stuckAt,구조발동위치:rescueAt,방종류:types};
  if(cv) reset();          // 검증이 끝나면 실제 게임 상태를 되돌려 놓는다
  else { world=null; marbles=[]; finished=[]; }
  return out;
};

/* ── 등록 ───────────────────────────────────────────────────────────── */
Core.registerGame({
  id:'marble', icon:'🎱', name:'마블 레이스',
  desc:'구슬이 꺾이는 덕트를 굴러 내려갑니다. 점프대·범퍼·회전 날개를 지나 결승선을 통과한 순서가 결과가 됩니다.',

  optionsHtml(){
    return '<div class="field"><label>기본 재생 속도</label>'+
      '<div class="seg" id="mbSpeed">'+
      '<button data-v="1">보통<span class="sub">1배속</span></button>'+
      '<button data-v="2">빠르게<span class="sub">2배속</span></button>'+
      '</div></div>'+
      '<div class="hint">경주 중에도 화면 위 버튼으로 속도를 바꿀 수 있습니다. '+
      '코스는 매번 새로 만들어지며, 출발 위치는 암호학적 난수로 균등하게 섞여 결과가 공정합니다.</div>';
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
    elSpeed.addEventListener('click',()=>{ speed = speed>=4 ? 1 : speed*2; elSpeed.textContent=speed+'배속'; });
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
