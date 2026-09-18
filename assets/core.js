/* ============================================================================
   두구두구 — core.js · 공통 코어
   ----------------------------------------------------------------------------
   · 설정 상태(행사 정보 · 팀 · 연출) 보관과 저장
   · 팀 컬러 생성, 암호학적 난수 유틸
   · 화면 전환(설정 → 게임 → 결과), 카운트다운, 결과 화면, 결과 PNG 저장
   · 게임 모듈 등록 API (Core.registerGame)
   ----------------------------------------------------------------------------
   [문구] 현재 한국어 전용. 다국어가 필요해지면 이 파일의 문자열을
          { ko:'…', en:'…' } 형태 사전으로 바꾸고 t() 를 거치게 하면 된다.
   ========================================================================= */
'use strict';

const Core = (() => {

/* ── 상수 ───────────────────────────────────────────────────────────── */
/* 단일 게임 빌드에서는 core.js 앞에서 window.APP_NAME 을 지정해 이름을 바꾼다 */
const APP_NAME = (typeof window!=='undefined' && window.APP_NAME) || '두구두구';
const MAX_TEAMS = 20;
const TEAM_COLORS = [
  '#C77DE0','#4FC3D9','#7BE0C0','#6C8FE8','#A78BFA',
  '#F49AC8','#5FD6B0','#8FB8FF','#B58CF5','#63D9E8'
];
const FONT_PRESETS = [
  {v:'',                  n:'기본 (자동)'},
  {v:'Pretendard',        n:'Pretendard'},
  {v:'Malgun Gothic',     n:'맑은 고딕'},
  {v:'NanumGothic',       n:'나눔고딕'},
  {v:'NanumSquare',       n:'나눔스퀘어'},
  {v:'NanumSquareRound',  n:'나눔스퀘어라운드'},
  {v:'Noto Sans KR',      n:'Noto Sans KR'},
  {v:'S-Core Dream 5',    n:'에스코어드림'},
  {v:'GmarketSansMedium', n:'G마켓 산스'},
  {v:'__custom__',        n:'직접 입력…'}
];
const DEF = {
  title:'', sub:'', font:'', fontCustom:'',
  n:5, teams:['','','','',''],
  game:'ladder', showNo:false, useFx:true, useCount:true,
  opts:{}
};

/* ── 상태 ───────────────────────────────────────────────────────────── */
let S = JSON.parse(JSON.stringify(DEF));
let GAMES = [];
let active = null;          // 현재 게임 모듈
let curScreen = 'setup';
let lastResults = null;     // [발표순서 index] = teamIndex
let teams = [];             // [{name,no,color}]

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ── 난수 (crypto 기반 · 균등) ──────────────────────────────────────── */
function rndInt(max){
  if(max<=0) return 0;
  const lim=Math.floor(4294967296/max)*max, b=new Uint32Array(1);
  let v; do{ crypto.getRandomValues(b); v=b[0]; }while(v>=lim);
  return v%max;
}
function rnd(){ const b=new Uint32Array(1); crypto.getRandomValues(b); return b[0]/4294967296; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=rndInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }

/* ── 색 ─────────────────────────────────────────────────────────────── */
function hsl(h,s,l){
  s/=100; l/=100;
  const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l);
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
  const hex=v=>Math.round(v*255).toString(16).padStart(2,'0');
  return '#'+hex(f(0))+hex(f(8))+hex(f(4));
}
/* 10팀까지는 고른 색, 11팀 이상은 색상환 균등 분할 → 20팀까지 중복 없음 */
function teamColors(n){
  if(n<=TEAM_COLORS.length) return TEAM_COLORS.slice(0,n);
  const out=[];
  for(let i=0;i<n;i++){
    const h=(268+i*(360/n))%360, l=i%2?64:73, sa=i%3===2?58:70;
    out.push(hsl(h,sa,l));
  }
  return out;
}
function lighten(hex,k){
  const m=hex.replace('#','');
  const v=[0,2,4].map(i=>parseInt(m.substr(i,2),16));
  return '#'+v.map(c=>Math.round(c+(255-c)*k).toString(16).padStart(2,'0')).join('');
}
const esc = s => String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

/* ── 알림 ───────────────────────────────────────────────────────────── */
let toastT=0;
function toast(msg){
  const el=$('#toast'); el.textContent=msg; el.classList.add('on');
  clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'),2200);
}

/* ── 저장 ───────────────────────────────────────────────────────────── */
function save(){ try{ localStorage.setItem('partygames_v1', JSON.stringify(S)); }catch(e){} }
function load(){
  try{
    const r=localStorage.getItem('partygames_v1');
    if(r) S=Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(r));
  }catch(e){}
  if(!Array.isArray(S.teams)) S.teams=DEF.teams.slice();
  if(!S.opts||typeof S.opts!=='object') S.opts={};
  S.n=Math.max(2,Math.min(MAX_TEAMS,S.n|0||5));
}

