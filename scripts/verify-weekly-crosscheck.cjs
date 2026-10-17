#!/usr/bin/env node
'use strict';
/*
  Weekly cross-check G2:
  1. manually reviewed price-source ledger (original PDF/image evidence);
  2. 18-item parsing, benchmark, price arithmetic, assessment date;
  3. A/S direction vs assessment (with carry-forward exemption);
  4. LAM six-item JSON vs the same ledger;
  5. optional native Google Sheets A:U row snapshot.
  Does NOT OCR private files or claim that pending sources were visually reviewed.
*/
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ORDER=['WTI','Ethylene','Propylene','Benzene','SM','BD','AN','BPA','MMA','ABS','PC','EPS','PS','PBR','유럽 SM','미국 SM','유럽 BD','미국 BD'];
const CORE={WTI:'WTI',SM:'Styrene',AN:'Acrylonitrile',BD:'Butadiene',BPA:'BPA',MMA:'MMA'};
const SEC=['가격','코멘터리','변둉요인','결론 및 전망','추가 정보','데일리가격','ai 전망'];
function nearly(a,b,t=0.011){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=t}
function direction(d){return d>0.000001?'상승':d< -0.000001?'하락':'보합'}
function pct(d,previous){return Number((d/previous*100).toFixed(2))}
function blocks(text,header){return String(text).split(new RegExp('(?=^'+header+' : )','m')).filter(x=>x.startsWith(header+' : '))}
function section(block,key){
 const start=block.search(new RegExp('^'+key+'\\s*$','m'));
 if(start<0)return '';
 const suffix=block.slice(start).replace(new RegExp('^'+key+'\\s*\\n+'),'');
 const idx=SEC.indexOf(key),next=idx+1<SEC.length?SEC[idx+1]:null;
 return (next?suffix.split(new RegExp('\\n+'+next+'\\s*\\n'))[0]:suffix).trim();
}
function priceLine(line){
 const m=String(line).trim().match(/^(.+?):\s*\$?([\d,]+(?:\.\d+)?)\s*(\/mt|\/b|cents\/lb)\s*←\s*\$?([\d,]+(?:\.\d+)?)\s*(\/mt|\/b|cents\/lb)\s*\((.+)\)$/);
 if(!m)return null;
 const rest=m[6],change=rest.match(/(?:전주 대비|기준)\s+([+-]?\$?[+-]?[\d.]+)\s*(?:\/mt|\/b|cents\/lb)/);
 const percent=rest.match(/([+-]?\d+(?:\.\d+)?)%/);
 const label=rest.match(/,\s*(상승|하락|보합)\s*\)$/);
 const read=s=>Number(String(s).replace(/[$,]/g,''));
 return {benchmark:m[1],current:read(m[2]),previous:read(m[4]),unit:m[3],unitPrev:m[5],
   change:change?read(change[1]):NaN,pct:percent?Number(percent[1]):NaN,
   direction:label?label[1]:'',annotation:rest};
}
function inspect(input){
 const {ledger,weekly,asText,lam,sheetRows,requireAllReviewed=false}=input;
 const errors=[],warnings=[];
 const bad=(item,message)=>errors.push(item+': '+message);
 const warn=(item,message)=>warnings.push(item+': '+message);
 if(!ledger||ledger.week_end!=='2026-10-16')bad('GLOBAL','검증 장부 주차/형식 확인 필요');
 const approved=ledger?.items||[];
 if(approved.length!==18)bad('GLOBAL','승인 장부 18개 품목 불일치');
 const briefs=blocks(weekly,'제목'), cards=blocks(asText,'품목');
 if(briefs.length!==18)bad('GLOBAL','위클리 18개 품목 누락: '+briefs.length);
 if(cards.length!==18)bad('GLOBAL','AS 18개 품목 누락: '+cards.length);
 const asMap=new Map(cards.map(b=>[b.match(/^품목 : (.+)$/m)?.[1],b]));
 const prices=new Map();
 approved.forEach((r,i)=>{
   const name=r.item;
   if(name!==ORDER[i])bad(name,'품목 순서 또는 누락');
   if(r.review==='pending'){warn(name,'원본 가격표 검증 미완료');if(requireAllReviewed)bad(name,'원본 이미지/PDF 대조 미승인')}
   else if(!['manual_checked','carry_forward'].includes(r.review))bad(name,'원본 평가상태 선언 누락');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(r.assessment_date||''))bad(name,'원본 평가일 불명');
   if(['SM','BD','Benzene','AN'].includes(name)&&!r.source.startsWith('Platts'))bad(name,'가격소스 Platts 규칙 위반');
   if(name==='미국 BD'&&!r.source.startsWith('ICIS'))bad(name,'미국 BD 가격소스 ICIS 규칙 위반');
   const brief=briefs[i]||'';
   if(!brief.startsWith('제목 : '+name+' 종목 브리핑 ('+ledger.week_end+')'))bad(name,'제목/주차/순서 불일치');
   const lines=section(brief,'가격').split(/\r?\n/).filter(Boolean);
   const parsed=priceLine(lines[0]||'');
   if(!parsed){bad(name,'대표가격 형식 파싱 실패');return}
   prices.set(name,parsed);
   if(parsed.benchmark!==r.benchmark)bad(name,'벤치마크 불일치: '+parsed.benchmark);
   if(!nearly(parsed.current,r.current)||!nearly(parsed.previous,r.previous))bad(name,'원본 가격장부와 주간 가격 불일치');
   const delta=r.current-r.previous;
   if(!nearly(parsed.change,delta))bad(name,'전주 변동액 오류: '+parsed.change+' != '+delta.toFixed(2));
   if(!nearly(parsed.pct,pct(delta,r.previous)))bad(name,'전주 변동률 오류: '+parsed.pct+' != '+pct(delta,r.previous));
   if(parsed.direction!==direction(delta))bad(name,'방향 오류: '+parsed.direction+' != '+direction(delta));
   if(!r.benchmark.includes('CIF USG') && parsed.unit!==parsed.unitPrev)bad(name,'기준 단위 불일치');
   for(const k of SEC)if(!section(brief,k))bad(name,'필수 섹션 또는 내용 누락: '+k);
   const comm=section(brief,'코멘터리');
   if(!comm.endsWith(parsed.direction+'으로 마감'))bad(name,'코멘터리 마감 방향 불일치');
   const daily=section(brief,'데일리가격');
   if(r.review==='carry_forward'){
     if(!/미확인|미제공|미평가|없음/.test(brief))bad(name,'구평가일 가격을 신규 주간가처럼 표시');
   }else if(r.review==='manual_checked'){
     const d=r.assessment_date.slice(5).replace(/^0/,'').replace(/-0?/g,'/');
     if(!daily.includes(d+':'))bad(name,'확정 평가일 일별/주간 가격 항목 누락: '+d);
   }
   const card=asMap.get(name);
   if(!card){bad(name,'AS 카드 누락');return}
   const actual=card.match(/^실제 : (.+)$/m)?.[1];
   const asVerdict=card.match(/^판정 : (.+)$/m)?.[1];
   if(r.review==='carry_forward'){
     if(actual!=='평가유보'||asVerdict!=='판정보류')bad(name,'신규 평가 없는 품목 AS 판정보류 필요');
   }else if(actual!==parsed.direction)bad(name,'AS 실제 방향이 주간 가격과 불일치: '+actual+' != '+parsed.direction);
 });
 if(asMap.size!==18)bad('GLOBAL','AS 카드 명칭 중복 또는 누락');
 if(lam){
   if(lam.week!=='2026-W42')bad('LAM','LAM 데이터 주차 불일치');
   for(const [name,key] of Object.entries(CORE)){
     const src=approved.find(x=>x.item===name),dst=lam.items?.[key];
     if(!dst){bad(name,'LAM 핵심원료 누락');continue}
     if(!nearly(dst.price,src.current)||!nearly(dst.prev_price,src.previous))bad(name,'LAM 대표/전주 가격과 승인 장부 불일치');
     if(!nearly(dst.change_abs,src.current-src.previous)||!nearly(dst.change_pct,pct(src.current-src.previous,src.previous)))bad(name,'LAM 변동액/변동률 불일치');
     const brief=briefs[ORDER.indexOf(name)];
     if(dst.commentary!==section(brief,'코멘터리'))bad(name,'LAM 코멘터리와 18품목 코멘터리 불일치');
   }
 }
 if(sheetRows){
   const rows=sheetRows.rows||sheetRows;
   if(rows.length!==18)bad('SHEETS','스냅샷은 18개 A:U 데이터 행 필요');
   rows.forEach((row,i)=>{
     const d=Array.isArray(row)?row:row.values||[];
     const src=approved[i];if(!src)return;
     if(d[2]!==src.item||d[4]!==src.assessment_date||d[5]!==src.benchmark)bad(src.item,'Google Sheets 품목/평가일/벤치마크 불일치');
     if(!nearly(Number(String(d[6]).replace(/[^0-9.+-]/g,'')),src.current))bad(src.item,'Google Sheets 가격과 승인장부 불일치');
     if(d[13]!==section(briefs[i],'코멘터리'))bad(src.item,'Google Sheets 코멘터리와 위클리 원문 불일치');
   });
 }
 return {passed:errors.length===0,ready_for_fully_verified_release:errors.length===0&&warnings.length===0,
   week:ledger?.week_end||'',total:approved.length,reviewed:approved.filter(x=>x.review==='manual_checked').length,
   pending:approved.filter(x=>x.review==='pending').length,carry_forward:approved.filter(x=>x.review==='carry_forward').length,
   errors,warnings};
}
function main(){
 const dir=path.resolve(__dirname,'..');
 const arg=process.argv.slice(2);
 const file=(flag,fallback)=>{const s=arg.find(x=>x.startsWith(flag+'='));return s?s.slice(flag.length+1):path.join(dir,fallback)};
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const ledger=read(file('--ledger','data/verification/W42.json'));
 const weekly=fs.readFileSync(file('--weekly','data/weekly/W42.md'),'utf8');
 const asText=fs.readFileSync(file('--as','data/as/W42.md'),'utf8');
 const lamArg=arg.find(x=>x.startsWith('--lam='));
 const lam=lamArg?read(lamArg.slice(6)):null;
 const snapshot=arg.find(x=>x.startsWith('--sheet='));
 const input={ledger,weekly,asText,lam,sheetRows:snapshot?read(snapshot.slice(8)):null,
   requireAllReviewed:arg.includes('--require-all-reviewed')};
 const result=inspect(input);
 if(arg.includes('--self-test')){
   if(!result.passed)console.error('BASELINE ERRORS:',JSON.stringify(result.errors,null,2));
   assert.equal(result.passed,true,'Baseline weekly source ledger must pass');
   const incorrect=structuredClone(ledger);
   incorrect.items.find(x=>x.item==='미국 BD').assessment_date='2026-10-09';
   assert.equal(inspect({...input,ledger:incorrect}).passed,false,'Must catch published-date mismatch in source ledger vs daily price');
   const priceMistake=weekly.replace('Butadiene CIF USG Spot: 48.00 cents/lb','Butadiene CIF USG Spot: 49.00 cents/lb');
   assert.equal(inspect({...input,weekly:priceMistake}).passed,false,'Must catch price error');
   const missing=asText.replace('품목 : 미국 BD\n전주 전망 : 보합\n실제 : 보합','품목 : 미국 BD\n전주 전망 : 보합\n실제 : 평가유보');
   assert.equal(inspect({...input,asText:missing}).passed,false,'Must catch unjustified pending AS');
   if(lam){
     const wrong=structuredClone(lam);wrong.items.Butadiene.price=1610;
     assert.equal(inspect({...input,lam:wrong}).passed,false,'Must catch stale LAM price');
   }
   console.log('PASS regression: wrong publish date, price, A/S, and LAM price rejected');
 }
 console.log(JSON.stringify(result,null,2));
 process.exit(result.passed?0:1);
}
module.exports={inspect,priceLine,section};
if(require.main===module)main();
