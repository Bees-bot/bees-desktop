export const ORGANIZATION_ICONS = [
  ['organization','Building'], ['personal','Home'], ['team','People'], ['goal','Target'],
  ['chat','Chat'], ['file','Document'], ['process','Workflow'], ['star','Star'],
];
export const ORGANIZATION_COLORS = [
  ['Slate','#64748b'], ['Blue','#2563eb'], ['Violet','#7c3aed'], ['Pink','#db2777'],
  ['Red','#dc2626'], ['Orange','#ea580c'], ['Yellow','#eab308'], ['Green','#16a34a'],
];
export function validOrganizationAppearance(value){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['icon','color','image'].includes(key))
    &&ORGANIZATION_ICONS.some(([id])=>id===value.icon)&&typeof value.color==='string'&&/^#[\da-f]{6}$/i.test(value.color)
    &&(value.image===undefined||typeof value.image==='string'&&value.image.length<=128_000&&/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.image));
}
export function iconForeground(color){
  const rgb=[1,3,5].map(start=>parseInt(color.slice(start,start+2),16));
  return rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>160?'#182018':'#ffffff';
}