/* ── 게임 등록 ──────────────────────────────────────────────────────── */
function registerGame(g){ GAMES.push(g); }
function gameById(id){ return GAMES.find(g=>g.id===id) || GAMES[0]; }

/* ── 설정 화면 ──────────────────────────────────────────────────────── */
function applyFont(){
  const f=(S.font==='__custom__'?S.fontCustom:S.font)||'Pretendard';
  document.documentElement.style.setProperty('--font-user', '"'+f+'"');
}
function applyBrand(){
  $('#pTitle').textContent = S.title||'';
  $('#pSub').textContent   = S.sub||'';
  $('#rTitle').textContent = S.title||'';
  $('#rSub').textContent   = S.sub||'';
  document.title = (S.title? S.title+' · ' : '') + APP_NAME;
}
function renderTeamList(){
  const box=$('#teamList'); box.innerHTML='';
  const COL=teamColors(S.n);
  for(let i=0;i<S.n;i++){
    const row=document.createElement('div'); row.className='trow';
    row.innerHTML =
      '<div class="tdot" style="background:'+COL[i]+';box-shadow:0 4px 14px '+COL[i]+'55">'+(i+1)+'</div>'+
      '<input class="inp" data-i="'+i+'" placeholder="'+(i+1)+'번 팀" maxlength="24" value="'+esc(S.teams[i]||'')+'">';
    box.appendChild(row);
  }
  box.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input', e=>{ S.teams[+e.target.dataset.i]=e.target.value; save(); });
    inp.addEventListener('keydown', e=>{
      if(e.key!=='Enter') return;
      const i=+e.target.dataset.i, next=box.querySelector('input[data-i="'+(i+1)+'"]');
      if(next) next.focus(); else $('#bStart').focus();
    });
  });
}
function renderGames(){
  const box=$('#gameList'); box.innerHTML='';
  const only = GAMES.length<=1;
  const title=document.querySelector('.games-wrap .section-title');
  if(title) title.style.display = only?'none':'';
  box.style.display = only?'none':'';
  if(only && GAMES[0]) S.game=GAMES[0].id;
  if(only) return;
  GAMES.forEach(g=>{
    const b=document.createElement('button');
    b.className='gcard'+(S.game===g.id?' on':'');
    b.dataset.id=g.id;
    b.innerHTML='<div class="chk">✓</div><div class="gi">'+g.icon+'</div>'+
                '<div class="gn">'+esc(g.name)+'</div><div class="gd">'+esc(g.desc)+'</div>';
    b.addEventListener('click',()=>{ S.game=g.id; save(); renderGames(); renderGameOpts(); });
    box.appendChild(b);
  });
}
function renderGameOpts(){
  const box=$('#gameOpts'); box.innerHTML='';
  const g=gameById(S.game);
  if(!g.optionsHtml) return;
  const card=document.createElement('div');
  card.className='card';
  card.innerHTML='<h2>'+esc(g.name)+' 설정</h2>'+g.optionsHtml();
  box.appendChild(card);
  if(g.bindOptions) g.bindOptions(card, S.opts[g.id] = S.opts[g.id]||{}, save);
}
function syncSetup(){
  $('#fTitle').value=S.title; $('#fSub').value=S.sub;
  $('#cVal').textContent=S.n;
  $('#fFontSel').value=S.font; $('#fFontCustom').value=S.fontCustom;
  $('#fFontCustomWrap').style.display = S.font==='__custom__'?'':'none';
  $('#tgCount').classList.toggle('on',S.useCount);
  $('#tgFx').classList.toggle('on',S.useFx);
  $('#tgNo').classList.toggle('on',S.showNo);
  document.body.classList.toggle('noeffect',!S.useFx);
  renderTeamList(); renderGames(); renderGameOpts(); applyFont(); applyBrand();
}
function initSetup(){
  const sel=$('#fFontSel');
  FONT_PRESETS.forEach(f=>{ const o=document.createElement('option'); o.value=f.v; o.textContent=f.n; sel.appendChild(o); });
  sel.addEventListener('change',e=>{ S.font=e.target.value;
    $('#fFontCustomWrap').style.display=S.font==='__custom__'?'':'none'; applyFont(); save(); });
  $('#fFontCustom').addEventListener('input',e=>{ S.fontCustom=e.target.value; applyFont(); save(); });
  $('#fTitle').addEventListener('input',e=>{ S.title=e.target.value; applyBrand(); save(); });
  $('#fSub').addEventListener('input',e=>{ S.sub=e.target.value; applyBrand(); save(); });
  $('#cMinus').addEventListener('click',()=>{ if(S.n>2){ S.n--; syncSetup(); save(); } });
  $('#cPlus').addEventListener('click',()=>{ if(S.n<MAX_TEAMS){ S.n++; if(!S.teams[S.n-1])S.teams[S.n-1]=''; syncSetup(); save(); } });
  $('#tgCount').addEventListener('click',()=>{ S.useCount=!S.useCount; syncSetup(); save(); });
  $('#tgFx').addEventListener('click',()=>{ S.useFx=!S.useFx; syncSetup(); save(); });
  $('#tgNo').addEventListener('click',()=>{ S.showNo=!S.showNo; syncSetup(); save(); });
  $('#bClear').addEventListener('click',()=>{ S.teams=new Array(S.n).fill(''); syncSetup(); save(); });
  $('#bReset').addEventListener('click',()=>{
    S=JSON.parse(JSON.stringify(DEF)); syncSetup(); save(); toast('설정을 초기화했습니다');
  });
  /* 여러 줄 붙여넣기 */
  $('#bPaste').addEventListener('click',()=>{
    $('#pasteArea').value=S.teams.slice(0,S.n).join('\n');
    $('#modal').classList.add('on'); $('#pasteArea').focus();
  });
  $('#pasteCancel').addEventListener('click',()=>$('#modal').classList.remove('on'));
  $('#modal').addEventListener('click',e=>{ if(e.target===$('#modal')) $('#modal').classList.remove('on'); });
  $('#pasteOk').addEventListener('click',()=>{
    const lines=$('#pasteArea').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(!lines.length){ toast('입력된 팀 이름이 없습니다'); return; }
    if(lines.length>MAX_TEAMS) toast('최대 '+MAX_TEAMS+'팀까지만 반영했습니다');
    S.n=Math.max(2,Math.min(MAX_TEAMS,lines.length));
    S.teams=new Array(S.n).fill('').map((_,i)=>lines[i]||'');
    $('#modal').classList.remove('on'); syncSetup(); save();
    toast(S.n+'개 팀을 넣었습니다');
  });
  $('#bStart').addEventListener('click',startGame);
}

