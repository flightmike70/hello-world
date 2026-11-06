(function(root){
 'use strict';
 const VERSION='sterling-partial-v1';
 const rates=[].map(([origin,destination,cost])=>Object.freeze({origin,destination,cost,equipment:'53 Dry Van',effective:'2026-08-29'}));
 function calculate(p,lf){
  if(!p?.enabled)return null;
  function number(key,min,max){const v=p[key];const n=typeof v==='number'||typeof v==='string'&&/^\d+(\.\d+)?$/.test(v.trim())?Number(v):NaN;if(!Number.isFinite(n)||n<min||n>max)throw Error(`Partial quote: enter ${key} between ${min} and ${max}.`);return n;}
  for(const key of ['origin','destination','equipment','effective'])if(typeof p[key]!=='string'||!p[key].trim()||p[key].length>100)throw Error(`Partial quote: enter ${key}.`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p.effective)||new Date(p.effective+'T00:00:00Z').toISOString().slice(0,10)!==p.effective)throw Error('Partial quote: enter a valid rate date.');
  const ftl=number('ftl',0.01,10000000),pickupDelivery=number('pickupDelivery',0,10000000),other=number('other',0,10000000);
  const utilization=Math.max(lf.space,lf.weightUse);
  if(!Number.isFinite(utilization)||utilization<=0)throw Error('Calculate freight space and weight first.');
  const override=p.margin!==''&&p.margin!=null;
  const margin=override?number('margin',0,99.99)/100:utilization<.2?null:utilization<=.3?.35:utilization<=.4?.25:.2;
  const linehaul=ftl*utilization,totalCost=linehaul+pickupDelivery+other;
  const sell=margin===null?null:(linehaul+other)/(1-margin)+pickupDelivery*1.25;
  return {version:VERSION,utilization,ftl,linehaul,pickupDelivery,other,totalCost,margin,marginSource:override?'Manual override':'Workbook automatic',sell,profit:sell===null?null:sell-totalCost,actualMargin:sell===null?null:(sell-totalCost)/sell,status:margin===null?'Use tariff':utilization>1?'Multiple-truck review':'Estimated quote'};
 }
 const api=Object.freeze({VERSION,rates:Object.freeze(rates),calculate});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.SBSPartial=api;
})(typeof window==='object'?window:globalThis);
