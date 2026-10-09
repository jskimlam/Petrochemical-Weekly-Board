#!/usr/bin/env node
'use strict';
// G1 only. PASS here does not imply GAS/browser/AS validation.
const ORDER=['WTI','Ethylene','Propylene','Benzene','SM','BD','AN','BPA','MMA','ABS','PC','EPS','PS','PBR','유럽 SM','미국 SM','유럽 BD','미국 BD'];
const num=x=>{const m=String(x??'').replace(/,/g,'').match(/[-+]?(?:\d+\.?\d*|\.\d+)/);return m?Number(m[0]):NaN};
const sign=x=>x>1e-9?'상승':x< -1e-9?'하락':'보합';
function audit(snapshot){
 const wk=snapshot.week_end||snapshot.week,rows=snapshot.rows||[],problems=[];
 const bad=(n,m)=>problems.push(n+': '+m);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(wk||''))bad('GLOBAL','week_end 오류');
 if(rows.length!==18)bad('GLOBAL','18개 품목 아님: '+rows.length);
 const seen=new Set();
 rows.forEach((r,i)=>{
  const x=Array.isArray(r)?{record_id:r[0],week_end:r[1],item:r[2],assessment_date:r[4],benchmark:r[5],current_price:r[6],previous_price:r[7],change_abs:r[9],change_pct:r[10],direction:r[11],price_text:r[12],commentary:r[13],raw_brief:r[18]}:r;
  const n=String(x.item||'').trim();
  if(n!==ORDER[i])bad(n||'#'+i,'품목 순서: '+ORDER[i]+' 필요');
  if(seen.has(n))bad(n,'중복 품목');seen.add(n);
  if(x.week_end!==wk||x.record_id!==wk+'__'+n)bad(n,'주차·ID 불일치');
  if(!x.benchmark)bad(n,'benchmark 누락');
  const c=num(x.current_price),p=num(x.previous_price),d=num(x.change_abs),pct=num(x.change_pct);
  if(![c,p,d,pct].every(Number.isFinite)||p===0){bad(n,'가격 숫자 누락 또는 전주 0');return}
  const delta=c-p,dir=sign(delta),derivedPct=Math.round((delta/p*100+Math.sign(delta)*Number.EPSILON)*100)/100;
  if(Math.abs(delta-d)>0.011)bad(n,'변동액 '+d+' != '+delta.toFixed(4));
  if(Math.abs(pct-derivedPct)>0.011)bad(n,'변동률 '+pct+' != '+derivedPct);
  if(x.direction!==dir)bad(n,'가격 방향 '+x.direction+' != '+dir+' (변동 '+delta+')');
  const textDir=(String(x.price_text||'').match(/,\s*(상승|하락|보합)\)\s*$/)||[])[1];
  if(textDir!==dir)bad(n,'가격 문구 방향 '+textDir+' != '+dir);
  const brief=String(x.raw_brief||'');
  const rawPrice=(brief.match(/^가격\s*\n+([^\n]+)/m)||[])[1]||'';
  if((rawPrice.match(/,\s*(상승|하락|보합)\)\s*$/)||[])[1]!==dir)bad(n,'raw_brief 가격 방향 불일치');
  if((String(x.commentary||'').trim().match(/(상승|하락|보합)으로 마감[.]?$/)||[])[1]!==dir)bad(n,'코멘터리 마감 방향 불일치');
  const rawComm=(brief.match(/^코멘터리\s*\n+([\s\S]*?)\n+변둉요인\s*$/m)||[])[1]||'';
  if((rawComm.trim().match(/(상승|하락|보합)으로 마감[.]?$/)||[])[1]!==dir)bad(n,'raw_brief 코멘터리 방향 불일치');
  const assessment=String(x.assessment_date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(assessment))bad(n,'평가일 없음');
  else {
   const age=Math.round((Date.parse(wk+'T00:00:00Z')-Date.parse(assessment+'T00:00:00Z'))/86400000);
   if(age<0||age>6)bad(n,'당주 유효 평가일 재확인 필요: '+assessment);
  }
 });
 return {passed:problems.length===0,week:wk,count:rows.length,issues:problems};
}
function regression(){
 const wk='2026-10-09';
 const rows=ORDER.map(n=>{
  const line=n+': $1,555.00/mt ← $1,550.00/mt (전주 대비 +$5.00/mt, +0.32%, 상승)';
  return [wk+'__'+n,wk,n,'',wk,n,'$1,555.00/mt','$1,550.00/mt','/mt',5,0.32,'상승',line,'공급이 지지해 상승으로 마감','','','','','제목 : '+n+' 종목 브리핑 ('+wk+')\n\n가격\n\n'+line+'\n\n코멘터리\n\n공급이 지지해 상승으로 마감\n\n변둉요인\n\n- 공급',''];
 });
 const good=audit({week:wk,rows});
 rows[6][11]='보합';rows[6][12]=rows[6][12].replace('0.32%, 상승','0.32%, 보합');
 const wrong=audit({week:wk,rows});
 if(!good.passed||wrong.passed||!wrong.issues.some(e=>e.startsWith('AN: 가격 방향')))throw Error('AN +$5 회귀 테스트 실패');
 return {good:good.passed,regressionCatchesAN:wrong.issues.filter(e=>e.startsWith('AN:'))};
}
module.exports={audit,regression};
if(require.main===module){
 if(process.argv[2]==='--self-test'){console.log(JSON.stringify(regression(),null,2));process.exit(0)}
 if(!process.argv[2]){console.error('Usage: node scripts/validate-weekly-prices.cjs <sheets-A-to-U-snapshot.json>');process.exit(2)}
 const fs=require('node:fs');
 const report=audit(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
 console.log(JSON.stringify(report,null,2));process.exit(report.passed?0:1);
}