/* ── 게임 시작 ──────────────────────────────────────────────────────── */
function startGame(){
  for(let i=0;i<S.n;i++) if(!(S.teams[i]||'').trim()) S.teams[i]=(i+1)+'번 팀';
  renderTeamList(); save();
  const COL=teamColors(S.n);
  teams=[]; for(let i=0;i<S.n;i++) teams.push({name:S.teams[i], no:i+1, color:COL[i]});
  lastResults=null;
  const g=gameById(S.game);
  active=g;
  $('#pGame').textContent=g.name;
  $('#gameTools').innerHTML='';
  $('#bRes').style.display='none';
  $('#stage').innerHTML='';
  setCounter(0,S.n); setTip('');
  showScreen('play');
  requestAnimationFrame(()=>g.start(host));
}

/* ── 게임에 제공하는 API ────────────────────────────────────────────── */
const host = {
  get stage(){ return $('#stage'); },
  get teams(){ return teams; },
  get n(){ return teams.length; },
  get settings(){ return S; },
  opts(){ return (S.opts[active.id] = S.opts[active.id]||{}); },
  rnd, rndInt, shuffle, lighten, esc, toast,
  setTip, setCounter, countdown,
  tool(html){
    const w=document.createElement('div'); w.innerHTML=html.trim();
    const el=w.firstElementChild; $('#gameTools').appendChild(el); return el;
  },
  finish(results){                       // results[발표순서 idx] = teamIndex
    lastResults=results.slice();
    $('#bRes').style.display='';
    setTip('추첨 완료! 결과를 확인하세요');
    setTimeout(showResult, 1200);
  }
};
function setTip(t){ $('#tip').textContent=t||''; }
function setCounter(d,t){ $('#cDone').textContent=d; $('#cAll').textContent=t; }

