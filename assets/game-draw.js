/* ============================================================================
   행운 뽑기 — 두구두구
   ----------------------------------------------------------------------------
   참가자가 한 명씩 와서 버튼을 누르면 등수 하나가 나온다.
   팀 개념이 없으므로 noTeams:true 로 등록해 설정 화면의 팀 입력을 감춘다.

   추첨 방식 — 재고형(비복원 추첨)
     · 등수별 '개수'를 미리 정해 둔다. 총 개수 = 뽑기권 수.
     · 한 번 뽑으면 그 등수의 재고가 1 줄어든다. 재고가 0이면 더는 안 나온다.
     · 따라서 준비한 경품이 정확히 그 수만큼 나간다.
     · 매 뽑기의 확률 = (그 등수 남은 개수) / (전체 남은 개수).
       남은 개수에 비례하므로 crypto 난수 하나로 구간을 고르면 그대로 균등하다.

   재고는 localStorage 에 저장된다. 태블릿을 새로고침하거나 설정 화면에
   다녀와도 이어진다. 행사가 끝나면 관리자 패널에서 초기화한다.
   ========================================================================= */
(function(){
'use strict';

var H=null, root=null, elAdmin=null, busy=false;

/* 등수 5단계 고정. 색은 1등부터 금·분홍·보라·하늘·회색 */
var TIERS=[
  {no:1, color:'#F5C542', glow:'rgba(245,197,66,.55)'},
  {no:2, color:'#F2619B', glow:'rgba(242,97,155,.5)'},
  {no:3, color:'#A78BFA', glow:'rgba(167,139,250,.5)'},
  {no:4, color:'#5BC8F5', glow:'rgba(91,200,245,.5)'},
  {no:5, color:'#AEB7CC', glow:'rgba(174,183,204,.45)'}
];
var DEF_CNT=[2,5,10,18,25];

/* ── 설정 읽기/쓰기 ─────────────────────────────────────────────────── */
function conf(){
  var o=H.opts();
  if(!Array.isArray(o.cnt)  || o.cnt.length!==5)  o.cnt=DEF_CNT.slice();
  if(!Array.isArray(o.left) || o.left.length!==5) o.left=o.cnt.slice();
  for(var i=0;i<5;i++){
    o.cnt[i]  = Math.max(0, Math.min(9999, o.cnt[i]|0));
    o.left[i] = Math.max(0, Math.min(o.cnt[i], o.left[i]|0));
  }
  return o;
}
var sum=function(a){ return a.reduce(function(x,y){return x+y;},0); };

/* ── 추첨 ───────────────────────────────────────────────────────────── */
/* 남은 재고에 비례해 한 칸을 고른다. 전체 남은 개수가 k 개면
   0..k-1 중 하나를 균등하게 뽑아 누적 구간에 떨어뜨리는 것과 같다. */
function pick(o){
  var total=sum(o.left);
  if(total<=0) return -1;
  var r=H.rndInt(total), acc=0;
  for(var i=0;i<5;i++){ acc+=o.left[i]; if(r<acc) return i; }
  return 4;
}

/* ── 화면 ───────────────────────────────────────────────────────────── */
function capsules(){
  /* 통 안에 떠 있는 캡슐. 움직이지 않는 정적 요소라 태블릿에 부담이 없다. */
  var pos=[[26,62],[52,44],[74,66],[38,80],[62,82],[18,40],[82,42],[50,68]];
  var h='';
  for(var i=0;i<pos.length;i++){
    var t=TIERS[i%5];
    h+='<i class="cap" style="left:'+pos[i][0]+'%;top:'+pos[i][1]+'%;'+
       'background:'+t.color+';box-shadow:0 4px 12px '+t.glow+'"></i>';
  }
  return h;
}

function render(){
  var o=conf();
  root.innerHTML =
    '<div class="draw-wrap">'+
      '<div class="dw-top">'+
        '<div class="dw-left">남은 뽑기권</div>'+
        '<div class="dw-num"><b id="dwLeft">'+sum(o.left)+'</b><span>/ '+sum(o.cnt)+'</span></div>'+
      '</div>'+
      '<div class="machine" id="dwMachine">'+
        '<div class="mc-dome"><div class="mc-gloss"></div>'+capsules()+'</div>'+
        '<div class="mc-neck"></div>'+
        '<div class="mc-body">'+
          '<button class="mc-knob" id="dwPush"><b>뽑기</b><span>PUSH</span></button>'+
          '<div class="mc-slot"></div>'+
        '</div>'+
      '</div>'+
      '<div class="dw-hint" id="dwHint">버튼을 누르면 한 장이 나옵니다</div>'+
    '</div>'+
    '<div class="ticket-back" id="dwBack">'+
      '<div class="ticket" id="dwTicket">'+
        '<div class="tk-kicker">EVENT TICKET</div>'+
        '<div class="tk-badge" id="dwBadge"><b id="dwRank">1</b><span>등</span></div>'+
        '<div class="tk-msg" id="dwMsg">축하합니다!</div>'+
        '<div class="tk-sub">안내 데스크에서 경품을 받아가세요</div>'+
        '<button class="btn primary" id="dwOk">확인</button>'+
      '</div>'+
    '</div>'+
    '<div class="adm-back" id="dwAdmBack"><div class="adm" id="dwAdm"></div></div>';

  root.querySelector('#dwPush').addEventListener('click', draw);
  root.querySelector('#dwOk').addEventListener('click', closeTicket);
  root.querySelector('#dwBack').addEventListener('click', function(e){
    if(e.target.id==='dwBack') closeTicket();
  });
  root.querySelector('#dwAdmBack').addEventListener('click', function(e){
    if(e.target.id==='dwAdmBack') root.querySelector('#dwAdmBack').classList.remove('on');
  });
  syncTop();
}

function syncTop(){
  var o=conf(), left=sum(o.left);
  var el=root.querySelector('#dwLeft'); if(el) el.textContent=left;
  H.setCounter(left, sum(o.cnt));
  var push=root.querySelector('#dwPush');
  if(push) push.disabled = left<=0 || busy;
  var hint=root.querySelector('#dwHint');
  if(hint) hint.textContent = left<=0 ? '뽑기권이 모두 소진되었습니다'
                                      : '버튼을 누르면 한 장이 나옵니다';
}

/* ── 뽑기 동작 ──────────────────────────────────────────────────────── */
function draw(){
  if(busy) return;
  var o=conf();
  if(sum(o.left)<=0){ H.toast('남은 뽑기권이 없습니다'); return; }
  busy=true; syncTop();

  var i=pick(o);
  o.left[i]--; H.save();

  var mc=root.querySelector('#dwMachine');
  mc.classList.add('shake');
  setTimeout(function(){
    mc.classList.remove('shake');
    showTicket(i);
    busy=false; syncTop();
  }, 620);
}

function showTicket(i){
  var t=TIERS[i];
  root.querySelector('#dwRank').textContent=t.no;
  var b=root.querySelector('#dwBadge');
  b.style.background='linear-gradient(145deg,'+H.lighten(t.color,0.18)+','+t.color+')';
  b.style.boxShadow='0 14px 36px '+t.glow;
  root.querySelector('#dwBack').classList.add('on');
  if(H.fx) confetti(t.color);
}
function closeTicket(){ root.querySelector('#dwBack').classList.remove('on'); }

/* 색종이 — CSS 애니메이션만 쓰고 24조각으로 제한한다.
   태블릿에서 캔버스 파티클을 돌리면 버벅이므로 쓰지 않는다. */
function confetti(c){
  var box=root.querySelector('#dwBack'), cols=[c,'#A8EDF5','#fff','#F2619B'];
  for(var k=0;k<24;k++){
    var p=document.createElement('i');
    p.className='cfti';
    p.style.left=(5+Math.random()*90)+'%';
    p.style.background=cols[k%cols.length];
    p.style.animationDelay=(Math.random()*0.25)+'s';
    p.style.transform='rotate('+(Math.random()*360)+'deg)';
    box.appendChild(p);
    (function(el){ setTimeout(function(){ el.remove(); },2200); })(p);
  }
}

/* ── 관리자 패널 ────────────────────────────────────────────────────── */
function openAdmin(){
  var o=conf(), total=sum(o.cnt), left=sum(o.left);
  var rows='';
  for(var i=0;i<5;i++){
    var t=TIERS[i], taken=o.cnt[i]-o.left[i];
    var pct = left>0 ? (o.left[i]/left*100) : 0;
    rows+=
      '<div class="adm-row">'+
        '<span class="adm-tier" style="background:'+t.color+'">'+t.no+'등</span>'+
        '<div class="adm-info"><b>총 '+o.cnt[i]+'개</b>'+
          '<span>남은 '+o.left[i]+'개 · 나간 '+taken+'개</span></div>'+
        '<div class="adm-pct"><b>'+pct.toFixed(1)+'%</b><span>지금 당첨 확률</span></div>'+
      '</div>';
  }
  root.querySelector('#dwAdm').innerHTML=
    '<h3>뽑기 현황</h3>'+
    rows+
    '<div class="adm-total">남은 뽑기권 <b>'+left+'</b> / '+total+'개</div>'+
    '<div class="adm-note">개수를 바꾸려면 <b>⚙ 설정으로</b> 에서 수정하세요. '+
      '재고는 새로고침해도 유지됩니다.</div>'+
    '<div class="adm-foot">'+
      '<button class="btn sm ghost" id="dwClose">닫기</button>'+
      '<button class="btn sm danger" id="dwReset">전부 초기화</button>'+
    '</div>';
  root.querySelector('#dwAdmBack').classList.add('on');
  root.querySelector('#dwClose').addEventListener('click',function(){
    root.querySelector('#dwAdmBack').classList.remove('on');
  });
  root.querySelector('#dwReset').addEventListener('click',function(){
    var oo=conf(); oo.left=oo.cnt.slice(); H.save();
    root.querySelector('#dwAdmBack').classList.remove('on');
    syncTop(); H.toast('뽑기권을 전부 되돌렸습니다');
  });
}

/* ── 설정 화면 ──────────────────────────────────────────────────────── */
function optRows(o){
  var total=sum(o.cnt), h='';
  for(var i=0;i<5;i++){
    var t=TIERS[i], pct = total>0 ? (o.cnt[i]/total*100) : 0;
    h+=
      '<div class="dcfg-row">'+
        '<span class="dcfg-tier" style="background:'+t.color+'">'+t.no+'등</span>'+
        '<label class="dcfg-f"><span>개수</span>'+
          '<input class="inp num" type="number" min="0" max="9999" data-k="cnt" data-i="'+i+'" value="'+o.cnt[i]+'"></label>'+
        '<label class="dcfg-f"><span>확률</span>'+
          '<input class="inp num" type="number" min="0" max="100" step="0.1" data-k="pct" data-i="'+i+'" value="'+pct.toFixed(1)+'"></label>'+
      '</div>';
  }
  return h;
}

var GAME={
  id:'draw', icon:'🎁', name:'행운 뽑기', noTeams:true,
  desc:'참가자가 한 명씩 눌러 1~5등을 뽑습니다. 등수별 개수를 정해두면 준비한 경품이 정확히 그만큼 나갑니다.',

  optionsHtml:function(){
    return '<div class="dcfg" id="dwCfg"></div>'+
      '<div class="dcfg-sum" id="dwSum"></div>'+
      '<div class="field row-btns" style="margin-top:12px">'+
        '<button class="btn sm ghost" id="dwRestock">재고 되돌리기</button>'+
      '</div>'+
      '<div class="hint">등수별 <b>개수</b>를 넣으면 그만큼만 나갑니다 — 준비한 경품이 정확히 소진됩니다. '+
      '<b>확률</b> 칸에 %를 넣으면 전체 개수를 유지한 채 그 등수의 개수가 맞춰지고, '+
      '남거나 모자란 만큼은 가장 개수가 많은 등수에서 조정됩니다. '+
      '뽑은 내역은 새로고침해도 유지되며, 행사가 끝나면 <b>재고 되돌리기</b>를 누르세요.</div>';
  },

  bindOptions:function(rootEl,o,save){
    if(!Array.isArray(o.cnt)  || o.cnt.length!==5)  o.cnt=DEF_CNT.slice();
    if(!Array.isArray(o.left) || o.left.length!==5) o.left=o.cnt.slice();

    var paint=function(){
      var total=sum(o.cnt), left=sum(o.left);
      rootEl.querySelector('#dwCfg').innerHTML=optRows(o);
      rootEl.querySelector('#dwSum').innerHTML=
        '총 뽑기권 <b>'+total+'</b>개 <span class="dim">(현재 남은 '+left+'개)</span>';
      bind();
    };
    var bind=function(){
      rootEl.querySelectorAll('#dwCfg input').forEach(function(inp){
        inp.addEventListener('change',function(e){
          var i=+e.target.dataset.i, k=e.target.dataset.k, v=parseFloat(e.target.value);
          if(!isFinite(v)||v<0) v=0;
          if(k==='cnt'){
            o.cnt[i]=Math.min(9999, Math.round(v));
          }else{
            /* 확률 입력 — 전체 개수를 유지한 채 해당 등수의 개수를 맞추고,
               차이는 '가장 개수가 많은 다른 등수'에서 더하거나 뺀다. */
            var total=sum(o.cnt); if(total<=0) total=1;
            var want=Math.round(total*Math.min(100,v)/100);
            var diff=want-o.cnt[i];
            o.cnt[i]=want;
            var guard=0;
            while(diff!==0 && guard++<200){
              var bi=-1, bv=-1;
              for(var j=0;j<5;j++){ if(j!==i && o.cnt[j]>bv){ bv=o.cnt[j]; bi=j; } }
              if(bi<0) break;
              if(diff>0){ var cut=Math.min(diff,o.cnt[bi]); if(!cut) break; o.cnt[bi]-=cut; diff-=cut; }
              else { o.cnt[bi]-=diff; diff=0; }
            }
          }
          for(var j2=0;j2<5;j2++) o.left[j2]=Math.min(o.left[j2]|0, o.cnt[j2]);
          save(); paint();
        });
      });
    };
    rootEl.querySelector('#dwRestock').addEventListener('click',function(){
      o.left=o.cnt.slice(); save(); paint();
      Core.toast && Core.toast('뽑기권을 전부 되돌렸습니다');
    });
    paint();
  },

  start:function(h){
    H=h; root=H.stage; busy=false;
    var o=conf();
    if(sum(o.cnt)<=0){ o.cnt=DEF_CNT.slice(); o.left=o.cnt.slice(); H.save(); }
    render();
    elAdmin = H.tool('<button class="btn sm ghost">🔒 현황·초기화</button>');
    elAdmin.addEventListener('click', openAdmin);
    H.setTip('태블릿을 세워두고 참가자가 직접 누르게 하세요');
  },
  onShow:function(){ if(root) syncTop(); },
  stop:function(){ H=null; root=null; elAdmin=null; busy=false; }
};

/* ── 공정성 검증 (개발용) ───────────────────────────────────────────
   콘솔에서 __drawAudit([1,1,1], 60000) 처럼 실행한다.
   재고를 전부 소진할 때까지 뽑았을 때 '나오는 순서'의 모든 경우가
   같은 확률로 나오는지 센다. 편차가 오차 범위면 균등하다. */
if(typeof window!=='undefined') window.__drawAudit=function(cnt,trials){
  cnt=cnt||[1,1,1,0,0]; trials=trials||60000;
  while(cnt.length<5) cnt.push(0);
  var total=cnt.reduce(function(a,b){return a+b;},0), seen={};
  for(var k=0;k<trials;k++){
    var left=cnt.slice(), seq=[];
    for(var d=0;d<total;d++){
      var t=left.reduce(function(a,b){return a+b;},0);
      var r=Core.rndInt(t), acc=0, pickI=4;
      for(var i=0;i<5;i++){ acc+=left[i]; if(r<acc){ pickI=i; break; } }
      left[pickI]--; seq.push(pickI+1);
    }
    var key=seq.join('');
    seen[key]=(seen[key]||0)+1;
  }
  var keys=Object.keys(seen), exp=trials/keys.length, worst=0;
  keys.forEach(function(k2){ worst=Math.max(worst, Math.abs(seen[k2]-exp)/exp*100); });
  return { 개수:cnt.slice(0,5), 시행:trials, 나온순서가짓수:keys.length,
           기대빈도:Math.round(exp), 최대편차:+worst.toFixed(2)+'%', 분포:seen };
};

if(typeof Core!=='undefined') Core.registerGame(GAME);
})();
