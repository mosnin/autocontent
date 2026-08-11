import { chromium } from "playwright";
const b = await chromium.launch({ executablePath:"/opt/pw-browsers/chromium", args:["--no-sandbox"] });
const snap = async (url, sel) => {
  const ctx = await b.newContext({ viewport:{width:1440,height:1200}, javaScriptEnabled:false });
  const p = await ctx.newPage(); await p.goto(url,{waitUntil:"load",timeout:120000});
  await p.evaluate(()=>document.fonts.ready).catch(()=>{}); await p.waitForTimeout(2000);
  const r = await p.evaluate((sel)=>{
    const root=document.querySelector(sel);
    const list=[...root.querySelectorAll("[data-framer-name]")].map(el=>{
      const r=el.getBoundingClientRect();
      return {n:el.getAttribute("data-framer-name"),x:Math.round(r.x),w:Math.round(r.width),h:Math.round(r.height)};
    });
    return {count:list.length, all:document.querySelectorAll(`${sel} *`).length,
            hidden:[...root.querySelectorAll("*")].filter(e=>getComputedStyle(e).opacity==="0").length, list};
  }, sel);
  await ctx.close(); return r;
};
const A=await snap("http://127.0.0.1:8123/index.html","#main");
const B=await snap("http://127.0.0.1:3000/opsra-port","#main");
await b.close();
console.log(`#main elements   original=${A.all}   port=${B.all}   delta=${B.all-A.all}`);
console.log(`named nodes      original=${A.count}  port=${B.count}  delta=${B.count-A.count}`);
console.log(`opacity:0 nodes  original=${A.hidden}    port=${B.hidden}`);
let geo=0, worst=[];
for(let i=0;i<Math.min(A.list.length,B.list.length);i++){
  const a=A.list[i],c=B.list[i];
  if(a.n!==c.n){console.log(`name drift at ${i}: ${a.n} vs ${c.n}`);break;}
  const d=Math.abs(a.x-c.x)+Math.abs(a.w-c.w)+Math.abs(a.h-c.h);
  if(d>1){geo++; worst.push({i,n:a.n.slice(0,40),d,o:`${a.x},${a.w}x${a.h}`,p:`${c.x},${c.w}x${c.h}`});}
}
console.log(`geometry mismatches (>1px): ${geo} of ${A.list.length}`);
worst.sort((x,y)=>y.d-x.d).slice(0,8).forEach(w=>console.log(`   [${w.i}] ${w.n}  orig ${w.o}  port ${w.p}`));