/* ── 카운트다운 ─────────────────────────────────────────────────────── */
const CIRC=2*Math.PI*47;
function countdown(from){
  if(!S.useCount) return Promise.resolve();
  return new Promise(res=>{
    const box=$('#cd'), num=$('#cdNum'), ring=$('#cdRing');
    box.classList.add('on');
    let i=from;
    const step=()=>{
      if(i<=0){
        box.classList.remove('on');
        const s=document.createElement('div'); s.className='shock';
        document.body.appendChild(s);
        requestAnimationFrame(()=>s.classList.add('go'));
        setTimeout(()=>s.remove(),900);
        res(); return;
      }
      num.textContent=i;
      num.classList.remove('cd-tick'); void num.offsetWidth; num.classList.add('cd-tick');
      const t0=performance.now();
      const anim=n=>{ const k=Math.min(1,(n-t0)/900);
        ring.style.strokeDasharray=CIRC; ring.style.strokeDashoffset=CIRC*k;
        if(k<1) requestAnimationFrame(anim); };
      requestAnimationFrame(anim);
      i--; setTimeout(step,920);
    };
    step();
  });
}

/* ── 결과 화면 ──────────────────────────────────────────────────────── */
function showResult(){
  if(!lastResults) return;
  const n=lastResults.length, box=$('#resList');
  box.innerHTML='';
  box.classList.toggle('dense', n>=8 && n<=10);
  box.classList.toggle('cols2', n>=11);
  box.style.gridTemplateRows = n>=11 ? 'repeat('+Math.ceil(n/2)+',1fr)' : '';
  for(let j=0;j<n;j++){
    const tm=teams[lastResults[j]];
    const row=document.createElement('div'); row.className='rrow';
    row.style.borderColor=tm.color+'99';
    row.style.background='linear-gradient(100deg, '+tm.color+'33, rgba(9,7,32,.34) 60%)';
    row.style.boxShadow='0 8px 26px rgba(8,6,26,.25), 0 0 0 1px '+tm.color+'55';
    row.innerHTML =
      '<div class="rank" style="background:'+tm.color+';box-shadow:0 8px 26px '+tm.color+'66">'+(j+1)+'</div>'+
      '<div class="rinfo"><div class="rord">'+(j+1)+'번째 발표</div>'+
      '<div class="rname">'+esc(tm.name)+'</div></div>'+
      (S.showNo?'<div class="rno">TEAM '+tm.no+'</div>':'');
    box.appendChild(row);
    setTimeout(()=>row.classList.add('in'), 110+j*(n>12?90:160));
  }
  showScreen('result');
}

