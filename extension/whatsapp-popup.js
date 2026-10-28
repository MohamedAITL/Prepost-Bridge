// WhatsApp → Prepost section of the popup (from GPT's v2.1 popup.js). Wrapped so its names don't
// clash with popup.js; its Save button is #waSave. Items now go straight to the Prepost engine.
(() => {
const $=id=>document.getElementById(id);
const defaults={enabled:true,intervalSeconds:0,chats:[],chat:'',multiEnabled:false};
async function settings(){return chrome.storage.local.get(defaults)}
async function refresh(){const s=await settings();const chats=s.chats.length?s.chats:(s.chat?[s.chat]:[]);$('enabled').checked=s.enabled;$('multiEnabled').checked=!!s.multiEnabled;$('interval').value=String(s.intervalSeconds??0);$('state').textContent=`المحادثات المختارة: ${chats.length}\nالمراقبة: ${s.enabled?'مفعلة':'متوقفة'}`;const list=$('chats');list.replaceChildren();for(const chat of chats){const row=document.createElement('div');row.className='chat';const name=document.createElement('span');name.textContent=chat;const remove=document.createElement('button');remove.textContent='حيد';remove.onclick=async()=>{await chrome.storage.local.set({chats:chats.filter(x=>x!==chat),chat:''});refresh()};row.append(name,remove);list.append(row)}}
async function whatsappTab(){const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});return tabs[0]}
$('choose').onclick=async()=>{const tab=await whatsappTab();if(!tab){$('state').textContent='فتح WhatsApp Web أولا';return}try{const r=await chrome.tabs.sendMessage(tab.id,{type:'GET_CHAT'});if(!r?.chat)throw Error('افتح محادثة من اللائحة');const s=await settings();await chrome.storage.local.set({chats:[...new Set([...(s.chats.length?s.chats:(s.chat?[s.chat]:[])),r.chat])],chat:''});await refresh()}catch(e){$('state').textContent=e.message}}
$('waSave').onclick=async()=>{await chrome.storage.local.set({enabled:$('enabled').checked,intervalSeconds:Number($('interval').value),multiEnabled:$('multiEnabled').checked});if($('multiEnabled').checked)await chrome.runtime.sendMessage({type:'START_MULTI_SCAN'});await refresh()}
$('scan').onclick=async()=>{const tab=await whatsappTab();if(!tab){$('state').textContent='فتح WhatsApp Web أولا';return}try{const r=await chrome.tabs.sendMessage(tab.id,{type:'SCAN'});$('state').textContent=`الفحص سالا. المسودات الجديدة: ${r?.count||0}\nالحالة: ${r?.reason||r?.error||'بلا خطأ'}`}catch(e){$('state').textContent='جدّد صفحة WhatsApp Web وعاود: '+e.message}};
refresh();

$('diagnose').onclick=async()=>{
 const tab=await whatsappTab();if(!tab){$('diagnostic').textContent='WhatsApp Web ما مفتوحش';return}
 try{const r=await chrome.tabs.sendMessage(tab.id,{type:'STATUS'});const extra=await chrome.storage.local.get({captureStatus:null,bridgeStatus:null,pendingWhatsAppDrafts:[]});
 $('diagnostic').textContent=`المحادثة: ${r.chat||'ما تعرفناش عليها'}\nموجودة فاللائحة: ${r.allowed?'نعم':'لا'}\nعدد الرسائل المقروءة: ${r.total} (منها صادرة: ${r.outgoing})\nرسائل اتجاهها غير معروف: ${r.unknown}\nالصور الظاهرة فالمحادثة: ${r.rawImgs}\nالصور داخل الرسائل: ${r.allImages}\nالعناوين داخل الرسائل: ${r.allCaption}\nعدد النقط المكتشفة: ${r.dots}\nالنقطة . موجودة فالمحادثة: ${r.marker?'نعم':'لا'}\nالرسائل من بعد النقطة: ${r.incoming}\nالصور من بعد النقطة: ${r.images}\nالعناوين من بعد النقطة: ${r.withCaption}\nصورة + عنوان فنفس الرسالة: ${r.ready}\nرسائل عولجات: ${r.seen}\nمرحلة WhatsApp: ${extra.captureStatus?.message||'ما زال ما بداتش'}\nمرحلة النقل: ${extra.bridgeStatus?.message||'مازال ما بداش'}\nأخبار فالانتظار داخل الإكستنشن: ${extra.pendingWhatsAppDrafts.length}\nآخر محاولة: ${extra.captureStatus?.message||'ما زال ما بداتش'} (${extra.captureStatus?.time||''})\nآخر خطأ: ${r.lastError||'ما كاينش'}\n\nتفاصيل آخر الرسائل (التشخيص):\n${(r.samples||[]).map(x=>`${x.i}: ${x.dir} | صور:${x.imgs} | نقطة:${x.dot?'نعم':'لا'} | ${x.text} | ${x.id}`).join('\n')}`;
 }catch(e){$('diagnostic').textContent='جدّد WhatsApp Web وعاود: '+e.message}
};

$('multiScan').onclick=async()=>{await chrome.runtime.sendMessage({type:'RUN_MULTI_SCAN'});refreshMulti()};
async function refreshMulti(){let s=await chrome.runtime.sendMessage({type:'GET_MULTI_STATUS'});$('multiStatus').textContent='المراقبة المتعددة: '+(s.multiScanStatus?.message||'مازال ما بداتش')+' '+(s.multiScanStatus?.time||'')};
refreshMulti();setInterval(refreshMulti,3000);

})();
