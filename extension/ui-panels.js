export function setupToolPanels(doc,onChange=()=>{}){
 const button=doc.getElementById('moreToggle'),panel=doc.getElementById('moreDetails');
 button.onclick=()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));onChange(panel.hidden?null:panel.id);};
}