/* ── 결과 PNG ───────────────────────────────────────────────────────── */
function rr(g,x,y,w,h,r){
  g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r);
  g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath();
}
function exportPng(){
  if(!lastResults) return;
  const n=lastResults.length, two=n>=11, cols=two?2:1;
  const per=Math.ceil(n/cols), rowH=112;
  const W=two?2280:1600, headH=S.title?300:230, H=headH+per*rowH+60;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const g=c.getContext('2d');
  const grd=g.createLinearGradient(0,0,W,H);
  grd.addColorStop(0,'#6E63B0'); grd.addColorStop(.45,'#5B8FD4'); grd.addColorStop(1,'#4FC3D9');
  g.fillStyle=grd; g.fillRect(0,0,W,H);
  const rg=g.createRadialGradient(W*.8,H*.1,0,W*.8,H*.1,W*.7);
  rg.addColorStop(0,'rgba(168,237,245,.35)'); rg.addColorStop(1,'rgba(168,237,245,0)');
  g.fillStyle=rg; g.fillRect(0,0,W,H);
  const F=(getComputedStyle(document.documentElement).getPropertyValue('--font-user')||'Pretendard').trim();
  const FF=F+', "Malgun Gothic", sans-serif';
  g.textBaseline='middle';
  let y=74;
  if(S.title){ g.fillStyle='rgba(255,255,255,.8)'; g.font='700 26px '+FF; g.fillText(S.title,72,y); y+=34; }
  if(S.sub){   g.fillStyle='rgba(255,255,255,.56)'; g.font='600 20px '+FF; g.fillText(S.sub,72,y); }
  g.fillStyle='#fff'; g.font='900 62px '+FF; g.fillText('발표 순서',72,headH-100);
  g.fillStyle='rgba(255,255,255,.6)'; g.font='700 24px '+FF;
  g.fillText(gameById(S.game).name+' · '+n+'팀', 72, headH-50);
  const pad=72, colGap=40, cw=(W-pad*2-(cols-1)*colGap)/cols;
  for(let j=0;j<n;j++){
    const tm=teams[lastResults[j]];
    const ci=Math.floor(j/per), ri=j%per;
    const x=pad+ci*(cw+colGap), ry=headH+ri*rowH;
    rr(g,x,ry,cw,rowH-16,20);
    g.fillStyle='rgba(9,7,32,.34)'; g.fill();
    g.strokeStyle=tm.color+'bb'; g.lineWidth=3; g.stroke();
    rr(g,x+24,ry+18,60,60,16); g.fillStyle=tm.color; g.fill();
    g.fillStyle='#161233'; g.font='900 32px '+FF; g.textAlign='center';
    g.fillText(String(j+1), x+54, ry+49); g.textAlign='left';
    g.fillStyle='rgba(255,255,255,.82)'; g.font='700 19px '+FF;
    g.fillText((j+1)+'번째 발표', x+108, ry+34);
    g.fillStyle='#fff'; g.font='900 38px '+FF;
    g.fillText(tm.name, x+108, ry+68);
    if(S.showNo){
      g.fillStyle='rgba(255,255,255,.5)'; g.font='800 20px '+FF; g.textAlign='right';
      g.fillText('TEAM '+tm.no, x+cw-28, ry+50); g.textAlign='left';
    }
  }
  const D=new Date(), z=v=>String(v).padStart(2,'0');
  g.fillStyle='rgba(255,255,255,.45)'; g.font='600 18px '+FF;
  g.fillText(D.getFullYear()+'.'+z(D.getMonth()+1)+'.'+z(D.getDate())+'  '+z(D.getHours())+':'+z(D.getMinutes()), 72, H-38);
  c.toBlob(b=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(b);
    a.download='발표순서_'+D.getFullYear()+z(D.getMonth()+1)+z(D.getDate())+'.png';
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
    toast('결과 이미지를 저장했습니다');
  });
}

/* ── 화면 전환 ──────────────────────────────────────────────────────── */
function showScreen(id){
  $$('.screen').forEach(s=>s.classList.remove('on'));
  $('#'+id).classList.add('on');
  curScreen=id;
  if(id==='play' && active && active.onShow) active.onShow();
}
function leaveGame(){
  if(active && active.stop) active.stop();
  active=null; showScreen('setup');
}
function toggleFs(){
  if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
  else document.exitFullscreen().catch(()=>{});
}

/* ── 배경 로우폴리 ──────────────────────────────────────────────────── */
let bg,bgx,pts=[],GC=0,GR=0,bgW=0,bgH=0,bgLast=0,DPR=1;
function bgInit(){
  DPR=Math.min(window.devicePixelRatio||1,2);
  bgW=bg.width=Math.round(innerWidth*DPR); bgH=bg.height=Math.round(innerHeight*DPR);
  bg.style.width=innerWidth+'px'; bg.style.height=innerHeight+'px';
  const cell=Math.max(150,innerWidth/9)*DPR;
  GC=Math.ceil(bgW/cell)+1; GR=Math.ceil(bgH/cell)+1; pts=[];
  for(let r=0;r<=GR;r++) for(let c=0;c<=GC;c++)
    pts.push({bx:c*cell,by:r*cell,jx:(Math.random()-.5)*cell*.55,jy:(Math.random()-.5)*cell*.55,
              ph:Math.random()*Math.PI*2,am:8+Math.random()*22});
}
function bgDraw(now){
  if(now-bgLast<42){ requestAnimationFrame(bgDraw); return; }
  bgLast=now; const t=now/1000;
  bgx.clearRect(0,0,bgW,bgH);
  const P=(r,c)=>{ const p=pts[r*(GC+1)+c];
    return {x:p.bx+p.jx+Math.cos(t*.16+p.ph)*p.am, y:p.by+p.jy+Math.sin(t*.13+p.ph)*p.am}; };
  for(let r=0;r<GR;r++) for(let c=0;c<GC;c++){
    const a=P(r,c),b=P(r,c+1),d=P(r+1,c),e=P(r+1,c+1), k=(r*7+c*13)%10;
    const tri=(p1,p2,p3,al,dark)=>{ bgx.beginPath(); bgx.moveTo(p1.x,p1.y); bgx.lineTo(p2.x,p2.y);
      bgx.lineTo(p3.x,p3.y); bgx.closePath();
      bgx.fillStyle = dark ? 'rgba(46,78,158,'+al+')' : 'rgba(255,255,255,'+al+')'; bgx.fill(); };
    tri(a,b,d, 0.018+((k%4)*0.016), k%3===0);
    tri(b,e,d, 0.014+(((k+5)%4)*0.017), (k+2)%3===0);
  }
  bgx.strokeStyle='rgba(255,255,255,.045)'; bgx.lineWidth=DPR; bgx.beginPath();
  for(let r=0;r<=GR;r++) for(let c=0;c<=GC;c++){
    const p=P(r,c);
    if(c<GC){ const q=P(r,c+1); bgx.moveTo(p.x,p.y); bgx.lineTo(q.x,q.y); }
    if(r<GR){ const q=P(r+1,c); bgx.moveTo(p.x,p.y); bgx.lineTo(q.x,q.y); }
  }
  bgx.stroke();
  requestAnimationFrame(bgDraw);
}

