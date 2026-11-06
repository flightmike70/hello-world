(() => {
  'use strict';
  window.SBSLinearGrid=({changed,readTrailer})=>{
    const $=id=>document.getElementById(id), fields=['quantity','length','width','height','weight','stack'];
    let rows=[Array(6).fill('')],dirty=false;
    const message=t=>$('lf-paste-status').textContent=t;
    const numeric=(s,col)=>{
      const suffix=col===4?/\s*(?:lbs?|pounds?)\s*$/i:/\s*(?:inches|inch|in|\")\s*$/i;
      const v=String(s).trim().replace(suffix,'');
      if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(v))return null;
      const n=Number(v.replaceAll(',',''));return Number.isFinite(n)&&n>0&&(col!==0||Number.isInteger(n))?String(n):null;
    };
    const stack=s=>/^(?:nonstack|non[- ]?stackable|not stackable)$/i.test(s)?true:/^(?:stackable|auto|)$/i.test(s)?false:null;
    function touched(){dirty=true;changed();try{sessionStorage.setItem('sbs-linear-paste-grid',JSON.stringify(rows));}catch{}message('Grid changed. Use grid & calculate, or Calculate space & quote, to replace the worksheet.');}
    function focus(r,c){$('lf-paste-lines').children[r]?.querySelectorAll('input')[c]?.focus();}
    function render(){
      $('lf-paste-lines').replaceChildren();
      rows.forEach((row,r)=>{const tr=document.createElement('tr'),th=document.createElement('th');th.textContent=r+1;th.scope='row';tr.append(th);
        row.forEach((v,c)=>{const td=document.createElement('td'),f=document.createElement('input');f.type='text';f.value=v;f.dataset.row=r;f.dataset.col=c;f.setAttribute('aria-label',`Paste row ${r+1} ${fields[c]}`);if(c<5)f.inputMode='decimal';else f.placeholder='Auto';f.addEventListener('input',()=>{rows[r][c]=f.value;f.removeAttribute('aria-invalid');touched();});td.append(f);tr.append(td);});
        const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.textContent='×';b.className='lf-remove';b.setAttribute('aria-label',`Delete paste row ${r+1}`);b.onclick=()=>{rows.splice(r,1);if(!rows.length)rows=[Array(6).fill('')];touched();render();focus(Math.min(r,rows.length-1),0);};td.append(b);tr.append(td);$('lf-paste-lines').append(tr);
      });$('lf-paste-add').disabled=rows.length>=100;
    }
    function paste(text,r,c){
      if(text.length>20000)throw Error('Paste is too large. Use at most 100 rows and 20,000 characters.');
      let matrix=text.replace(/\r\n?/g,'\n').replace(/\n+$/,'').split('\n').map(line=>line.split('\t'));
      if(matrix[0]?.[0].trim().toLowerCase()==='qty')matrix.shift();
      if(!text.includes('\t')&&/[x×@]/i.test(text)){
        matrix=window.SBSLinear.parseText(text).map(item=>[item.quantity,...['length','width','height'].map(k=>item[k]===''?'':String(Number(item[k])*window.SBSLinear.units[item.unit])),item.weight,item.notStackable?'Nonstack':'Auto']);c=0;
      }
      if(r+matrix.length>100||matrix.some(line=>line.length+c>6))throw Error('Nothing pasted. Maximum 100 rows and 6 columns: Qty, Length, Width, Height, Weight, Stackable / Nonstack.');
      while(rows.length<r+matrix.length)rows.push(Array(6).fill(''));
      matrix.forEach((line,i)=>line.forEach((v,j)=>rows[r+i][c+j]=v.trim()));touched();render();validate(false);focus(r,c);
    }
    function validate(required){
      const items=[],errors=[];
      rows.forEach((row,r)=>{if(row.every(v=>!v.trim()))return;const item={description:'',unit:'in',maxStack:''};
        row.forEach((v,c)=>{const n=c===5?stack(v.trim()):numeric(v,c);const input=$('lf-paste-lines').children[r].querySelectorAll('input')[c];input.removeAttribute('aria-invalid');if(n===null){input.setAttribute('aria-invalid','true');errors.push(`Row ${r+1}: ${fields[c]} ${c===5?'must be Auto, Stackable or Nonstack':'needs a positive '+(c===0?'whole number':'number')}.`);}else item[c===5?'notStackable':fields[c]]=n;});items.push(item);
      });
      if(required&&!items.length)errors.push('Enter at least one freight row.');
      if(errors.length){const missingWeights=rows.filter(row=>row.some(v=>v.trim())&&!row[4].trim()).length;message(!required&&errors.length===missingWeights?('Pasted '+items.length+' rows. Add weight per piece in the highlighted Weight cells before calculating.'):errors.join(' '));if(required)throw Error(errors.join(' '));}
      if(required)window.SBSLinear.calculate({reference:'',trailer:readTrailer(),items});return items;
    }
    $('lf-paste-lines').addEventListener('paste',e=>{const f=e.target;if(!f.dataset.row)return;e.preventDefault();try{paste(e.clipboardData.getData('text/plain'),Number(f.dataset.row),Number(f.dataset.col));}catch(error){message(error.message);}});
    $('lf-paste-lines').addEventListener('keydown',e=>{if(!['Tab','Enter'].includes(e.key)||!e.target.dataset.row)return;let r=Number(e.target.dataset.row),c=Number(e.target.dataset.col);const step=e.shiftKey?-1:1;if(e.key==='Enter')r+=step;else{c+=step;if(c>5){r++;c=0;}if(c<0){r--;c=5;}}if(r<0||r>=100)return;if(r>=rows.length){rows.push(Array(6).fill(''));render();}e.preventDefault();focus(r,c);});
    $('lf-paste-add').onclick=()=>{const r=rows.length;rows.push(...Array.from({length:Math.min(10,100-r)},()=>Array(6).fill('')));render();focus(r,0);};
    function clear(){rows=[Array(6).fill('')];dirty=false;try{sessionStorage.removeItem('sbs-linear-paste-grid');}catch{}render();message('Grid cleared.');}
    $('lf-paste-clear').onclick=clear;
    $('lf-paste-copy').onclick=async()=>{try{await navigator.clipboard.writeText(['Qty\tLength (in)\tWidth (in)\tHeight (in)\tWeight (lb each)\tStackable / Nonstack',...rows.filter(r=>r.some(v=>v.trim())).map(r=>r.join('\t'))].join('\n'));message('Grid copied. Paste into Excel.');}catch{message('Clipboard unavailable. Select and copy individual cells.');}};
    try{const saved=JSON.parse(sessionStorage.getItem('sbs-linear-paste-grid'));if(Array.isArray(saved)&&saved.length&&saved.length<=100&&saved.every(r=>Array.isArray(r)&&r.length===6&&r.every(v=>typeof v==='string'))){rows=saved;dirty=true;}}catch{}
    render();return {get dirty(){return dirty;},items:()=>validate(true),clear,error:message,applied(){dirty=false;try{sessionStorage.removeItem('sbs-linear-paste-grid');}catch{}message('Grid applied. Results use the existing workbook calculation.');},stage(text){paste(text,0,0);$('lf-paste-panel').open=true;}};
  };
})();

