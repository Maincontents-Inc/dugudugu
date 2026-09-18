/* ============================================================================
   build-single.mjs — 게임 하나만 담은 단일 HTML 파일을 만든다.
   ----------------------------------------------------------------------------
     node tools/build-single.mjs ladder "사다리타기" "사다리타기.html"
   assets/ 의 style.css · core.js · game-<id>.js 를 그대로 index.html 에 인라인
   하므로, 공용 파일을 고친 뒤 이 스크립트만 다시 돌리면 단일 파일도 갱신된다.
   ========================================================================= */
import fs from 'fs';
import path from 'path';

const [id='ladder', appName='사다리타기', outName] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const gameFile = `assets/game-${id}.js`;
if (!fs.existsSync(path.join(root, gameFile))) {
  console.error(`게임 파일이 없습니다: ${gameFile}`);
  process.exit(1);
}

let html = read('index.html');
const css  = read('assets/style.css');
const core = read('assets/core.js');
const game = read(gameFile);

/* 1) 외부 참조를 인라인으로
   주의: replace 의 '치환 문자열'은 $$ · $& 같은 패턴을 해석해 버린다.
   ($$ 는 $ 하나로 치환 → core.js 의 const $$ 가 const $ 로 깨진다)
   그래서 삽입할 내용은 반드시 함수 형태로 넘긴다. */
const put = v => () => v;
html = html.replace('<link rel="stylesheet" href="assets/style.css">',
                    put('<style>\n' + css + '\n</style>'));
html = html.replace(/<script src="assets\/[^"]+"><\/script>\s*/g, '');
html = html.replace('<script>Core.boot();</script>', put(
  '<script>window.APP_NAME=' + JSON.stringify(appName) + ';</script>\n' +
  '<script>\n' + core + '\n</script>\n' +
  '<script>\n' + game + '\n</script>\n' +
  '<script>Core.boot();</script>'));

/* 2) 제목과 안내 문구를 이 게임 이름으로 */
html = html.replace('<title>두구두구</title>', put(`<title>${appName} · 두구두구</title>`));
html = html.replace('<h1>두구두구</h1>', put(`<h1>${appName}</h1>`));
html = html.replace('<p class="lead">팀 이름을 넣고 게임을 고르면 순서가 정해집니다</p>',
                    put('<p class="lead">팀 이름을 넣고 시작하면 순서가 정해집니다</p>'));
html = html.replace('<div class="kicker">공정한 랜덤 추첨</div>', put('<div class="kicker">두구두구</div>'));

const out = outName || `${appName}.html`;
fs.writeFileSync(path.join(root, out), html);
console.log(`${out} 생성 (${(Buffer.byteLength(html)/1024).toFixed(0)} KB)`);