/* ── 부팅 ───────────────────────────────────────────────────────────── */
function boot(){
  bg=$('#bgPoly'); bgx=bg.getContext('2d');
  load(); initSetup(); syncSetup();
  bgInit(); requestAnimationFrame(bgDraw);

  $('#bFs').addEventListener('click',toggleFs);
  $('#bBack').addEventListener('click',leaveGame);
  $('#bHome').addEventListener('click',leaveGame);
  $('#bRes').addEventListener('click',showResult);
  $('#bGameBack').addEventListener('click',()=>showScreen('play'));
  $('#bPng').addEventListener('click',exportPng);

  document.addEventListener('keydown',e=>{
    const tag=(e.target.tagName||'').toLowerCase();
    if(tag==='input'||tag==='select'||tag==='textarea') return;
    if(e.key==='f'||e.key==='F'){ e.preventDefault(); toggleFs(); }
    if(curScreen==='setup' && e.key==='Enter') $('#bStart').click();
    if(active && active.onKey) active.onKey(e);
  });
  let rz=0;
  addEventListener('resize',()=>{
    clearTimeout(rz);
    rz=setTimeout(()=>{ bgInit(); if(active && active.onResize) active.onResize(); },140);
  });
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ S.useFx=false; S.useCount=false; syncSetup(); }
}

/* 셔플 균등성 자체 검증 — 콘솔에서 Core.auditShuffle(5) 로 확인할 수 있다.
   마블 레이스의 공정성은 이 셔플의 균등성에서 나온다. */
function auditShuffle(n,trials){
  n=n||5; trials=trials||240000;
  let fact=1; for(let i=2;i<=n;i++) fact*=i;
  if(fact*50<=trials){
    /* 팀이 적으면 n! 개 순열 전체의 출현 빈도를 직접 센다 */
    const cnt=Object.create(null);
    for(let k=0;k<trials;k++){ const a=shuffle([...Array(n).keys()]).join('-'); cnt[a]=(cnt[a]||0)+1; }
    const exp=trials/fact; let dev=0;
    Object.keys(cnt).forEach(k=>dev=Math.max(dev,Math.abs(cnt[k]-exp)/exp));
    return { mode:'순열 전수', n, trials, permsSeen:Object.keys(cnt).length, permsExpected:fact,
             maxDevPct:+(dev*100).toFixed(2),
             sigmaPct:+(Math.sqrt(trials*(1/fact)*(1-1/fact))/exp*100).toFixed(2) };
  }
  /* 팀이 많으면 순열 수가 시행 수보다 훨씬 많아 전수 검사가 무의미하다.
     대신 "각 팀이 각 자리에 놓일 확률"이 1/n 로 균등한지 본다. */
  const m=Array.from({length:n},()=>new Array(n).fill(0));
  for(let k=0;k<trials;k++){
    const a=shuffle([...Array(n).keys()]);
    for(let pos=0;pos<n;pos++) m[a[pos]][pos]++;
  }
  const exp=trials/n; let dev=0;
  m.forEach(r=>r.forEach(v=>dev=Math.max(dev,Math.abs(v-exp)/exp)));
  return { mode:'자리별 분포', n, trials,
           maxDevPct:+(dev*100).toFixed(2),
           sigmaPct:+(Math.sqrt(trials*(1/n)*(1-1/n))/exp*100).toFixed(2) };
}

return { boot, registerGame, teamColors, lighten, esc, toast, auditShuffle,
         rnd, rndInt, shuffle, get state(){return S;}, showResult };
})();
