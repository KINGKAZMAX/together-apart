const pages={};
figma.currentPage.name='00 · Overview';pages.overview=figma.currentPage.id;
for(const [key,name]of Object.entries({foundations:'01 · Foundations',components:'02 · Components',desktop:'03 · Desktop · EN & 中文',mobile:'04 · Mobile',characters:'05 · Characters & Sources',flows:'06 · Flows & Motion'})){const p=figma.createPage();p.name=name;pages[key]=p.id;}
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync(pages.foundations));
// Adapted from createVariableCollection.js; semantic aliases retain source CSS names.
const primitive=figma.variables.createVariableCollection('Together Apart · Primitives');primitive.renameMode(primitive.defaultModeId,'Light');
const semantic=figma.variables.createVariableCollection('Together Apart · Semantic');semantic.renameMode(semantic.defaultModeId,'Light');
const variables={};
for(const [key,hex]of Object.entries(C)){
 const v=figma.variables.createVariable('palette/'+key,primitive,'COLOR');v.scopes=[];v.setValueForMode(primitive.defaultModeId,rgb(hex));v.setVariableCodeSyntax('WEB',`var(--ta-${key})`);variables[v.name]=v.id;
 const s=figma.variables.createVariable('semantic/'+({greenLight:'green-light'}[key]||key),semantic,'COLOR');s.scopes=['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR'];s.setValueForMode(semantic.defaultModeId,{type:'VARIABLE_ALIAS',id:v.id});s.setVariableCodeSyntax('WEB',`var(--${({greenLight:'green-light'}[key]||key)})`);variables[s.name]=s.id;vars.push(s);
}
for(const [prefix,values,scopes]of [['space',[4,8,12,16,20,24,32,48,56],['GAP']],['radius',[4,6,7,8,12],['CORNER_RADIUS']]])for(const val of values){const v=figma.variables.createVariable(`${prefix}/${val}`,primitive,'FLOAT');v.scopes=scopes;v.setValueForMode(primitive.defaultModeId,val);v.setVariableCodeSyntax('WEB',`var(--ta-${prefix}-${val})`);variables[v.name]=v.id;}
for(const [size,weight]of [[10,'Regular'],[11,'Medium'],[12,'Regular'],[14,'Regular'],[16,'Regular'],[18,'Medium'],[24,'Medium'],[40,'Medium'],[64,'Medium']]){const s=figma.createTextStyle();s.name=`Type/${size}/${weight}`;s.fontName={family:'Inter',style:weight};s.fontSize=size;s.lineHeight={unit:'PERCENT',value:145};}
const shadow=figma.createEffectStyle();shadow.name='Elevation/Dialog';shadow.effects=[{type:'DROP_SHADOW',color:{r:.094,g:.133,b:.09,a:.18},offset:{x:0,y:24},radius:70,spread:0,visible:true,blendMode:'NORMAL'}];
const root=doc('Foundations board','A quiet framework for connection.','The live product uses warm paper, forest green, restrained borders and open spacing. These tokens are extracted from the implementation; Inter is the primary family.');
const colors=section(root,'01 / Color','Semantic colors alias primitives. Source CSS variables remain named --green, --green-light, --ink, --muted, --line and --paper.');
const row=stack(colors,'Core palette',1328,16,null,true);
for(const key of ['paper','green','greenLight','ink','muted','line']){const c=card(row,'Color / '+key,208);rect(c,'Swatch',160,88,key,6);text(c,key,16,'ink','Medium');text(c,C[key].toUpperCase(),12,'muted');}
const type=section(root,'02 / Typography','Inter follows the application font stack. 中文 uses Noto Sans SC as the available Figma substitute for the browser’s PingFang SC fallback.');
for(const [size,label]of [[40,'Display · A little closer, together.'],[24,'Section · The studio'],[18,'Subheading · Choose a character'],[14,'Body · Your movements become reactions.'],[12,'UI · Enable camera gestures'],[10,'Caption · Recognition runs on your device.']])text(type,label,size,size<=12?'muted':'ink',size>=18?'Medium':'Regular',1280);
text(type,'中文界面 · 在工作室见面，让回应被看见。',24,'ink','Medium',1280);
const layout=section(root,'03 / Layout & rhythm');
const lr=stack(layout,'Layout specs',1328,24,null,true);
for(const [h,b]of [['Desktop','1440 × 900 reference\nHeader 64 · rail 60 · sidebar 302\nFooter 92 · flexible 3D stage'],['Mobile','390 × 844 reference\nHeader 57 · rail 48 · footer 126\nSidebar overlays the stage'],['Spacing & geometry','4 / 8 / 12 / 16 / 20 / 24 / 32 / 48\nControls 42 px · small buttons 33 px\nRadii 4 / 6 / 7 / 8 / 12']]){const c=card(lr,h,426);text(c,h,18,'ink','Medium');text(c,b,14,'muted','Regular',378);}
const access=section(root,'04 / Implementation notes','Focus rings remain visible. Modal content traps Tab and restores focus. Reduced-motion preferences remove interface transitions. Extracted muted colors are documented faithfully; contrast should be checked when repurposed for body copy.');
return finish({pages,variables,collections:{primitive:primitive.id,semantic:semantic.id},styles:(await figma.getLocalTextStylesAsync()).map(s=>({id:s.id,name:s.name})),board:root.id,mutatedNodeIds:[pages.overview]});
