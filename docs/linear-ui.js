(() => {
  'use strict';
  const $=id=>document.getElementById(id), core=window.SBSLinear;
  if(!core){$('lf-fatal').hidden=false;$('lf-fatal').textContent='The calculator did not load. Refresh the page and try again.';return;}
  const fmt=n=>n.toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:2});
  const clone=x=>JSON.parse(JSON.stringify(x));
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  let dimFactor=194;
  let result=null, input=null, undo=null, pending=null, db=null, records=[],busy=false, activeRows=[];
  const draftKey='sbs-linear-draft-v1';
  const log=code=>console.warn('[SBS Linear]',code); // No inputs, refs, email text or stack traces.
  const status=text=>$('lf-history-status').textContent=text;

  let quote=null,quoteError=false;
  function readPricing(){return Object.fromEntries([...document.querySelectorAll('[data-pricing]')].map(n=>[n.dataset.pricing,n.type==='checkbox'?n.checked:n.value]));}
  function applyPricing(p={}){const defaults={enabled:false,origin:'',destination:'',equipment:'53 Dry Van',effective:'',ftl:'',pickupDelivery:'0',other:'0',margin:''};for(const n of document.querySelectorAll('[data-pricing]')){const value=p?.[n.dataset.pricing]??defaults[n.dataset.pricing];if(n.type==='checkbox')n.checked=value===true;else n.value=value;}}
  function renderQuote(p,r){
    quoteError=false;quote=null;
    const box=$('pq-result');box.replaceChildren();
    try{quote=window.SBSPartial.calculate(p,r);}catch(e){quoteError=true;box.textContent=e.message;for(const id of ['lf-save','lf-copy','lf-export-current'])$(id).disabled=true;return;}
    if(!quote){box.textContent='Select Include pricing to price this shipment.';return;}
    const q=quote,dl=el('dl');
    for(const [label,value,cls] of [['Recommended sell price',q.sell===null?'Use tariff':'$'+fmt(q.sell),'pq-sell'],['Estimated shipment cost','$'+fmt(q.totalCost)],['Gross profit',q.profit===null?'—':'$'+fmt(q.profit)],['Actual gross margin',q.actualMargin===null?'—':fmt(q.actualMargin*100)+'%'],['Controlling utilization',fmt(q.utilization*100)+'%'],['Estimated linehaul','$'+fmt(q.linehaul)],['Linehaul / other margin',q.margin===null?'Tariff required':fmt(q.margin*100)+'%'],['Pickup + delivery sell','$'+fmt(q.pickupDelivery*1.25)]]){
      const d=el('div',undefined,cls);d.append(el('dt',label),el('dd',value));dl.append(d);
    }box.append(dl);
    box.append(el('p',q.marginSource+' · Rate effective '+p.effective+'. Confirm this dated cost before quoting. Other cost: $'+fmt(q.other)+'.'));
    if(q.status==='Use tariff')box.append(el('p','Below 20% utilization: the workbook calls for tariff pricing. No tariff is loaded, so no customer price is generated.'));
    if(q.utilization>1||r.wholeRow>r.trailer.length)box.append(el('p','Load exceeds one trailer on at least one measure. Review the number of trucks before quoting.'));
    box.append(el('p','Estimated buy cost = full-truck linehaul × controlling utilization + pickup/delivery + other. Sell = (linehaul + other) ÷ (1 − margin) + pickup/delivery × 1.25.'));
  }
  function quoteText(){if(!quote)return '';return 'Partial quote: '+input.pricing.origin+' to '+input.pricing.destination+' · '+input.pricing.equipment+'\nRate effective: '+input.pricing.effective+'\nShipment cost: $'+fmt(quote.totalCost)+'\nCustomer sell: '+(quote.sell===null?'Use tariff':'$'+fmt(quote.sell))+'\nGross profit: '+(quote.profit===null?'—':'$'+fmt(quote.profit));}
  for(const r of window.SBSPartial.rates){
    const tr=el('tr');for(const text of [r.origin,r.destination,r.equipment,'$'+fmt(r.cost)])tr.append(el('td',text));
    const td=el('td'),b=el('button','Use rate');b.type='button';b.setAttribute('aria-label','Use '+r.origin+' to '+r.destination+' rate');
    b.addEventListener('click',()=>{const p=readPricing();applyPricing({...p,enabled:true,origin:r.origin,destination:r.destination,equipment:r.equipment,effective:r.effective,ftl:String(r.cost)});changed();});td.append(b);tr.append(td);$('pq-rates').append(tr);
  }
  function blank(){return {description:'',quantity:'',length:'',width:'',height:'',weight:'',unit:'in',maxStack:'',notStackable:false};}
  function read(){return {dimFactor,reference:$('lf-reference').value.trim(),pricing:readPricing(),trailer:Object.fromEntries([...document.querySelectorAll('[data-setting]')].map(n=>[n.dataset.setting,n.value])),items:[...$('lf-lines').children].map(n=>Object.fromEntries([...n.querySelectorAll('[data-field]')].map(f=>[f.dataset.field,f.type==='checkbox'?f.checked:f.value])))};}
  function invalidate(){quote=null;$('pq-result').textContent='Calculate to update the partial quote.';result=null;input=null;$('lf-total').textContent='—';$('lf-result-note').textContent='Inputs changed. Calculate to update the result.';renderMetrics(null);document.querySelectorAll('[data-output]').forEach(n=>n.textContent='—');$('lf-warnings').replaceChildren();$('lf-breakdown-panel').hidden=true;for(const id of ['lf-save','lf-copy','lf-export-current'])$(id).disabled=true;}
  function persistDraft(){try{sessionStorage.setItem(draftKey,JSON.stringify({schema:1,value:read()}));$('lf-draft-status').textContent='Draft recovery is available after a refresh in this tab. Save to history to keep it after closing.';}catch{log('draft_storage_unavailable');$('lf-draft-status').textContent='Draft recovery unavailable. Save or export your calculation before leaving.';}}
  function changed(){invalidate();persistDraft();}
  function clearErrors(){ $('lf-errors').hidden=true;$('lf-errors').replaceChildren();document.querySelectorAll('[aria-invalid]').forEach(n=>{n.removeAttribute('aria-invalid');n.removeAttribute('aria-describedby');}); }
  function showError(error){clearErrors();const list=el('ul');for(const e of error.errors||[{message:error.message||'An unexpected error occurred. Try again.',path:''}]){
    list.append(el('li',e.message));const parts=e.path?.split('.');let field;
    if(parts?.[0]==='items') field=$('lf-lines').children[Number(parts[1])]?.querySelector(`[data-field="${parts[2]}"]`);
    if(parts?.[0]==='trailer') {field=$(`lf-${parts[1]}`);$('lf-settings').open=true;}
    if(field){field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby','lf-errors');}
  }$('lf-errors').append(list);$('lf-errors').hidden=false;$('lf-errors').focus();}
  function renderRows(items){$('lf-lines').replaceChildren();items.forEach((r,i)=>{
    const box=el('tr',undefined,'lf-line');const number=el('th',String(i+1).padStart(2,'0'));number.scope='row';box.append(number);
    for(const [key,title] of [['description','Item / commodity'],['quantity','Quantity'],['length','Length'],['width','Width'],['height','Height'],['unit','Dimension unit'],['weight','Unit weight in pounds']]){
      const cell=el('td'),f=el(key==='unit'?'select':'input');f.dataset.field=key;f.id=`lf-${i}-${key}`;f.setAttribute('aria-label',`Line ${i+1} ${title}`);
      if(key==='unit')for(const u of ['',...Object.keys(core.units)]){const o=el('option',u||'Confirm');o.value=u;f.append(o);}
      else if(key==='description'){f.type='text';f.maxLength=80;f.placeholder='Optional item';}
      else{f.type='number';f.step=key==='quantity'?'1':'any';f.min='0';f.inputMode='decimal';}
      f.value=r[key]??'';cell.append(f);box.append(cell);
    }
    const stackCell=el('td'),check=el('input');check.type='checkbox';check.dataset.field='notStackable';check.checked=r.notStackable===true;check.setAttribute('aria-label',`Line ${i+1} Not stackable`);stackCell.append(check);box.append(stackCell);
    const maxCell=el('td'),max=el('input');max.type='number';max.min='1';max.step='1';max.dataset.field='maxStack';max.id=`lf-${i}-maxStack`;max.value=r.maxStack??'';max.placeholder='Auto';max.setAttribute('aria-label',`Line ${i+1} Maximum stack high (optional)`);maxCell.append(max);box.append(maxCell);
    for(const field of ['stack','positions','theoretical']){const cell=el('td','—','lf-calculated');cell.dataset.output=field;box.append(cell);}
    const removeCell=el('td'),remove=el('button','×','lf-remove');remove.setAttribute('aria-label',`Remove line ${i+1}`);remove.type='button';remove.disabled=items.length===1;remove.addEventListener('click',()=>{undo=read();const next=clone(undo);next.items.splice(i,1);apply(next);$('lf-undo').hidden=false;changed();});removeCell.append(remove);box.append(removeCell);$('lf-lines').append(box);
  });$('lf-add').disabled=items.length>=100;$('lf-add').textContent=items.length>=100?'100-row limit reached':`+ Add ${Math.min(10,100-items.length)} freight rows`;}
  function renderMetrics(r){
    const freight=r?core.freightSummary(r):null;
    const metrics=[['Theoretical LF',r?`${fmt(r.theoretical)} ft`:'—'],['Whole-row space',r?`${fmt(r.wholeRow)} ft`:'—'],['Space utilization',r?`${fmt(r.space*100)}%`:'—'],['Weight utilization',r?`${fmt(r.weightUse*100)}%`:'—'],['Pieces / total weight',r?`${r.pieces} / ${fmt(r.weight)} lb`:'—'],['Effective cube',r?`${fmt(r.cube)} cu ft`:'—'],['Actual cargo cube',r?`${fmt(r.actualCube)} cu ft`:'—']];
    metrics.push(['Pounds per cubic ft',freight?`${fmt(freight.density)} lb/cu ft`:'—'],['Freight class estimate',freight?`Class ${freight.freightClass}`:'—']);
    $('lf-metrics').replaceChildren(...metrics.map(([k,v])=>{const d=el('div');d.append(el('dt',k),el('dd',v));
      if(k==='Effective cube'){
        const charge=r?core.chargeableWeight(r,dimFactor):null;
        d.append(el('dt','Chargeable weight','lf-charge-label'),el('dd',charge?charge.chargeable.toLocaleString('en-US')+' lb':'—'));
        const label=el('label','Dim factor · in³/lb','lf-dim-label'),select=el('select');
        select.id='lf-dim-factor';label.htmlFor=select.id;
        for(const f of core.dimFactors){const o=el('option',String(f)+(f===194?' (default)':''));o.value=f;select.append(o);}select.value=dimFactor;
        select.addEventListener('input',e=>e.stopPropagation());
        select.addEventListener('change',e=>{e.stopPropagation();dimFactor=Number(select.value);if(input)input.dimFactor=dimFactor;renderMetrics(result);persistDraft();$('lf-dim-factor').focus();if(result&&!quoteError)$('lf-save').disabled=false;});
        d.append(label,select,el('small',charge?'Dim weight: '+fmt(charge.dimensional)+' lb. Greater of actual or dimensional weight, rounded up.':'Greater of actual or dimensional weight, rounded up.'));
      }
      return d;}));
  }
  function apply(v){dimFactor=core.dimFactors.includes(Number(v.dimFactor))?Number(v.dimFactor):194;applyPricing(v.pricing);$('lf-reference').value=v.reference||'';for(const k of Object.keys(core.defaults))$(`lf-${k}`).value=v.trailer?.[k]??core.defaults[k];renderRows(v.items);invalidate();clearErrors();}
  function renderResult(r){$('lf-total').textContent=`${fmt(r.adjusted)} ft`;$('lf-result-note').textContent='Workbook planning estimate. Confirm the actual load plan with the carrier.';
    renderMetrics(r);r.rows.forEach((row,i)=>{for(const key of ['stack','positions','theoretical'])$('lf-lines').children[activeRows[i]??i].querySelector(`[data-output="${key}"]`).textContent=key==='stack'?row[key]:fmt(row[key]);});const ul=el('ul');r.warnings.forEach(w=>ul.append(el('li',w)));$('lf-warnings').replaceChildren(ul);
    $('lf-breakdown').replaceChildren(...r.rows.map((row,i)=>{const tr=el('tr');[`${(activeRows[i]??i)+1} / ${row.quantity}`,`${fmt(row.length)} × ${fmt(row.width)} × ${fmt(row.height)}${row.rotated?" (rotated)":""}`,`${row.stack} high / ${row.across} across`,fmt(row.positions),fmt(row.theoretical),fmt(row.wholeRow)].forEach(v=>tr.append(el('td',v)));return tr;}));$('lf-breakdown-panel').hidden=false;for(const id of ['lf-save','lf-copy','lf-export-current'])$(id).disabled=false;
  }
  function prepareWorksheet(items){
    const indices=items.map((r,i)=>({r,i})).filter(({r})=>r.notStackable || ['description','quantity','length','width','height','weight','maxStack'].some(k=>String(r[k]??'').trim()!=='' )).map(({i})=>i);
    // An entirely empty worksheet still validates its first row with field-level errors.
    if(!indices.length)indices.push(0);
    return {indices,items:indices.map(i=>items[i])};
  }
  function calculate(){if(grid.dirty&&!useGrid())return;invalidate();clearErrors();try{const v=read(),prepared=prepareWorksheet(v.items);activeRows=prepared.indices;v.items=prepared.items;const r=core.calculate(v);input=clone(v);result=r;renderResult(r);renderQuote(v.pricing,r);persistDraft();}catch(e){if(e instanceof core.InputError)e.errors=e.errors.map(error=>({...error,path:error.path.replace(/^items\.(\d+)/,(_,n)=>`items.${activeRows[Number(n)]??n}`),message:error.message.replace(/^Line (\d+)/,(_,n)=>`Line ${(activeRows[Number(n)-1]??(Number(n)-1))+1}`)}));showError(e);log(e instanceof core.InputError?'validation_failed':'calculation_failed');}}
  function safeDraft(v){return v&&typeof v.reference==='string'&&v.reference.length<=80&&v.trailer&&Array.isArray(v.items)&&v.items.length>0&&v.items.length<=100&&v.items.every(r=>r&&Object.keys(blank()).filter(k=>k!=='description').every(k=>typeof r[k]===(k==='notStackable'?'boolean':'string')||k!=='notStackable'&&typeof r[k]==='number'));}
  function exportJSON(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function snapshot(){return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),version:core.VERSION,input:clone(input),result:clone(result),...(quote?{quote:clone(quote)}:{}),archived:false,events:[{at:new Date().toISOString(),action:'created'}]};}
  function packageRecords(list){return {format:'sbs-linear-history',schema:1,exportedAt:new Date().toISOString(),records:list};}
  function transaction(mode,action){return new Promise((resolve,reject)=>{if(!db)return reject(new Error('History storage is unavailable. Export the current calculation instead.'));const tx=db.transaction('records',mode),store=tx.objectStore('records');let value;
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(new Error('History could not be saved. Export a backup and retry.'));tx.onabort=()=>reject(new Error(tx.failureMessage||'History operation was cancelled. No changes were committed.'));
    try{action(store,v=>value=v,tx);}catch(e){tx.abort();reject(e);}
  });}
  async function refreshHistory(){if(!db)return;records=await transaction('readonly',(s,done)=>{s.getAll().onsuccess=e=>done(e.target.result);});renderHistory();}
  function renderHistory(){const list=$('lf-history-list');list.replaceChildren();const shown=records.filter(r=>$('lf-show-archive').checked||!r.archived).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(!shown.length)list.append(el('p','No saved calculations in this view.','muted'));
    for(const r of shown){const row=el('div',undefined,'lf-history-item'),text=el('div',`${r.input.reference||'Untitled calculation'} · ${fmt(r.result.adjusted)} ft${r.archived?' · Archived':''}`);text.append(el('small',`${new Date(r.createdAt).toLocaleString()} · ${r.version}`));const actions=el('div');
      const restore=el('button','Load copy');restore.addEventListener('click',()=>{undo=read();apply(clone(r.input));$('lf-undo').hidden=false;calculate();status('Loaded a copy using current rotation rules. The saved snapshot is unchanged.');$('lf-form').scrollIntoView({block:'start'});});
      const archive=el('button',r.archived?'Unarchive':'Archive');archive.addEventListener('click',()=>run(async()=>{await transaction('readwrite',(s,done)=>{const req=s.get(r.id);req.onsuccess=()=>{const current=req.result;if(!current)throw new Error('Record is unavailable.');current.archived=!current.archived;current.events.push({at:new Date().toISOString(),action:current.archived?'archived':'unarchived'});s.put(current);};});await refreshHistory();status('History updated. Archived records remain available.');}));
      actions.append(restore,archive);row.append(text,actions);list.append(row);
    }
  }
  async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){status(e.message||'History unavailable. Export a backup and retry.');log('history_operation_failed');}finally{busy=false;}}
  function validateRecord(r){
    if(!r||!/^[-a-zA-Z0-9]{1,80}$/.test(r.id)||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt))||![core.VERSION,'sterling-lf-54-v1'].includes(r.version)||typeof r.archived!=='boolean'||!Array.isArray(r.events)||!r.events.length||r.events.length>10000)throw new Error('Invalid or unsupported history record. Nothing was imported.');
    if(r.events.some(e=>!['created','archived','unarchived','imported'].includes(e.action)||!Number.isFinite(Date.parse(e.at))))throw new Error('Invalid history event. Nothing was imported.');
    const computed=(r.version==='sterling-lf-54-v1'?core.calculateLegacy:core.calculate)(r.input);
    if(JSON.stringify(computed)!==JSON.stringify(r.result))throw new Error('Saved result does not match its inputs and formula version. Nothing was imported.');
    if(r.quote){const q=window.SBSPartial.calculate(r.input.pricing,computed);if(JSON.stringify(q)!==JSON.stringify(r.quote))throw new Error('Saved partial quote does not match its pricing inputs.');}
    return clone(r);
  }
  async function openHistory(){try{db=await new Promise((resolve,reject)=>{const req=indexedDB.open('sbs-linear-feet-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('records',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Close other calculator tabs, then refresh to enable history.'));});db.onversionchange=()=>{db.close();db=null;status('History changed in another tab. Refresh to reconnect.');};await refreshHistory();status('History ready. Save a result to keep a snapshot.');}catch{status('History storage unavailable. Calculations still work; export each result to keep a copy.');log('history_storage_unavailable');}}
  $('lf-form').addEventListener('submit',e=>{e.preventDefault();calculate();});$('lf-form').addEventListener('input',changed);$('lf-form').addEventListener('change',changed);
  $('lf-add').addEventListener('click',()=>{const v=read();if(v.items.length>=100)return;const firstNew=v.items.length;v.items.push(...Array.from({length:Math.min(10,100-firstNew)},blank));renderRows(v.items);changed();$('lf-lines').children[firstNew].querySelector('input').focus();});
  $('lf-clear').addEventListener('click',()=>{undo=read();apply({reference:'',trailer:core.defaults,items:[blank()]});grid.clear();$('lf-undo').hidden=false;changed();$('lf-result-note').textContent='Calculator cleared. Saved history is unchanged.';});
  $('lf-undo').addEventListener('click',()=>{if(!undo)return;const next=undo;undo=read();apply(next);changed();});
  const grid=window.SBSLinearGrid({changed:invalidate,readTrailer:()=>read().trailer});
  function useGrid(){try{const rows=grid.items();undo=read();const next=read();next.items=rows;apply(next);grid.applied();$('lf-undo').hidden=false;changed();return true;}catch(e){grid.error(e.message);return false;}}
  $('lf-apply-paste').addEventListener('click',()=>{if(useGrid())calculate();});
  $('lf-save').addEventListener('click',()=>run(async()=>{if(!result||quoteError)return;const savedResult=result,row=snapshot();await transaction('readwrite',(s,done,tx)=>{const req=s.count();req.onsuccess=()=>{if(req.result>=1000){tx.failureMessage='History holds 1,000 records. Export this calculation and keep your backups externally.';tx.abort();return;}s.add(row);};});await refreshHistory();status('Calculation saved. Archive keeps it recoverable; export a backup for another browser.');if(result===savedResult)$('lf-save').disabled=true;}));
  $('lf-export-current').addEventListener('click',()=>{if(result&&!quoteError)exportJSON(packageRecords([snapshot()]),'rain-maker-linear-calculation.json');});
  $('lf-copy').addEventListener('click',async()=>{if(!result||quoteError)return;try{await navigator.clipboard.writeText(`SBS Rain Maker — Linear Ft\n${input.reference?input.reference+'\n':''}Workbook adjusted: ${fmt(result.adjusted)} ft\nTheoretical: ${fmt(result.theoretical)} ft\nWhole-row planning space (before factor): ${fmt(result.wholeRow)} ft\n${result.pieces} pieces; ${fmt(result.weight)} lb\nChargeable weight: ${core.chargeableWeight(result,input.dimFactor??194).chargeable.toLocaleString('en-US')} lb (dim factor ${input.dimFactor??194}; actual cargo cube)\nDensity: ${fmt(core.freightSummary(result).density)} lb/cu ft\nFreight class estimate: Class ${core.freightSummary(result).freightClass} (supplied NMFC.pdf table; confirm NMFC item and carrier class)\nTrailer: ${result.trailer.width} in wide × ${result.trailer.height} in high × ${result.trailer.length} ft long; safety factor ${result.trailer.factor}\nWorkbook 54-in stacking rules; automatic floor rotation per line; no mixed-line packing. Confirm carrier load plan.\n${result.warnings.join('\n')}\n${quoteText()}`);$('lf-result-note').textContent='Result copied. Nothing was sent.';}catch{$('lf-result-note').textContent='Clipboard unavailable. Export the calculation instead.';log('clipboard_unavailable');}});
  $('lf-show-archive').addEventListener('change',renderHistory);
  $('lf-export-history').addEventListener('click',()=>run(async()=>{await refreshHistory();if(!db)throw new Error('Cannot read history. Refresh or export the current calculation.');exportJSON(packageRecords(records),'rain-maker-linear-history.json');status(`Exported ${records.length} saved records, including archives.`);}));
  $('lf-import').addEventListener('change',()=>run(async()=>{const file=$('lf-import').files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('Backup exceeds 5 MB. Nothing was imported.');let data;try{data=JSON.parse(await file.text());}catch{throw new Error('Not valid JSON. Nothing was imported.');}if(data.format!=='sbs-linear-history'||data.schema!==1||!Array.isArray(data.records)||data.records.length>1000)throw new Error('Unsupported backup. Nothing was imported.');
    const incoming=data.records.map(validateRecord);if(new Set(incoming.map(r=>r.id)).size!==incoming.length)throw new Error('Duplicate IDs in backup. Nothing was imported.');
    await transaction('readwrite',(s,done,tx)=>{const req=s.getAll();req.onsuccess=()=>{const existing=new Map(req.result.map(r=>[r.id,r]));const additions=incoming.filter(r=>!existing.has(r.id));const conflict=incoming.some(r=>existing.has(r.id)&&JSON.stringify(existing.get(r.id))!==JSON.stringify(r));if(conflict||existing.size+additions.length>1000){tx.failureMessage=conflict?'Conflicting record IDs. Nothing was imported.':'History limit is 1,000 records. Keep this backup externally.';tx.abort();return;}additions.forEach(r=>s.add(r));};});await refreshHistory();status('Backup restored. Identical records were skipped.');$('lf-import').value='';}));
  renderRows([blank()]);renderMetrics(null);
  try{const saved=sessionStorage.getItem(draftKey);if(saved){const d=JSON.parse(saved);if(d.schema!==1||!safeDraft(d.value))throw new Error();apply(d.value);$('lf-draft-status').textContent='Draft recovered. Calculate to review current results.';}}catch{log('draft_recovery_failed');$('lf-draft-status').textContent='The previous draft could not be recovered. Saved history is separate.';}
  window.SBSLinearImport=Object.freeze({schemaVersion:1,stageText(text){grid.stage(text);return {requiresReview:true};},stageItems(shipment){
    if(!shipment||!Array.isArray(shipment.items)||!shipment.items.length||shipment.items.length>100)throw Error('No usable freight rows.');
    undo=read();const next=read();next.items=clone(shipment.items);next.reference=String(shipment.subject||'Freight email').slice(0,80);
    apply(next);grid.applied();$('lf-undo').hidden=false;changed();
    $('lf-result-note').textContent='Email freight loaded. Review the dimensions, quantity, weight and stackability, then calculate.';
    $('lf-freight-title').scrollIntoView({block:'start'});return {requiresReview:true};
  }});
  openHistory();
})();
