/* v0.6: WhatsApp Web DOM adapter, marker-based visible-chat capture.
   Uses only rendered messages. No hidden WhatsApp APIs, no automatic posting. */
let busy=false,lastCheck=0,lastError='';
const norm=s=>(s||'').replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g,'').trim();
function activeChat(){
 const header=document.querySelector('#main header');if(!header)return '';
 const banned=/^(Informations du profil|Profile details|Contact info|Infos du groupe|Group info|Rechercher|Search|Menu)$/i;
 for(const sel of ['[data-testid="conversation-info-header-chat-title"]','[title][dir="auto"]','span[dir="auto"]'])for(const el of header.querySelectorAll(sel)){
  const text=norm(el.textContent);if(text&&text.length<130&&!banned.test(text)&&!/^en ligne|^online|^vu à|^last seen/i.test(text))return text;
 }return '';
}
function inMain(el){return !!(el&&el.closest('#main')&& !el.closest('#main header,#main footer'));}
function rows(){
 const root=document.querySelector('#main');if(!root)return [];
 // Anchor on individual message elements. NEVER choose broad ancestors: they
 // can swallow an entire chat, misclassifying incoming media as outgoing.
 const nodes=[...root.querySelectorAll('.message-in,.message-out,[data-testid="msg-container"],[data-id^="true_"],[data-id^="false_"],[data-pre-plain-text]')].filter(inMain);
 const unique=new Set();
 for(const el of nodes){
  let row=el.closest('.message-in,.message-out');
  if(!row){
   const id=el.closest('[data-id^="true_"],[data-id^="false_"]');
   row=id||el.closest('[data-testid="msg-container"]')||el;
  }
  if(row&&inMain(row))unique.add(row);
 }
 // Extra fallback for WhatsApp media variations. Find the smallest bounded
 // card around visible media, never a wrapper containing multiple messages.
 for(const img of root.querySelectorAll('img')){
  if(img.getBoundingClientRect().width<100||!inMain(img))continue;
  let row=img.closest('.message-in,.message-out,[data-id^="true_"],[data-id^="false_"],[data-testid="msg-container"]');
  if(!row){
   let p=img.parentElement;
   for(let i=0;p&&i<6;i++,p=p.parentElement){
    if(p.querySelector('[data-pre-plain-text]')||p.querySelector('.selectable-text')){row=p;break}
   }
  }
  if(row&&inMain(row))unique.add(row);
 }
 const arr=[...unique];
 // Skip ancestors which include multiple already isolated message cards.
 const atomic=arr.filter(el=>!arr.some(other=>other!==el&&el.contains(other)&&
  (other.matches('.message-in,.message-out,[data-id^="true_"],[data-id^="false_"]'))));
 return atomic.sort((a,b)=>a===b?0:(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1));
}
function direction(el){
 const id=el.getAttribute('data-id')||el.querySelector('[data-id]')?.getAttribute('data-id')||'';
 if(/^true_/.test(id))return 'out';if(/^false_/.test(id))return 'in';
 const classEl=el.matches('.message-out,.message-in')?el:el.closest('.message-out,.message-in');
 if(classEl?.classList.contains('message-out'))return 'out';
 if(classEl?.classList.contains('message-in'))return 'in';
 const pre=el.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')||'';
 // Incoming pre-plain-text often includes sender after timestamp, but this is only a hint.
 if(/\]\s*[^\]\n]{1,100}:\s*$/.test(pre))return 'in';
 return 'unknown';
}
function messageText(el){
 const values=[];
 for(const selector of ['.selectable-text','[data-testid="msg-text"]','[data-testid="media-caption"]','[data-testid="image-caption"]','[data-testid*="caption"]']){
  for(const e of el.querySelectorAll(selector)){
   if(e.closest('footer,header'))continue;
   const v=norm(e.innerText||e.textContent);
   if(v&&!values.some(x=>x===v||x.includes(v)))values.push(v);
  }
 }
 if(values.length)return values.join('\n').trim();
 const e=el.querySelector('[data-testid*="caption"],.caption');return norm(e?.innerText||e?.textContent||'');
}
function isMarker(el){
 if(direction(el)==='in')return false;
 const v=messageText(el).replace(/[\s\u00a0\u200e\u200f]/g,'');
 if(v==='.'||v==='．')return true;
 // Fallback for bare dot bubbles without .selectable-text; only inspect leaf
 // elements, so dots from image captions/other messages cannot qualify.
 const leaves=[...el.querySelectorAll('span,div')].filter(x=>x.children.length===0);
 return leaves.some(x=>/^[.．]$/.test(norm(x.textContent)));
}
function imageCandidates(el){
 return [...el.querySelectorAll('img')].filter(img=>{
  const r=img.getBoundingClientRect();const w=Math.max(img.naturalWidth||0,r.width||0),h=Math.max(img.naturalHeight||0,r.height||0);
  return w>=100&&h>=100&&!img.closest('footer,header')&&!!(img.currentSrc||img.src);
 }).sort((a,b)=>(b.naturalWidth*b.naturalHeight)-(a.naturalWidth*a.naturalHeight));
}
function idFor(el,index){
 // Time metadata ([09:06] Contact:) is NOT unique when two media messages
 // arrive in the same minute. Never use it alone as a message identifier.
 const dataId=el.getAttribute('data-id')||el.querySelector('[data-id^="false_"],[data-id^="true_"]')?.getAttribute('data-id');
 if(dataId)return dataId;
 const stamp=el.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')||'';
 const title=messageText(el);
 const media=imageCandidates(el)[0];
 const source=media?.currentSrc||media?.src||'';
 const payload=stamp+'\u241f'+title+'\u241f'+source+'\u241f'+index;
 // Fast deterministic fingerprint, stable during a normal loaded chat.
 let h1=2166136261,h2=2166136261;
 for(let j=0;j<payload.length;j++){h1=Math.imul(h1^payload.charCodeAt(j),16777619);h2=Math.imul(h2^payload.charCodeAt(payload.length-j-1),16777619)}
 return 'media-'+(h1>>>0).toString(16)+'-'+(h2>>>0).toString(16);
}
async function toData(img){
 const src=img.currentSrc||img.src;
 if(!src)throw Error('الصورة بلا رابط src');
 let blob;
 try {
  const response=await fetch(src,{credentials:'include'});
  if(!response.ok)throw Error('HTTP '+response.status);
  blob=await response.blob();
 }catch(fetchError){
  // Some WhatsApp images cannot be re-fetched. A drawn decoded thumbnail
  // is a fallback; a tainted canvas throws and is reported explicitly.
  try {
   if(!img.complete)await img.decode();
   const canvas=document.createElement('canvas');
   canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
   if(!canvas.width||!canvas.height)throw Error('الصورة لم تكتمل');
   canvas.getContext('2d').drawImage(img,0,0);
   blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(Error('canvas empty')),'image/png'));
  }catch(canvasError){throw Error('ما قدرناش ناخدو الصورة: fetch '+fetchError.message+' / canvas '+canvasError.message)}
 }
 if(!blob.type.startsWith('image/'))throw Error('المصدر ماشي صورة: '+blob.type);
 if(blob.size>12*1024*1024)throw Error('الصورة كبيرة بزاف ('+Math.round(blob.size/1024/1024)+'MB)');
 return await new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>fail(Error('تعذر قراءة الصورة'));r.readAsDataURL(blob)});
}
const captureStatus=async(message)=>{try{await chrome.storage.local.set({captureStatus:{message,time:new Date().toLocaleTimeString()}})}catch(e){console.warn(e)}};
async function relay(draft){return chrome.runtime.sendMessage({type:'RELAY_DRAFT',draft})}
// Dot marker may be a plain text bubble absent from older message selectors.
// Read the DOM in document order and use the latest visible dot. This does
// not require the message direction class, which differs by WhatsApp build.
function dotElement(){
 const root=document.querySelector('#main');if(!root)return null;
 const candidates=[...root.querySelectorAll('.selectable-text span, [data-testid="msg-text"] span, .copyable-text span, [dir="auto"]')];
 return candidates.filter(el=>{const value=norm(el.textContent).replace(/[\s\u00a0]/g,'');
   return (value==='.'||value==='．') && ![...el.children].some(child=>norm(child.textContent)==='.');
 }).filter(inMain).sort((a,b)=>a===b?0:(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1)).pop()||null;
}
function afterMarker(el,marker){
 if(!marker)return false;
 return !!(marker.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING);
}
function markerId(dot){
 if(!dot)return null;
 const row=dot.closest('.message-in,.message-out,[data-id^="true_"],[data-id^="false_"],[data-testid="msg-container"]');
 const dataId=row?.getAttribute('data-id')||row?.querySelector('[data-id]')?.getAttribute('data-id');
 if(dataId)return dataId;
 const pre=row?.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')||'';
 // Dot element may be recreated; timestamp+chat+nearby outgoing element keeps a consistent baseline.
 const path=[];let el=row||dot;
 for(let j=0;j<5&&el?.parentElement;j++,el=el.parentElement){path.push([...el.parentElement.children].indexOf(el))}
 return 'dot:'+pre+':'+path.join('.');
}
function snapshot(){
 const list=rows();const dot=dotElement();const mark=Math.max(-1,...list.map((n,i)=>isMarker(n)?i:-1));
 // Rely on DOM order after explicit user-sent dot, rather than broken in/out flags.
 const after=dot?list.filter(n=>afterMarker(n,dot)&&!n.contains(dot)):mark>=0?list.slice(mark+1):[];
 const media=after.filter(n=>imageCandidates(n).length);const titled=after.filter(n=>messageText(n));
 return {list,dotId:dot?markerId(dot):(mark>=0?"fallback:"+idFor(list[mark],mark):null),mark:dot?0:mark,after,media,titled,ready:after.filter(n=>imageCandidates(n).length&&messageText(n)),dots:dot?1:list.filter(isMarker).length,outs:list.filter(n=>direction(n)==='out').length,unknown:list.filter(n=>direction(n)==='unknown').length,allImages:list.filter(n=>imageCandidates(n).length).length,allCaption:list.filter(n=>messageText(n)).length,rawImgs:[...document.querySelectorAll('#main img')].filter(im=>im.getBoundingClientRect().width>=100).length,samples:list.slice(-12).map((n,i)=>({i,dir:direction(n),id:(n.getAttribute('data-id')||n.querySelector('[data-id]')?.getAttribute('data-id')||'').slice(0,32),cls:(n.className?.toString()||'').slice(0,70),text:messageText(n).slice(0,36),imgs:imageCandidates(n).length,dot:isMarker(n)}))};
}
async function scan(){
 if(busy)return {count:0,error:'الفحص السابق مازال خدام'};
 busy=true;let count=0;lastError='';
 try{
  const s=await chrome.storage.local.get({enabled:true,chats:[],chat:'',seen:[]});const name=activeChat(),allowed=s.chats.length?s.chats:(s.chat?[s.chat]:[]);
  if(!s.enabled)return {count:0,error:'المراقبة متوقفة'};
  if(!allowed.includes(name))return {count:0,error:'هاد المحادثة ماشي فاللائحة: '+name};
  const snap=snapshot();if(snap.mark<0)return {count:0,error:'ما لقيناش النقطة . (رسائل: '+snap.list.length+'، صور ظاهرة: '+snap.rawImgs+'). صيفط نقطة بوحدها.'};if(!snap.ready.length)await captureStatus('النقطة موجودة، ولكن ما كايناش صورة بعنوان من بعدها');
  // One marker is one import epoch. No data before the latest dot is eligible.
  // A new dot begins a fresh epoch even if the previous messages remain visible.
  const epoch=name+'|'+snap.dotId;
  const seen=new Set(s.seen);
  for(const el of snap.ready){
   const index=snap.list.indexOf(el),id=epoch+'|'+idFor(el,index);if(seen.has(id))continue;
   try{
    const title=messageText(el);await captureStatus('وجدت الصورة والعنوان: '+title.slice(0,70)+'؛ جاري استخراج الصورة');const image=await toData(imageCandidates(el)[0]);await captureStatus('الصورة تقرات ('+Math.round(image.length/1024)+' KB)؛ جاري الإرسال لـ Prepost');const rawBytes=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));const imageHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',rawBytes))].map(x=>x.toString(16).padStart(2,'0')).join('');const res=await relay({id,title,image,chat:name,imageHash});
    if(!res?.ok)throw Error(res?.error||'تعذر إرسال المسودة إلى Prepost');seen.add(id);count++;await captureStatus('وصل الخبر لـ Prepost وتمت إضافته للانتظار: '+title.slice(0,70));
   }catch(err){lastError=err.message;await captureStatus('خطأ: '+lastError);console.warn('WhatsApp capture failed',err);break}
  }
  await chrome.storage.local.set({seen:[...seen].slice(-900)});return {count,error:lastError};
 }catch(e){lastError=e.message;return {count,error:e.message}}
 finally{busy=false;lastCheck=Date.now()}
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(m.type==='GET_CHAT'){reply({chat:activeChat()});return}
 if(m.type==='STATUS'){
  Promise.all([chrome.storage.local.get({chats:[],seen:[]}),Promise.resolve(snapshot())]).then(([st,v])=>reply({chat:activeChat(),allowed:st.chats.includes(activeChat()),total:v.list.length,outgoing:v.outs,unknown:v.unknown,rawImgs:v.rawImgs,samples:v.samples,allImages:v.allImages,allCaption:v.allCaption,dots:v.dots,marker:v.mark>=0,incoming:v.after.length,images:v.media.length,withCaption:v.titled.length,ready:v.ready.length,markerId:v.dotId,seen:st.seen.length,lastError}));return true;
 }
 if(m.type==='SCAN'){scan().then(reply);return true}
});
let timer;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(async()=>{const s=await chrome.storage.local.get({enabled:true,intervalSeconds:0});if(s.enabled&&Number(s.intervalSeconds)===0)scan()},900)});
function begin(){observer.observe(document.querySelector('#app')||document.body,{subtree:true,childList:true});setTimeout(scan,1800)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin,{once:true});else begin();
setInterval(async()=>{const s=await chrome.storage.local.get({enabled:true,intervalSeconds:0});const sec=Number(s.intervalSeconds);if(s.enabled&&sec>0&&Date.now()-lastCheck>=sec*1000)scan()},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(scan,900)});


