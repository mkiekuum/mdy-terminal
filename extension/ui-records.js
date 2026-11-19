export function setupRecordsPanel(document, read) {
 const $=id=>document.getElementById(id);
 let rows=[],generation=0;
 function render(){
  const selected=$('recordChoice').value, query=$('recordSearch').value.trim().toLocaleLowerCase();
  $('recordChoice').replaceChildren(new Option('选择修改对象',''));
  for(const row of rows){
   const label=[row.number,row.shortName||row.title||row.payload?.shortName||row.payload?.subject,row.owner||row.applicant,row.status].filter(Boolean).join(' · ');
   if(label.toLocaleLowerCase().includes(query))$('recordChoice').add(new Option(label,row.id));
  }
  $('recordChoice').value=selected;
 }
 async function refresh(){
  const domain=$('workDomain').value, token=++generation;
  $('recordStatus').textContent='读取中…';
  try{
   const result=await read('records.'+domain);
   if(token!==generation||domain!==$('workDomain').value)return;
   if(!Array.isArray(result))throw Error('记录列表格式已变化');
   rows=result;render();$('recordStatus').textContent=rows.length+' 条记录';
  }catch(error){if(token===generation){rows=[];render();$('recordStatus').textContent=error.message;}}
 }
 $('workDomain').onchange=()=>{generation++;rows=[];render();$('recordsPanel').hidden=$('workDomain').value==='plan';if(!$('recordsPanel').hidden)refresh();};
 $('refreshRecords').onclick=refresh;
 $('recordSearch').oninput=render;
 return async()=>{
  const domain=$('workDomain').value,id=$('recordChoice').value;
  const [meta,latest]=await Promise.all([read('records.meta'),read('records.'+domain)]);
  if(domain!==$('workDomain').value||id!==$('recordChoice').value)throw Error('选择已变化，请重新复制');
  const selected=id?latest.find(row=>row.id===id):null;
  if(id&&!selected)throw Error('所选记录已不存在，请刷新');
  return {complete:true,domain,meta,selected,records:latest,instructions:'根据需求使用 records 指令。修改必须确认具体记录，并携带最新完整 before。新建返回 pending 时说明等待审核；项目任务记录的历史恢复尚未支持。'};
 };
}
