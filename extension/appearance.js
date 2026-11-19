export async function setupAppearance(doc, storage) {
 const controls = {theme:doc.getElementById('themeChoice'),density:doc.getElementById('densityChoice')};
 const allowed = {theme:['auto','light','dark'],density:['comfortable','compact']};
 const key = 'terminalAppearance';
 function apply(value = {}) {
  for (const field of Object.keys(controls)) {
   const selected = allowed[field].includes(value[field]) ? value[field] : allowed[field][0];
   controls[field].value = selected;
   doc.documentElement.dataset[field] = selected;
  }
 }
 apply((await storage.get(key))[key]);
 for (const control of Object.values(controls)) control.onchange = async () => {
  const value = {theme:controls.theme.value,density:controls.density.value};
  try { await storage.set({[key]:value}); apply(value); }
  catch { doc.getElementById('message').textContent = '外观设置保存失败，请重试。'; }
 };
}