// Dedicated scanner tab: use only WhatsApp Web's visible search and chat UI.
// This does not work if WhatsApp changes its UI or a chat is not findable.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function openSelectedChat(name){
 if(activeChat()===name)return {ok:true,chat:name};
 const root=document.querySelector('#side');
 if(!root)throw Error('WhatsApp Web مازال ما تحمّلش');
 // Use the normal chat search, not WhatsApp's internal stores or APIs.
 let input=[...root.querySelectorAll('[contenteditable="true"],[role="textbox"],input[type="text"]')]
  .find(x=>x.getAttribute('data-tab')==='3'||/search|rechercher|بحث/i.test([x.getAttribute('aria-label'),x.getAttribute('data-testid'),x.getAttribute('title'),x.getAttribute('placeholder')].join(' ')));
 if(!input)input=root.querySelector('[contenteditable="true"],[role="textbox"],input[type="text"]');
 if(!input)throw Error('ما لقيناش خانة البحث على المحادثات فـ WhatsApp');
 input.focus();
 if(input.matches('input')){
  const desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');desc?.set?.call(input,name);
  input.dispatchEvent(new Event('input',{bubbles:true}));
 }else{
  // Browser-native insertion triggers React/WhatsApp's input handlers more
  // reliably than directly replacing the DOM content.
  document.execCommand('selectAll',false,null);
  document.execCommand('insertText',false,name);
  input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:name}));
 }
 const started=Date.now();
 while(Date.now()-started<8000){
  await sleep(350);
  const candidates=[...root.querySelectorAll('[title],[aria-label],span[dir="auto"]')];
  const match=candidates.find(e=>norm(e.getAttribute('title')||e.getAttribute('aria-label')||e.textContent)===name && e.getBoundingClientRect().height>0 && !e.closest('header'));
  const row=match?.closest('[data-testid="cell-frame-container"],[role="listitem"], [data-testid="chat-list-item"], [tabindex="0"]');
  if(row || match){(row||match).click();break;}
 }
 const until=Date.now()+6500;
 while(Date.now()<until){if(activeChat()===name) return {ok:true,chat:name}; await sleep(300)}
 throw Error('ما قدرناش نفتحو المحادثة: '+name+' (راجع الاسم أو البحث)');
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg.type!=='ROTATE_TO_CHAT')return;
 openSelectedChat(msg.chat).then(respond).catch(e=>respond({ok:false,error:e.message}));return true;
});
