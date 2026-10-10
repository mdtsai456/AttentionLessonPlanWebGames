// Run: npm --prefix tools/tgame-tests test -- [round|images|viewport|flow]
// Tests exercise real pages. Remote services and image loading/decoding failures are intercepted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const filter = process.argv[2] || '';
const server = http.createServer(async (req, res) => {
  try {
    const name = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!name.startsWith(root + path.sep)) throw new Error('outside root');
    const file = await fs.readFile(name);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.csv': 'text/csv', '.ttf': 'font/ttf' };
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream' });res.end(file);
  } catch { res.writeHead(404);res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failures = 0, count = 0;
async function test(name, fn) {
  if (filter && !name.includes(filter)) return;
  count++;
  try { await fn();console.log(`PASS ${name}`); }
  catch (e) { failures++;console.error(`FAIL ${name}: ${e.stack}`); }
}
async function gamePage(game, { stall = false, width = 1440, height = 810 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();const saves = [], errors = [], held = [];
  page.on('pageerror', e => errors.push(String(e)));page.on('dialog', d => d.accept());
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/auth/me')) {
      const second = (route.request().headers().authorization || '').includes('t2');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        role: 'student', expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), grade: 'G1', school: 'KMU',
        caseId: second ? 'S02' : 'S01', studentKey: second ? 'G1_S02' : 'G1_S01',
      }) });
    }
    if (route.request().method() === 'POST' && url.pathname.endsWith('/sessions')) {
      saves.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
    if (url.pathname.includes('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (stall && url.pathname.includes('/img/items/')) {
      await new Promise(resolve => held.push(resolve));return route.abort().catch(() => {});
    }
    return route.continue();
  });
  await page.addInitScript((mode) => {
    sessionStorage.setItem('user_role', 'student');
    sessionStorage.setItem('game_mode', mode);
    sessionStorage.setItem('token', 't1');
    sessionStorage.setItem('student1_token', 't1');
    sessionStorage.setItem('grade', 'G1');
    sessionStorage.setItem('student1_grade', 'G1');
    sessionStorage.setItem('caseId', 'S01');
    sessionStorage.setItem('student1_case', 'S01');
    sessionStorage.setItem('school', 'KMU');
    sessionStorage.setItem('student1_school', 'KMU');
    if (mode === 'double') {
      sessionStorage.setItem('student2_token', 't2');
      sessionStorage.setItem('student2_grade', 'G1');
      sessionStorage.setItem('student2_case', 'S02');
      sessionStorage.setItem('student2_school', 'KMU');
    }
    let seed=12345;Math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  }, game === 'TGame_double' ? 'double' : 'single');
  await page.clock.install();await page.clock.pauseAt(new Date());
  await page.goto(`${base}${process.env.TGAME_TEST_PATH || ""}/${game}/index.html`, { waitUntil: 'domcontentloaded' });
  // 先完成登入與遊戲腳本載入，再快轉假時鐘，避免誤觸驗證的五秒逾時。
  await page.waitForFunction(g => window.WebGameAuth?.active && (g === 'TGame_single'
    ? typeof state !== 'undefined' : typeof players !== 'undefined'), game);
  const snapshot = () => page.evaluate(g => {
    const s = g === 'TGame_single' ? state : session;const ps=g==='TGame_single'?[state]:[players.p1,players.p2];
    return { level:s.level,playing:s.playing,paused:!!s.paused,timerStarted:s.timerStarted,remaining:g==='TGame_single'?s.remaining:Math.max(0,Math.ceil(((s.paused?s.pausedRemainingMs:s.levelDeadline-Date.now()))/1000)),players:ps.map(p=>({busy:p.busy,seq:p.questionSeq,score:p.score,answers:p.answers.map(a=>({...a}))})) };
  }, game);
  const advance = async ms => { await page.clock.runFor(ms);await new Promise(r=>setTimeout(r,20)); };
  const ready = async () => {
    for(let i=0;i<100;i++){
      const yes=await page.evaluate(g=>{
        const s=g==='TGame_single'?(typeof state==='undefined'?null:state):(typeof session==='undefined'?null:session);
        if(!s)return false;
        const ps=g==='TGame_single'?[state]:[players.p1,players.p2];
        return s.playing&&ps.every(p=>p.ready)&&[...document.querySelectorAll('.item')].every(i=>i.getAttribute('src')&&i.complete&&i.naturalWidth);
      },game);
      if(yes)return;await advance(100);
    }
    throw new Error(`題目未完成準備 ${page.url()} ${errors.join(' | ')}`);
  };
  const answer = async ({ repeat=false }={}) => {
    const keys = await page.evaluate(g=>g==='TGame_single'?[state.currentQuestion.correct==='left'?'a':'d']:[players.p1.currentQuestion.correct==='left'?'a':'d',players.p2.currentQuestion.correct==='left'?'ArrowLeft':'ArrowRight'],game);
    await page.evaluate(({keys,repeat})=>keys.forEach(key=>document.dispatchEvent(new KeyboardEvent('keydown',{key,repeat,bubbles:true}))),{keys,repeat});
  };
  const resize=async(size)=>{await page.setViewportSize(size);await page.evaluate(()=>window.dispatchEvent(new Event('resize')));};
  const close=async()=>{held.forEach(resolve=>resolve());await context.close();assert.deepEqual(errors,[], '頁面不得發生 JS 錯誤');};
  return { page,context,saves,errors,ready,answer,snapshot,advance,resize,close };
}
for(const game of ['TGame_single','TGame_double']) {
  await test(`round ${game} 舊動畫不能跳題或解除新關作答鎖`, async()=>{
    const t=await gamePage(game);try{
      await t.ready();await t.answer();await t.advance(200);await t.page.evaluate(()=>endLevel());await t.page.click('.shared-stage-clear-btn');await t.ready();
      await t.answer();await t.advance(880);await t.answer();await t.advance(2600);
      const s=await t.snapshot();assert.equal(s.level,2);for(const p of s.players){assert.equal(p.answers.length,2);assert.equal(p.seq,1);assert.equal(p.score,2);}
    }finally{await t.close();}
  });
  await test(`round ${game} 到期後即使 tick 未執行也不計分`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();if(game==='TGame_double'){await t.answer();await t.advance(2600);}
      const before=await t.snapshot();await t.page.clock.setSystemTime(new Date(await t.page.evaluate(()=>Date.now()+61000)));await t.answer();
      const after=await t.snapshot();assert.deepEqual(after.players.map(p=>p.answers.length),before.players.map(p=>p.answers.length));assert.equal(after.playing,false);
    }finally{await t.close();}
  });
  await test(`round ${game} 長按不得帶入下一題`,async()=>{
    const t=await gamePage(game);try{await t.ready();await t.answer();await t.advance(2600);await t.answer({repeat:true});assert.ok((await t.snapshot()).players.every(p=>p.answers.length===1));}finally{await t.close();}
  });
}
for(const game of ['TGame_single','TGame_double']){
  await test(`images ${game} 下載完成但解碼逾時仍須轉文字卡`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();await t.page.evaluate(()=>{
        const decode=HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode=function(){
          return this.classList.contains('item')&&!this.src.startsWith('data:')?new Promise(()=>{}):decode.call(this);
        };
      });
      await t.answer();await t.advance(2600);await t.ready();
      assert.ok(await t.page.evaluate(()=>[...document.querySelectorAll('.item')].every(i=>i.src.startsWith('data:image/svg+xml')&&i.complete&&i.naturalWidth>0)));
      await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.answers.length===2));
    }finally{await t.close();}
  });
  await test(`images ${game} 預載逾時首題以可見文字卡作答`,async()=>{
    const t=await gamePage(game,{stall:true});try{
      await t.advance(8100);await t.ready();
      const images=await t.page.evaluate(()=>[...document.querySelectorAll('.item')].map(i=>({src:i.getAttribute('src'),width:i.naturalWidth,opacity:getComputedStyle(i).opacity})));
      assert.ok(images.every(i=>i.src.startsWith('data:image/svg+xml')&&i.width>0&&i.opacity!=='0'));
      await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.answers.length===1));
    }finally{await t.close();}
  });
  await test(`images ${game} 換題逾時不能顯示空白或接受準備中的按鍵`,async()=>{
    const t=await gamePage(game);const held=[];try{
      await t.ready();await t.context.route('**/img/items/late_*.png',async route=>{await new Promise(r=>held.push(r));await route.abort().catch(()=>{});});
      await t.page.evaluate(()=>{stageRules[0]={prompt:'測試題目',correct:['late_correct'],wrong:['late_wrong']};});
      await t.answer();await t.advance(1800);await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.answers.length===1));await t.advance(650);
      assert.ok(await t.page.evaluate(()=>[...document.querySelectorAll('.item')].every(i=>i.getAttribute('src').startsWith('data:image/svg+xml')&&i.complete&&i.naturalWidth>0)));
      await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.answers.length===2));
    }finally{held.forEach(r=>r());await t.close();}
  });
}
await test('viewport TGame_double 所有支援寬度的 HUD／回饋／提示／進度條不遮擋',async()=>{
  const t=await gamePage('TGame_double');try{
    await t.ready();await t.page.evaluate(()=>document.fonts.ready);await t.answer();
    for(const width of [700,721,768,820,900,1024,1440])for(const height of [500,620]){
      await t.resize({width,height});
      const clashes=await t.page.evaluate(()=>{const found=[];for(const lane of document.querySelectorAll('.lane')){const sels=['.hud-score','.round','.prompt','.feedback','.progress-panel'];const rects=sels.map(s=>lane.querySelector(s).getBoundingClientRect());for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)found.push([sels[i],sels[j]]);}const lr=lane.getBoundingClientRect();rects.forEach((r,i)=>{if(r.left<lr.left||r.right>lr.right)found.push(['clipped',sels[i]]);});}return found;});
      assert.deepEqual(clashes,[],`${width}×${height} 元件遮擋`);
    }
  }finally{await t.close();}
});
for(const game of ['TGame_single','TGame_double']){
  await test(`viewport ${game} 恢復準備中再次縮小必須重新按繼續`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();await t.advance(5000);await t.resize({width:320,height:400});await t.advance(1000);
      const before=await t.snapshot();await t.resize({width:900,height:620});
      await t.page.evaluate(()=>{
        const decode=HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode=async function(){
          if(this.classList.contains('item'))await new Promise(r=>setTimeout(r,250));
          return decode.call(this);
        };
      });
      await t.page.getByRole('button',{name:'繼續',exact:true}).click();await t.resize({width:320,height:400});await t.advance(50);
      await t.resize({width:900,height:620});for(let i=0;i<10;i++)await t.advance(100);
      assert.equal((await t.snapshot()).paused,true);assert.equal((await t.snapshot()).remaining,before.remaining);
      assert.ok(await t.page.getByRole('dialog',{name:'遊戲暫停',exact:true}).isVisible());await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.answers.length===0));
      await t.page.getByRole('button',{name:'繼續',exact:true}).click();
      for(let i=0;i<20&&(await t.snapshot()).paused;i++)await t.advance(50);
      assert.equal((await t.snapshot()).paused,false);
      await t.advance(500);await t.answer();const samples=await t.page.evaluate(g=>(g==='TGame_single'?[state]:[players.p1,players.p2]).map(p=>p.reactionSamples[0]),game);
      assert.ok(samples.every(ms=>ms>=5500&&ms<=5800),`重新恢復有效反應時間：${samples}`);
    }finally{await t.close();}
  });
  await test(`viewport ${game} 錯答重試保留思考時間，多次暫停仍累計有效時間`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();await t.page.evaluate(g=>{
        const ps=g==='TGame_single'?[state]:[players.p1,players.p2];
        ps.forEach((p,i)=>{
          const left=p.currentQuestion.correct!=='left';
          const key=i===0?(left?'a':'d'):(left?'ArrowLeft':'ArrowRight');
          document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
        });
      },game);
      await t.advance(1080);await t.advance(5000);await t.resize({width:320,height:400});await t.advance(20000);
      await t.resize({width:900,height:620});await t.page.getByRole('button',{name:'繼續',exact:true}).click();await t.advance(1000);
      await t.resize({width:320,height:400});await t.advance(20000);await t.resize({width:900,height:620});
      await t.page.getByRole('button',{name:'繼續',exact:true}).click();await t.advance(500);await t.answer();
      const samples=await t.page.evaluate(g=>(g==='TGame_single'?[state]:[players.p1,players.p2]).map(p=>p.reactionSamples[1]),game);
      assert.ok(samples.every(ms=>ms>=6400&&ms<=6700),`重試有效反應時間應約 6500 ms：${samples}`);
    }finally{await t.close();}
  });
  await test(`viewport ${game} 同題保留暫停前思考時間並排除暫停時間`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();await t.advance(5000);await t.resize({width:320,height:400});await t.advance(20000);
      await t.resize({width:900,height:620});await t.advance(5000);await t.page.getByRole('button',{name:'繼續',exact:true}).click();
      await t.advance(1000);await t.answer();
      const samples=await t.page.evaluate(g=>(g==='TGame_single'?[state]:[players.p1,players.p2]).map(p=>p.reactionSamples[0]),game);
      assert.ok(samples.every(ms=>ms>=5900&&ms<=6200),`有效反應時間應約 6000 ms：${samples}`);
    }finally{await t.close();}
  });
  await test(`viewport ${game} 縮小時保留時間與分數、恢復尺寸不能自動繼續`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();await t.answer();await t.advance(200);await t.resize({width:320,height:400});
      const before=await t.snapshot();assert.equal(before.paused,true);await t.answer();await t.advance(20000);const after=await t.snapshot();assert.equal(after.remaining,before.remaining);assert.deepEqual(after.players.map(p=>p.score),before.players.map(p=>p.score));
      await t.resize({width:900,height:620});assert.equal((await t.snapshot()).paused,true);await t.advance(5000);assert.equal((await t.snapshot()).remaining,before.remaining);
      await t.page.getByRole('button',{name:'繼續',exact:true}).click();await t.advance(300);await t.answer();await t.advance(2600);
      const resumed=await t.snapshot();assert.equal(resumed.paused,false);assert.ok(resumed.players.every(p=>p.answers.length===2&&p.seq===2&&p.score===2));assert.ok(resumed.remaining<before.remaining);
    }finally{await t.close();}
  });
}
await test('viewport TGame_double 未按鍵開局且直向時暫停，恢復後仍須首次作答才倒數',async()=>{
  const t=await gamePage('TGame_double',{width:768,height:1024});try{
    await t.ready();assert.equal((await t.snapshot()).paused,true);await t.advance(20000);await t.resize({width:1024,height:768});await t.page.getByRole('button',{name:'繼續',exact:true}).click();
    assert.equal((await t.snapshot()).timerStarted,false);await t.answer();assert.equal((await t.snapshot()).timerStarted,true);
  }finally{await t.close();}
});
for(const game of ['TGame_single','TGame_double']){
  await test(`viewport ${game} near／turn／decode／arrive 暫停均只換一題`,async()=>{
    for(const at of [200,1200,1750,1900]){
      const t=await gamePage(game);try{
        await t.ready();await t.answer();await t.advance(at);await t.resize({width:320,height:400});await t.advance(2500);
        const paused=await t.snapshot();assert.ok(paused.players.every(p=>p.seq===1&&p.answers.length===1&&p.score===1),`暫停時點 ${at}`);
        await t.resize({width:900,height:620});await t.page.getByRole('button',{name:'繼續',exact:true}).click();await t.advance(300);await t.answer();await t.advance(2600);
        assert.ok((await t.snapshot()).players.every(p=>p.seq===2&&p.answers.length===2&&p.score===2),`恢復時點 ${at}`);
      }finally{await t.close();}
    }
  });
  await test(`images ${game} PNG 404 仍顯示同物品名稱文字卡`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();await t.context.route('**/img/items/missing_*.png',r=>r.fulfill({status:404,body:''}));
      await t.page.evaluate(()=>{stageRules[0]={prompt:'遺失圖片',correct:['missing_correct'],wrong:['missing_wrong']};});await t.answer();await t.advance(2600);
      const cards=await t.page.evaluate(()=>[...document.querySelectorAll('.item')].map(i=>({src:i.getAttribute('src'),alt:i.alt,width:i.naturalWidth})));
      assert.ok(cards.every(i=>i.src.startsWith('data:image/svg+xml')&&i.width>0&&['missing_correct','missing_wrong'].includes(i.alt)));await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.score===2));
    }finally{await t.close();}
  });
  await test(`flow ${game} 中場離開只存已完成三關`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();for(let level=1;level<=3;level++){await t.answer();await t.advance(60100);if(level<3){await t.page.click('.shared-stage-clear-btn');await t.ready();}}
      await t.page.click(game==='TGame_single'?'#btn-lobby':'#mid-lobby');await t.page.waitForURL('**/Select/index.html');assert.equal(t.saves.length,game==='TGame_single'?1:2);assert.ok(t.saves.every(s=>s.data.stats.find(x=>x.apiname==='TGame_stage').value===3));
    }finally{await t.close();}
  });
  await test(`flow ${game} 六關中場結算重玩與存檔`,async()=>{
    const t=await gamePage(game);try{
      await t.ready();for(let level=1;level<=6;level++){
        await t.answer();await t.advance(60100);assert.equal((await t.snapshot()).playing,false);
        if(level===3)await t.page.click(game==='TGame_single'?'#btn-next-stage':'#mid-continue');else if(level<6)await t.page.click('.shared-stage-clear-btn');if(level<6)await t.ready();
      }
      assert.ok(await t.page.locator('#result').isVisible());for(const save of t.saves)assert.equal(save.data.stats.find(x=>x.apiname==='TGame_stage').value,6);assert.equal(t.saves.length,game==='TGame_single'?1:2);
      await t.page.click('#replay-btn');await t.ready();const s=await t.snapshot();assert.equal(s.level,1);assert.ok(s.players.every(p=>p.score===0&&p.answers.length===0));
    }finally{await t.close();}
  });
}
await browser.close();await new Promise(resolve=>server.close(resolve));
console.log(`${count-failures}/${count} passed`);process.exitCode=failures?1:0;
