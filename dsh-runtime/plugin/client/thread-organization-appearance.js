import {h,useState} from './runtime.js';
import {ORGANIZATION_ICONS,ORGANIZATION_COLORS,validOrganizationAppearance,iconForeground} from '../lib/organization-appearance.js';

export function OrganizationIcon({organization,icon}){
  const appearance=organization.appearance;
  return validOrganizationAppearance(appearance)?h('span',{className:'bc-org-symbol',style:{background:appearance.image?'transparent':appearance.color,color:iconForeground(appearance.color)}},appearance.image?h('img',{src:appearance.image,alt:''}):icon(appearance.icon)):icon('organization');
}

export async function readOrganizationImage(file){
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('Choose a PNG, JPEG, WebP or GIF image');
  if(file.size>5_000_000)throw Error('Choose an image smaller than 5 MB');
  const bitmap=await createImageBitmap(file);
  try{
    const canvas=document.createElement('canvas'),scale=Math.min(1,128/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/png');
  }finally{bitmap.close();}
}

export function OrganizationAppearance({organization,icon,busy,onSave}){
  const [appearance,setAppearance]=useState(organization.appearance??{icon:'organization',color:'#64748b'}),[saved,setSaved]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState('');
  const change=values=>{setAppearance(current=>{const next={...current,...values};if(next.image===null)delete next.image;return next;});setSaved(false);setError('');};
  return h('form',{className:'bc-org-appearance',onSubmit:async event=>{event.preventDefault();setSaved(false);setSaved(await onSave(appearance)===true);}},
    h('h3',null,'Org icon'),h('p',{className:'bc-muted'},'Customize this organization on this device.'),
    h('div',{className:'bc-org-preview'},h(OrganizationIcon,{organization:{appearance},icon}),h('strong',null,organization.name)),
    h('label',{className:'bc-field'},'Upload your own icon',h('input',{type:'file',accept:'image/png,image/jpeg,image/webp,image/gif',disabled:busy||uploading,onChange:async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setUploading(true);setError('');try{change({image:await readOrganizationImage(file)});}catch(e){setError(e.message||'Could not read this image');}finally{setUploading(false);}}}),h('small',{className:'bc-muted'},'PNG, JPEG, WebP or GIF, up to 5 MB.')),
    appearance.image?h('button',{type:'button',disabled:busy||uploading,onClick:()=>change({image:null})},'Remove uploaded icon'):null,
    error?h('p',{role:'alert'},error):null,
    h('fieldset',{disabled:busy||uploading},h('legend',null,'Icon'),h('div',{className:'bc-org-icons'},ORGANIZATION_ICONS.map(([id,name])=>h('button',{key:id,type:'button',title:name,'aria-label':name+' icon','aria-pressed':!appearance.image&&appearance.icon===id,onClick:()=>change({icon:id,image:null})},icon(id))))),
    h('fieldset',{disabled:busy||uploading||!!appearance.image},h('legend',null,'Icon color'),h('div',{className:'bc-org-colors'},ORGANIZATION_COLORS.map(([name,color])=>h('button',{key:color,type:'button',title:name,'aria-label':name+' icon color','aria-pressed':appearance.color.toLowerCase()===color,onClick:()=>change({color}),style:{background:color,color:iconForeground(color)}},appearance.color.toLowerCase()===color?icon('check'):null)),
      h('label',{className:'bc-custom-color'},'Custom',h('input',{type:'color','aria-label':'Custom icon color',value:appearance.color,disabled:busy,onChange:event=>change({color:event.target.value})})))),
    h('div',{className:'bc-actions'},h('button',{className:'bc-primary',disabled:busy||uploading,type:'submit'},uploading?'Reading image…':'Save icon'),saved?h('small',{role:'status'},'Icon saved.'):null));
}
