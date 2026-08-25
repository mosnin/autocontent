import { chromium } from "playwright";
const OUT="/tmp/claude-0/-home-user-autocontent/0b678101-5c74-56af-85b5-284fca27af4e/scratchpad/shots";
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium",args:["--no-sandbox","--hide-scrollbars"]});
for (const [name,url] of [["fix-home","http://127.0.0.1:3000/"],["fix-preview","http://127.0.0.1:3000/preview/site"]]) {
  const ctx=await b.newContext({viewport:{width:1440,height:1000}});
  const p=await ctx.newPage();
  await p.goto(url,{waitUntil:"load",timeout:300000});
  await p.evaluate(()=>document.fonts.ready).catch(()=>{});
  await p.waitForTimeout(4000);
  await p.screenshot({path:`${OUT}/${name}.png`});
  const ff=await p.evaluate(()=>getComputedStyle(document.body).fontFamily);
  console.log(name,"| body font:",ff.slice(0,60));
  await ctx.close();
}
await b.close();
