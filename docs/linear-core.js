(function (root) {
  'use strict';
  const VERSION = 'sterling-lf-54-v2';
  const defaults = Object.freeze({width:100,height:108,length:53,capacity:37500,factor:0.95});
  const units = Object.freeze({in:1,ft:12,cm:1/2.54,mm:1/25.4,m:100/2.54});
  class InputError extends Error { constructor(errors) { super(errors.map(e=>e.message).join(' ')); this.errors=errors; } }
  function calculate(input, rotate=true) {
    const errors=[];
    const number=(v,path,label,max,integer=false)=>{
      const n=(typeof v==='number'||typeof v==='string' && /^\d+(\.\d+)?$/.test(v.trim()))?Number(v):NaN;
      if(!Number.isFinite(n)||n<=0||n>max||(integer&&!Number.isInteger(n))) errors.push({path,message:`${label}: enter ${integer?'a whole number':'a number'} greater than 0 and no more than ${max}.`});
      return n;
    };
    if(!input||typeof input!=='object') throw new InputError([{path:'items',message:'Enter freight dimensions.'}]);
    const t=input.trailer||{}, trailer={};
    for(const [key,label,max] of [['width','Trailer width',1000],['height','Trailer height',1000],['length','Trailer length',1000],['capacity','Weight capacity',1000000],['factor','Safety factor',1]]) trailer[key]=number(t[key],`trailer.${key}`,label,max);
    if(typeof input.reference!=='string'||input.reference.length>80) errors.push({path:'reference',message:'Reference must be text up to 80 characters.'});
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>100) throw new InputError([...errors,{path:'items',message:'Enter between 1 and 100 freight lines.'}]);
    const items=input.items.map((r,i)=>{
      r=r&&typeof r==='object'?r:{};
      const path=`items.${i}`, label=`Line ${i+1}`, unit=r.unit;
      if(!Object.hasOwn(units,unit)) errors.push({path:`${path}.unit`,message:`${label}: choose in, ft, cm, mm or m.`});
      if(typeof r.notStackable!=='boolean') errors.push({path:`${path}.notStackable`,message:`${label}: stacking selection is missing.`});
      const quantity=number(r.quantity,`${path}.quantity`,`${label} quantity`,100000,true);
      const length=number(r.length,`${path}.length`,`${label} length`,100000)*units[unit];
      const width=number(r.width,`${path}.width`,`${label} width`,100000)*units[unit];
      const height=number(r.height,`${path}.height`,`${label} height`,100000)*units[unit];
      const weight=number(r.weight,`${path}.weight`,`${label} unit weight (lb)`,1000000);
      const maxStack=r.maxStack===''||r.maxStack==null?null:number(r.maxStack,`${path}.maxStack`,`${label} maximum stack`,1000,true);
      if(rotate) {
        if(!((length<=trailer.length*12+1e-8&&width<=trailer.width+1e-8)||(width<=trailer.length*12+1e-8&&length<=trailer.width+1e-8))) errors.push({path:`${path}.width`,message:`${label}: floor dimensions do not fit the trailer in either orientation.`});
      } else {
        if(length>trailer.length*12+1e-8) errors.push({path:`${path}.length`,message:`${label}: length exceeds the trailer. Review equipment or orientation.`});
        if(width>trailer.width+1e-8) errors.push({path:`${path}.width`,message:`${label}: width exceeds the trailer. Rotation is not automatic.`});
      }
      if(height>trailer.height+1e-8) errors.push({path:`${path}.height`,message:`${label}: height exceeds the trailer clearance.`});
      if(weight>trailer.capacity) errors.push({path:`${path}.weight`,message:`${label}: one piece exceeds the trailer weight capacity.`});
      return {quantity,length,width,height,weight,maxStack,notStackable:r.notStackable,unit};
    });
    if(errors.length) throw new InputError(errors);
    const floor=n=>Math.floor(n+1e-10);
    const ceil=n=>Math.ceil(n-1e-10);
    const rows=items.map(r=>{
      const forced=r.notStackable||r.weight>2500;
      const allowed=forced?1:Math.max(1,floor(trailer.height/r.height));
      const stack=forced?1:r.maxStack===null?(r.height>54+1e-8?1:allowed):Math.min(allowed,Math.max(1,r.maxStack));
      if(rotate){
        const options=[{length:r.length,width:r.width,rotated:false},{length:r.width,width:r.length,rotated:true}]
          .filter(o=>o.width<=trailer.width+1e-8&&o.length<=trailer.length*12+1e-8)
          .map(o=>{const across=floor(trailer.width/o.width);return {...o,whole:ceil(ceil(r.quantity/stack)/across)*o.length,estimate:r.quantity/stack*o.length/across};})
          .sort((a,b)=>a.whole-b.whole||a.estimate-b.estimate||Number(a.rotated)-Number(b.rotated));
        const best=options[0];r={...r,originalLength:r.length,originalWidth:r.width,length:best.length,width:best.width,rotated:best.rotated};
      }
      const across=Math.max(1,floor(trailer.width/r.width));
      const positions=r.quantity/stack;
      const effectiveHeight=stack>1?r.height:(forced||r.height>54+1e-8?100:r.height);
      return {...r,allowed,stack,across,positions,wholePositions:ceil(positions),
        theoretical:positions*r.length/(12*across),
        wholeRow:ceil(ceil(positions)/across)*r.length/12,
        cube:r.quantity*r.length*r.width*effectiveHeight/1728,
        actualCube:r.quantity*r.length*r.width*r.height/1728,
        area:positions*r.length*r.width/144};
    });
    const sum=k=>rows.reduce((n,r)=>n+r[k],0);
    const theoretical=sum('theoretical'),adjusted=theoretical/trailer.factor,wholeRow=sum('wholeRow');
    const weight=rows.reduce((n,r)=>n+r.quantity*r.weight,0);
    const space=adjusted/trailer.length,weightUse=weight/trailer.capacity;
    const warnings=[];
    if(rows.some(r=>r.stack>1)) warnings.push('Stacking is assumed under the workbook rules. Confirm load-bearing strength and carrier acceptance; select Not stackable when required.');
    if(rows.some(r=>r.height>54+1e-8&&r.stack>1)) warnings.push('An explicit maximum-stack entry overrides the 54-inch automatic cutoff, as in the workbook formulas. Confirm this exception.');
    if(wholeRow>adjusted+1e-8) warnings.push('Whole-row space exceeds the workbook estimate. Partial stacks and partially filled rows consume real floor space.');
    if(space>1||weightUse>1||wholeRow>trailer.length) warnings.push('This shipment exceeds at least one single-trailer planning measure. Split the load or review equipment with the carrier.');
    return {version:rotate?VERSION:'sterling-lf-54-v1',trailer,rows,theoretical,adjusted,wholeRow,weight,space,weightUse,controlling:Math.max(space,weightUse),pieces:sum('quantity'),cube:sum('cube'),actualCube:sum('actualCube'),area:sum('area'),warnings};
  }
  // Full-line parsing; bare dimensions default to one piece and inches, never weight.
  function parseText(text) {
    if(typeof text!=='string'||text.length>20000) throw new InputError([{path:'paste',message:'Paste no more than 20,000 characters.'}]);
    const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(!lines.length||lines.length>100) throw new InputError([{path:'paste',message:'Paste between 1 and 100 dimension lines.'}]);
    const errors=[],items=[];
    lines.forEach((line,i)=>{
      let quantity='1',body=line;
      const prefix=body.match(/^(\d+)\s*(?:(?:pcs?|pieces?|pallets?)\s*[@x×]?|@|[-–—](?=\s*\d+(?:\.\d+)?\s*[x×]))\s*/i);
      if(prefix){quantity=prefix[1];body=body.slice(prefix[0].length);}
      else if(/^\d+\s*[x×]\s*\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*[x×]\s*\d/i.test(body)){
        const old=body.match(/^(\d+)\s*[x×]\s*/i);quantity=old[1];body=body.slice(old[0].length);
      }
      body=body.replace(/[″“”]/g,'"').replace(/"\s*[x×]/gi,'x');
      const m=body.match(/^(\d+(?:\.\d+)?)\s*[x×"]\s*(\d+(?:\.\d+)?)\s*(?:[x×"]\s*(\d+(?:\.\d+)?))?\s*"?\s*(in|ft|cm|mm|m)?\s*(?:[,;]?\s*(\d+(?:\.\d+)?)\s*(lbs?|kg)\s*(?:each|ea)?)?\s*(?:[,;]\s*(nonstack|stackable))?$/i);
      if(!m) errors.push({path:'paste',message:`Pasted line ${i+1}: use “40x48x50”, “10-40X48X86” (quantity-length × width × height), or “2 @ 48 x 40 x 48 in, 500 lb each”. No other email text.`});
      else items.push({quantity,length:m[1],width:m[2],height:m[3]||'',unit:(m[4]||'in').toLowerCase(),weight:m[5]?String(Number(m[5])*(m[6].toLowerCase()==='kg'?1/0.45359237:1)):'',notStackable:m[7]?.toLowerCase()==='nonstack',maxStack:''});
    });
    if(errors.length) throw new InputError(errors);
    return items;
  }
  // Supplied NMFC.pdf reference table. Keep derived summary values separate
  // from versioned calculation snapshots so existing backups remain valid.
  function freightSummary(result) {
    const density=result.weight/result.actualCube;
    if(!Number.isFinite(density)||density<=0) return null;
    const brackets=[[50,50],[35,55],[30,60],[22.5,65],[15,70],[13.5,77.5],[12,85],[10.5,92.5],[9,100],[8,110],[7,125],[6,150],[5,175],[4,200],[3,250],[2,300],[1,400],[0,500]];
    return {density,freightClass:brackets.find(([minimum])=>density>=minimum)[1]};
  }
  const dimFactors=Object.freeze([139,166,194,250]);
  function chargeableWeight(result,factor=194){
    factor=Number(factor);
    if(!dimFactors.includes(factor))throw new Error('Select a supported dimensional factor.');
    const dimensional=result.actualCube*1728/factor;
    return {factor,dimensional,chargeable:Math.ceil(Math.max(result.weight,dimensional))};
  }
  const api={dimFactors,chargeableWeight,VERSION,defaults,units,InputError,calculate,calculateLegacy:input=>calculate(input,false),parseText,freightSummary};
  if(typeof module==='object'&&module.exports) module.exports=api; else root.SBSLinear=Object.freeze(api);
})(typeof window==='object'?window:globalThis);
