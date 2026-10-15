// 執行：npm --prefix tools/tgame-tests test -- [round|images|viewport|flow]
// 測試操作實際頁面，並攔截遠端服務請求及圖片載入、解碼失敗的情況。
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
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function test(name, fn) {
  if (filter && !name.includes(filter)) return;
  count++;
  try { await fn();console.log(`PASS ${name}`); }
  catch (e) { failures++;console.error(`FAIL ${name}: ${e.stack}`); }
}
async function gamePage(game, { stall = false, width = 1440, height = 810, noCsv = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();const saves = [], errors = [], held = [], dialogs = [];
  page.on('pageerror', e => errors.push(String(e)));
  // 離開改在頁面內確認；任何瀏覽器原生對話框都記下來，測試會檢查應為空。
  page.on('dialog', d => { dialogs.push(d.type()); void d.accept(); });
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
    if (noCsv && url.pathname.endsWith('.csv')) return route.fulfill({ status: 404, body: '' });
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
  // 安裝後假時鐘會跟著真實時間走，偶爾已超過 Node 端的 new Date()；暫停點往後留 1 秒，避免「Cannot fast-forward to the past」。
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now() + 1000));
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
  // 打完前三關停在中場休息
  const toMidBreak = async () => {
    await ready();for(let level=1;level<=3;level++){await answer();await advance(60100);if(level<3){await page.click('.shared-stage-clear-btn');await ready();}}
  };
  // 雙人要有人按鍵才開始倒數，按鍵前的等待不算反應時間；量暫停扣除時先開始計時
  const startTimer = async () => { if (game === 'TGame_double') await page.evaluate(() => startLevelTimer()); };
  return { page,context,saves,errors,dialogs,ready,answer,snapshot,advance,resize,close,toMidBreak,startTimer };
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
      await t.ready();await t.startTimer();await t.advance(5000);await t.resize({width:320,height:400});await t.advance(1000);
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
      await t.ready();await t.startTimer();await t.page.evaluate(g=>{
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
      await t.ready();await t.startTimer();await t.advance(5000);await t.resize({width:320,height:400});await t.advance(20000);
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
      // 中場先送第 3 關，打完再用同一個 submissionId 送第 6 關（後端更新同一列）。
      const n=game==='TGame_single'?1:2;
      assert.ok(await t.page.locator('#result').isVisible());assert.deepEqual(t.saves.map(s=>s.data.stats.find(x=>x.apiname==='TGame_stage').value),[...Array(n).fill(3),...Array(n).fill(6)]);
      assert.deepEqual(t.saves.slice(n).map(s=>s.data.submissionId),t.saves.slice(0,n).map(s=>s.data.submissionId),'第 6 關要沿用中場的 submissionId');
      await t.page.click('#replay-btn');await t.ready();const s=await t.snapshot();assert.equal(s.level,1);assert.ok(s.players.every(p=>p.score===0&&p.answers.length===0));
    }finally{await t.close();}
  });
}
// 等待頁面內非同步動作（例如存檔請求）完成；假時鐘一併往前推。
async function until(t,check,message){for(let i=0;i<100;i++){if(await check())return;await t.advance(50);}throw new Error(message);}
for(const game of ['TGame_single','TGame_double']){
  const lobby=game==='TGame_single'?'#btn-lobby':'#mid-lobby';
  const next=game==='TGame_single'?'#btn-next-stage':'#mid-continue';
  const saveCount=game==='TGame_single'?1:2;
  // 離開先在頁面內確認（shared/leave-confirm.js），不再跳瀏覽器的離開詢問。
  const confirmBox=t=>t.page.getByRole('dialog',{name:'確定要離開嗎？'});
  const stay=t=>confirmBox(t).getByRole('button',{name:'繼續遊戲',exact:true});
  const go=t=>confirmBox(t).getByRole('button',{name:'離開',exact:true});
  const stages=t=>t.saves.map(s=>s.data.stats.find(x=>x.apiname==='TGame_stage').value);
  const playToEnd=async t=>{for(let level=4;level<=6;level++){await t.answer();await t.advance(60100);if(level<6){await t.page.click('.shared-stage-clear-btn');await t.ready();}}};
  await test(`leave ${game} 第 4 關按離開再取消不多存，打完六關只多存第 6 關`,async()=>{
    const t=await gamePage(game);try{
      await t.toMidBreak();await t.page.click(next);await t.ready();await t.advance(200);assert.deepEqual(stages(t),Array(saveCount).fill(3),'到中場應先送第 3 關');
      await t.page.click('#leave-btn');await confirmBox(t).waitFor({state:'visible',timeout:2000});
      await stay(t).click();await t.advance(200);
      assert.equal(await confirmBox(t).count(),0,'按繼續遊戲後確認框應關閉');
      assert.equal(t.saves.length,saveCount,'取消離開不得多送成績');
      assert.ok(t.page.url().includes(`/${game}/`),'取消後應留在遊戲頁');
      assert.equal(await t.page.locator('#leave-btn').isEnabled(),true,'取消後「離開」應可再按');
      await playToEnd(t);await until(t,()=>t.saves.length===2*saveCount,'六關結束應存檔');await t.advance(200);
      assert.deepEqual(stages(t),[...Array(saveCount).fill(3),...Array(saveCount).fill(6)],'取消過的離開不得多留一筆第 3 關成績');
      assert.deepEqual(t.dialogs,[],'不得出現瀏覽器原生對話框');
    }finally{await t.close();}
  });
  await test(`leave ${game} 遊玩中取消離開照常繼續，確定離開才存已完成關卡`,async()=>{
    const t=await gamePage(game);try{
      await t.toMidBreak();await t.page.click(next);await t.ready();await t.startTimer();
      await t.page.click('#leave-btn');await confirmBox(t).waitFor({state:'visible',timeout:2000});
      assert.equal(await t.page.evaluate(()=>window.WebGameRuntime.paused),true,'確認框開著時遊戲應暫停');
      await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.score===3),'確認框開著時按鍵不得作答');
      await stay(t).click();await t.advance(200);
      assert.deepEqual(stages(t),Array(saveCount).fill(3),'只有中場先送的第 3 關，取消離開不得多送');
      assert.equal(await t.page.evaluate(()=>window.WebGameRuntime.paused),false,'取消後遊戲應恢復');
      const before=await t.snapshot();assert.equal(before.playing,true);assert.equal(before.level,4);
      await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.score===4),'取消後應可繼續作答');
      await t.page.click('#leave-btn');await confirmBox(t).waitFor({state:'visible',timeout:2000});
      await Promise.all([t.page.waitForURL('**/Select/index.html',{timeout:5000}),go(t).click()]);
      assert.deepEqual(stages(t),Array(saveCount).fill(3),'確定離開應存已完成的前三關');
      assert.deepEqual(t.dialogs,[],'不得出現瀏覽器原生對話框');
    }finally{await t.close();}
  });
  await test(`leave ${game} 中場回大廳不詢問，直接存檔離開`,async()=>{
    const t=await gamePage(game);try{
      await t.toMidBreak();
      // 若中場回大廳也要確認，這裡回答取消，導頁就不會發生。
      await t.page.evaluate(()=>{window.confirmLeave=async()=>false;});
      await Promise.all([t.page.waitForURL('**/Select/index.html',{timeout:5000}),t.page.click(lobby)]);
      assert.deepEqual(stages(t),Array(saveCount).fill(3));
      assert.deepEqual(t.dialogs,[],'不得出現瀏覽器原生對話框');
    }finally{await t.close();}
  });
  await test(`viewport ${game} 暫停畫面離開先確認：取消仍停在暫停畫面，確定才存檔離開`,async()=>{
    const t=await gamePage(game);try{
      await t.toMidBreak();await t.page.click(next);await t.ready();await t.answer();await t.resize({width:320,height:400});
      const pause=t.page.getByRole('dialog',{name:'遊戲暫停',exact:true});
      const leave=pause.getByRole('button',{name:'離開',exact:true});
      await leave.click();await confirmBox(t).waitFor({state:'visible',timeout:2000});
      await stay(t).click();await t.advance(200);
      assert.deepEqual(stages(t),Array(saveCount).fill(3),'只有中場先送的第 3 關，取消離開不得多送');
      assert.ok(t.page.url().includes(`/${game}/`),'取消後應留在遊戲頁');
      assert.ok(await pause.isVisible(),'取消後仍應停在暫停畫面');assert.equal((await t.snapshot()).paused,true);
      assert.equal(await leave.isEnabled(),true,'取消離開後「離開」不得卡在停用');
      await leave.click();await confirmBox(t).waitFor({state:'visible',timeout:2000});
      await Promise.all([t.page.waitForURL('**/Select/index.html',{timeout:5000}),go(t).click()]);
      assert.deepEqual(stages(t),Array(saveCount).fill(3),'確定離開應存已完成的前三關');
      assert.deepEqual(t.dialogs,[],'不得出現瀏覽器原生對話框');
    }finally{await t.close();}
  });
  // 確定離開後遊戲維持暫停到導頁（review R3）：存檔慢時第 6 關倒數不能跑完、不能作答，不能多送第 6 關成績。
  await test(`leave ${game} 確定離開時中場的第 3 關還沒送完：計時凍結、不能作答，送完才導頁`,async()=>{
    const t=await gamePage(game);const gate=[];const sent=[];try{
      // 存檔請求卡住，直到斷言完成才回覆（模擬很慢的網路）；中場先送的第 3 關也一直卡著。
      await t.context.route('**/sessions',async route=>{
        if(route.request().method()!=='POST')return route.fallback();
        sent.push(JSON.parse(route.request().postData()||'{}'));await new Promise(r=>gate.push(r));
        await route.fulfill({status:201,contentType:'application/json',body:'{}'}).catch(()=>{});
      });
      await t.toMidBreak();await t.page.click(next);await t.ready();
      for(let level=4;level<=5;level++){await t.answer();await t.advance(60100);await t.page.click('.shared-stage-clear-btn');await t.ready();}
      await t.startTimer();await t.answer();await t.advance(2600);
      const clock=()=>t.page.evaluate(g=>{const s=g==='TGame_single'?state:session;return {level:s.level,playing:s.playing,leftMs:s.levelDeadline-window.WebGameRuntime.now()};},game);
      const before=await clock();const scores=(await t.snapshot()).players.map(p=>p.score);
      await t.page.click('#leave-btn');await confirmBox(t).waitFor({state:'visible',timeout:2000});await go(t).click();
      await until(t,()=>sent.length===saveCount,'中場應已送出第 3 關檢查點');
      assert.equal(await t.page.evaluate(()=>window.WebGameRuntime.paused),true,'存檔期間遊戲應維持暫停');
      await t.advance(61000);
      const during=await clock();
      assert.equal(during.level,6);assert.equal(during.playing,true,'存檔期間第 6 關不得因倒數結束');assert.equal(during.leftMs,before.leftMs,'存檔期間倒數應凍結');
      assert.equal(await t.page.locator('#result').isVisible(),false,'存檔期間不得進入結算');
      await t.answer();await t.advance(2600);assert.deepEqual((await t.snapshot()).players.map(p=>p.score),scores,'存檔期間按鍵不得作答');
      assert.equal(sent.length,saveCount,'存檔期間不得多送成績');
      await Promise.all([t.page.waitForURL('**/Select/index.html',{timeout:5000}),Promise.resolve().then(()=>gate.forEach(r=>r()))]);
      assert.deepEqual(sent.map(s=>s.data.stats.find(x=>x.apiname==='TGame_stage').value),Array(saveCount).fill(3),'只送已完成的第 3 關');
      assert.equal(t.saves.length,0,'不得有其他成績送出');
      assert.deepEqual(t.dialogs,[],'不得出現瀏覽器原生對話框');
    }finally{gate.forEach(r=>r());await t.close();}
  });
  // 到中場自動送的第 3 關失敗時，第 4 關按離開要用同一筆（同一個 submissionId）重送。
  await test(`leave ${game} 中場自動送第 3 關失敗，第 4 關離開時用同一筆重送`,async()=>{
    const t=await gamePage(game);const failed=[];try{
      await t.context.route('**/sessions',async route=>{
        if(route.request().method()!=='POST')return route.fallback();
        const body=JSON.parse(route.request().postData()||'{}');
        if(!failed.some(f=>f.data.caseId===body.data.caseId)){failed.push(body);return route.fulfill({status:500,contentType:'application/json',body:'{}'});}
        return route.fallback();
      });
      await t.toMidBreak();await until(t,()=>failed.length===saveCount,'中場應自動送第 3 關');
      assert.equal(t.saves.length,0,'中場那次失敗了，還沒有存好的成績');
      await t.page.click(next);await t.ready();await t.startTimer();
      await t.page.click('#leave-btn');await confirmBox(t).waitFor({state:'visible',timeout:2000});
      await Promise.all([t.page.waitForURL('**/Select/index.html',{timeout:5000}),go(t).click()]);
      assert.deepEqual(stages(t),Array(saveCount).fill(3),'離開時重送第 3 關');
      for(const save of t.saves){
        const original=failed.find(f=>f.data.caseId===save.data.caseId);
        assert.equal(save.data.submissionId,original.data.submissionId,'重送沿用同一個 submissionId');
      }
      assert.deepEqual(t.dialogs,[],'不得出現瀏覽器原生對話框');
    }finally{await t.close();}
  });
  await test(`leave ${game} 確定離開後流程出錯留在頁面時遊戲恢復`,async()=>{
    const t=await gamePage(game);try{
      await t.toMidBreak();await t.page.click(next);await t.ready();await t.startTimer();
      await t.page.evaluate(()=>{window.leaveTo=()=>{throw new Error('導頁失敗');};});
      await t.page.click('#leave-btn');await confirmBox(t).waitFor({state:'visible',timeout:2000});await go(t).click();
      await until(t,()=>t.saves.length===saveCount,'確定離開應送出第 3 關檢查點');await t.advance(200);
      assert.equal(await t.page.evaluate(()=>window.WebGameRuntime.paused),false,'沒有導頁時遊戲應恢復');
      assert.equal(await t.page.locator('#leave-btn').isEnabled(),true);
      await t.answer();assert.ok((await t.snapshot()).players.every(p=>p.score===4),'恢復後應可繼續作答');
    }finally{await t.close();}
  });
  await test(`images ${game} 讀不到 CSV 時預設第 1 關不會出現魚`,async()=>{
    const t=await gamePage(game,{noCsv:true});try{
      await t.ready();
      const r=await t.page.evaluate(()=>{const seen=new Set();for(let i=0;i<500;i++){const q=makeQuestion(1,i);seen.add(q.leftItem);seen.add(q.rightItem);}return {usingDefault:stageRules===DEFAULT_STAGE_RULES,seen:[...seen],preload:levelItemIds(1)};});
      assert.ok(r.usingDefault,'應使用預設題目');
      assert.ok(!r.seen.includes('fish'),`「可以吃的食物」不得以魚當錯誤選項：${r.seen}`);assert.ok(!r.preload.includes('fish'));
    }finally{await t.close();}
  });
}
await test('round TGame_double 按鍵開始前的等待不計入反應時間',async()=>{
  const t=await gamePage('TGame_double');try{
    await t.ready();await t.advance(30000);
    await t.page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:players.p1.currentQuestion.correct==='left'?'a':'d',bubbles:true})));
    await t.advance(3000);
    await t.page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:players.p2.currentQuestion.correct==='left'?'ArrowLeft':'ArrowRight',bubbles:true})));
    const [p1,p2]=await t.page.evaluate(()=>[players.p1.reactionSamples.slice(),players.p2.reactionSamples.slice()]);
    assert.ok([...p1,...p2].every(ms=>ms<30000),`開始前的等待被算進反應時間：${p1} / ${p2}`);
    assert.equal(p2.length,1);assert.ok(p2[0]>=2900&&p2[0]<=3100,`玩家二應從開始計時起算約 3000 ms：${p2}`);
    assert.deepEqual(p1,[],'按鍵開始的那一下沒有可量的反應時間，不列入平均');
    await t.advance(2600);await t.advance(1000);await t.answer();
    const after=await t.page.evaluate(()=>[players.p1.reactionSamples.slice(),players.p2.reactionSamples.slice()]);
    assert.equal(after[0].length,1);assert.ok(after.flat().every(ms=>ms<5000),`之後的題目照常計時：${after}`);
  }finally{await t.close();}
});
await test('flow TGame_double 兩位玩家成績共用同一個 pairId，重玩換新',async()=>{
  const t=await gamePage('TGame_double');try{
    await t.toMidBreak();await t.page.click('#mid-continue');await t.ready();
    for(let level=4;level<=6;level++){await t.answer();await t.advance(60100);if(level<6){await t.page.click('.shared-stage-clear-btn');await t.ready();}}
    // 中場兩筆第 3 關＋六關結束兩筆第 6 關，都是同一局的 pairId。
    await until(t,()=>t.saves.length===4,'六關結束應再存兩筆');
    const first=t.saves.map(s=>s.data.pairId);
    assert.match(first[0],UUID_V4,`pairId 應為 UUID v4：${first[0]}`);assert.ok(first.every(id=>id===first[0]));
    const firstPlay=t.saves[0].data.submissionId;
    await t.page.click('#replay-btn');await t.toMidBreak();
    await Promise.all([t.page.waitForURL('**/Select/index.html',{timeout:5000}),t.page.click('#mid-lobby')]);
    const second=t.saves.slice(4).map(s=>s.data.pairId);
    assert.equal(second.length,2);assert.equal(second[0],second[1]);assert.notEqual(second[0],first[0],'重玩應換新的 pairId');
    assert.notEqual(t.saves[4].data.submissionId,firstPlay,'重玩應換新的 submissionId，不能蓋掉上一局');
  }finally{await t.close();}
});
// 區網 http 網址沒有 crypto.randomUUID：pairId 仍須是用 getRandomValues 產生的 UUID v4，不得退回 Math.random（review R10）。
await test('flow TGame_double 沒有 randomUUID 時 pairId 仍是安全亂數 UUID v4',async()=>{
  const t=await gamePage('TGame_double');try{
    await t.ready();
    const ids=await t.page.evaluate(()=>{
      Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});
      const random=Math.random;Math.random=()=>0;
      try{startGame();const a=session.pairId;startGame();return [a,session.pairId];}finally{Math.random=random;}
    });
    for(const id of ids)assert.match(id,UUID_V4,`pairId 應為 UUID v4：${id}`);
    assert.notEqual(ids[0],ids[1],'每局 pairId 應不同');
    assert.equal(await t.page.evaluate(()=>typeof window.createPairId),'undefined','不應保留本地 UUID 產生器');
  }finally{await t.close();}
});
await browser.close();await new Promise(resolve=>server.close(resolve));
console.log(`${count-failures}/${count} passed`);process.exitCode=failures?1:0;
