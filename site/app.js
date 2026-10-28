import { PROJECT, ITEMS } from './catalog.js';
import { createSession, normalizeEntry, hasFeedback, summarize, updateEntry, updateOverview, exportReview, parseReview, mergeSessions, loadSession, saveSession, clearSession, STORAGE_KEY, MAX_IMPORT_BYTES } from './state.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const byId = new Map(ITEMS.map(item => [item.id, item]));
const labels = { keep:'Quero usar', adjust:'Quero ajustar', discard:'Prefiro não usar' };
const icons = { keep:'♡', adjust:'✎', discard:'×' };
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const loaded = loadSession(storage, STORAGE_KEY);
let session = loaded.session ?? createSession(PROJECT.id);
let writeBlocked = loaded.writeBlocked;
let conflict = false;
let storageWarning = loaded.warning;
let mode = 'gallery';
let activeId = null;
let imported = null;
let toastTimer;
let quickIds = [], quickIndex = 0, quickHistory = [], quickBusy = false, quickExtrasOpen = false;
let drag = null;
let ratingDrag = null;
const filter = { direction:'all', category:'all', status:'all', search:'' };

function announce(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3600);
}

function updateSaveStatus(ok, warning = null) {
  $('saveStatus').classList.toggle('error', !ok);
  $('saveStatus').innerHTML = `<i></i>${ok ? 'Salvo neste navegador' : 'Ainda não salvo'}`;
  $('saveStatus').title = ok ? 'As alterações estão salvas neste aparelho e navegador.' : 'Baixe o arquivo JSON para guardar suas alterações.';
  $('storageWarning').hidden = !warning;
  $('storageWarning').querySelector('p').textContent = warning ?? '';
  $('recoverStorageBtn').hidden = !warning || conflict;
  $('reloadStorageBtn').hidden = !conflict;
}

function persist() {
  if (writeBlocked || conflict) {
    updateSaveStatus(false, storageWarning || 'O salvamento está pausado. Baixe o JSON antes de reativar o armazenamento.');
    return;
  }
  const result = saveSession(storage, STORAGE_KEY, session);
  writeBlocked = result.writeBlocked;
  storageWarning = result.warning;
  updateSaveStatus(result.ok, result.warning);
}

function entryFor(id) { return session.items[id] ?? normalizeEntry(); }
function ratingText(rating) { return rating == null ? 'Sem nota' : `${rating.toLocaleString('pt-BR')} de 5 estrelas`; }
function ratingValue(rating) { return rating == null ? '—' : rating.toLocaleString('pt-BR'); }

function ratingMarkup(id, context = 'card') {
  const rating = entryFor(id).rating;
  const stars = Array.from({length:5}, (_,i) => `<span class="star">★<span class="star-fill" style="--fill:${Math.max(0, Math.min(100, ((rating ?? 0)-i)*100))}%">★</span></span>`).join('');
  return `<div class="rating-row" data-rating-container="${id}"><div class="rating-control"><span class="star-art" aria-hidden="true">${stars}</span><input type="range" min="1" max="5" step="0.5" value="${rating ?? 1}" data-rating="${id}" aria-label="Nota de ${id}" aria-valuetext="${esc(ratingText(rating))}"></div><span class="rating-value" data-rating-value="${id}" aria-hidden="true">${ratingValue(rating)}</span><button class="clear-rating" data-clear-rating="${id}" ${rating == null ? 'hidden' : ''} aria-label="Limpar nota de ${id}">Limpar</button><span class="screen-reader">A nota é opcional, de 1 a 5, com meia estrela.</span></div>`;
}

function decisionsMarkup(id) {
  const decision = entryFor(id).decision;
  return `<div class="decisions">${Object.entries(labels).map(([key,label]) => `<button class="decision-btn ${key}" data-decision="${key}" data-id="${id}" aria-pressed="${decision === key}" aria-label="${esc(label)}: ${id}"><span aria-hidden="true">${icons[key]}</span>${key === 'keep' ? 'Usar' : key === 'adjust' ? 'Ajustar' : 'Não usar'}</button>`).join('')}</div>`;
}

function mediaMarkup(item, full = false) {
  if (item.type === 'video') return `<video controls playsinline preload="metadata" aria-label="${esc(item.title)}"><source src="${esc(item.src)}" type="video/mp4">Seu navegador não conseguiu reproduzir o vídeo. <a href="${esc(item.src)}">Abrir MP4</a></video>`;
  return `<img src="${esc(full ? item.src : item.thumbnail)}" alt="${esc(item.title)}" ${full ? '' : 'loading="lazy" decoding="async"'} width="${item.width}" height="${item.height}" ${full ? '' : `data-open="${item.id}"`}>`;
}

function cardMarkup(item) {
  const entry = entryFor(item.id);
  return `<article class="art-card" data-id="${item.id}"><div class="art-media"><div class="media-tags"><span class="code-badge">${item.id}</span><span class="direction-tag">Direção ${item.direction}</span></div>${mediaMarkup(item)}<button class="expand-button" data-open="${item.id}" aria-label="Ampliar ${item.id}">⤢</button></div><div class="art-body"><h3 class="art-title">${esc(item.title)}</h3><p class="category-line">${esc(item.categoryLabel)}${item.notes ? '<span class="simulation-label">Simulação</span>' : ''}</p>${ratingMarkup(item.id)}${decisionsMarkup(item.id)}<button class="comment-link ${entry.comment.trim() ? 'has-comment' : ''}" data-open="${item.id}"><span aria-hidden="true">↳</span>${entry.comment.trim() ? 'Editar comentário' : 'Comentar ou ver detalhes'}</button><p class="comment-preview" data-comment-preview="${item.id}">${esc(entry.comment)}</p></div></article>`;
}

function visibleItems() {
  const search = filter.search.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return ITEMS.filter(item => {
    const entry = entryFor(item.id);
    if (filter.direction !== 'all' && item.direction !== filter.direction) return false;
    if (filter.category !== 'all' && item.category !== filter.category) return false;
    const haystack = `${item.id} ${item.title} ${item.categoryLabel}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (filter.status === 'unreviewed' && hasFeedback(entry)) return false;
    if (['keep','adjust','discard'].includes(filter.status) && entry.decision !== filter.status) return false;
    if (filter.status === 'rated' && entry.rating == null) return false;
    if (filter.status === 'commented' && !entry.comment.trim()) return false;
    return true;
  });
}

function renderGallery() {
  const items = visibleItems();
  $('artGrid').innerHTML = items.map(cardMarkup).join('');
  $('resultsCount').textContent = `${items.length} ${items.length === 1 ? 'peça' : 'peças'}`;
  $('emptyGallery').hidden = items.length > 0;
  const filterCount = Number(filter.direction !== 'all') + Number(filter.category !== 'all') + Number(filter.status !== 'all') + Number(Boolean(filter.search));
  $('clearFiltersBtn').hidden = !filterCount;
  $('filterCount').textContent = filterCount ? `(${filterCount})` : '';
  document.querySelectorAll('[data-direction-pick]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.directionPick === filter.direction)));
}

function pauseVideos(scope = document) { scope.querySelectorAll('video').forEach(video => video.pause()); }
function updateProgress() {
  const sum = summarize(session, ITEMS);
  document.querySelectorAll('.review-count').forEach(el => el.textContent = sum.reviewed);
  $('galleryProgress').textContent = `${sum.reviewed} de ${sum.total} peças com alguma avaliação`;
  $('progressBar').style.width = `${sum.reviewed / sum.total * 100}%`;
  return sum;
}

function syncItem(id) {
  const entry = entryFor(id);
  document.querySelectorAll(`[data-rating-container="${id}"]`).forEach(container => {
    container.querySelectorAll('.star-fill').forEach((star,i) => star.style.setProperty('--fill', `${Math.max(0, Math.min(100, ((entry.rating ?? 0)-i)*100))}%`));
    const input = container.querySelector('input');
    input.value = entry.rating ?? 1;
    input.setAttribute('aria-valuetext', ratingText(entry.rating));
    container.querySelector('.rating-value').textContent = ratingValue(entry.rating);
    container.querySelector('[data-clear-rating]').hidden = entry.rating == null;
  });
  document.querySelectorAll(`[data-id="${id}"][data-decision]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.decision === entry.decision)));
  document.querySelectorAll(`[data-comment-preview="${id}"]`).forEach(el => el.textContent = entry.comment);
  document.querySelectorAll(`.comment-link[data-open="${id}"]`).forEach(el => {
    el.classList.toggle('has-comment', Boolean(entry.comment.trim()));
    el.innerHTML = `<span aria-hidden="true">↳</span>${entry.comment.trim() ? 'Editar comentário' : 'Comentar ou ver detalhes'}`;
  });
  if (activeId === id && document.activeElement !== $('itemComment')) $('itemComment').value = entry.comment;
  const quickComment = $('quickComment');
  if (quickIds[quickIndex] === id && quickComment && document.activeElement !== quickComment) quickComment.value = entry.comment;
  updateProgress();
  if (mode === 'summary') renderSummary();
}

function changeItem(id, patch) {
  if (!byId.has(id)) return;
  session = updateEntry(session, id, patch);
  persist();
  syncItem(id);
}

function clearFilters() {
  Object.assign(filter,{direction:'all',category:'all',status:'all',search:''});
  $('searchInput').value=''; $('directionFilter').value='all'; $('categoryFilter').value='all'; $('statusFilter').value='all';
  quickIds=[];quickHistory=[];renderGallery();
}

function setMode(next, { restartQuick = false } = {}) {
  if (!['gallery','quick','summary'].includes(next)) next = 'gallery';
  pauseVideos();
  mode = next;
  ['gallery','quick','summary'].forEach(view => $(`${view}View`).hidden = view !== next);
  document.querySelectorAll('[data-nav]').forEach(button => {
    button.classList.toggle('active',button.dataset.nav === next);
    if (button.closest('nav')) button.setAttribute('aria-current',button.dataset.nav === next ? 'page' : 'false');
  });
  if (next === 'gallery') renderGallery();
  if (next === 'summary') renderSummary();
  if (next === 'quick' && (restartQuick || !quickIds.length)) startQuick();
  else if (next === 'quick') renderQuick();
  history.replaceState(null,'',`#${next}`);
  window.scrollTo({top:0,behavior:'instant'});
}

function showDialog(id) {
  const dialog=$(id);
  if (!dialog.open) dialog.showModal();
}
function closeDialog(id) {
  const dialog=$(id);
  pauseVideos(dialog);
  dialog.close();
}

function openItem(id) {
  const item=byId.get(id);
  if (!item) return;
  activeId=id;
  pauseVideos();
  $('detailCode').textContent=id;
  $('detailDirection').textContent=`DIREÇÃO ${item.direction} / ${item.categoryLabel}`;
  $('detailTitle').textContent=item.title;
  $('detailNote').textContent=item.notes || (item.type==='image' ? 'Toque na imagem para abrir em tamanho completo.' : 'Assista ao vídeo e avalie apenas se quiser.');
  $('detailMedia').innerHTML=item.type==='image' ? `<a href="${esc(item.src)}" target="_blank" rel="noopener" aria-label="Abrir ${id} em tamanho completo">${mediaMarkup(item,true)}</a>` : mediaMarkup(item,true);
  $('detailRating').innerHTML=ratingMarkup(id,'detail');
  $('detailDecisions').innerHTML=decisionsMarkup(id);
  $('itemComment').value=entryFor(id).comment;
  $('detailDialog').setAttribute('aria-labelledby','detailTitle');
  showDialog('detailDialog');
}

function renderSummary() {
  const sum=updateProgress();
  $('summaryStats').innerHTML=[['keep','Quero usar'],['adjust','Quero ajustar'],['discard','Prefiro não usar'],['reviewed','Peças com avaliação']].map(([key,label])=>`<div class="stat"><strong>${sum[key]}</strong><span>${label}</span></div>`).join('');
  if(document.activeElement!==$('overallComment')) $('overallComment').value=session.overview.comment;
  document.querySelectorAll('[data-preference]').forEach(button=>button.setAttribute('aria-pressed',String(session.overview.direction===button.dataset.preference)));
  const reviewed=ITEMS.filter(item=>hasFeedback(entryFor(item.id)));
  $('summaryCount').textContent=`${reviewed.length} de ${ITEMS.length}`;
  $('emptySummary').hidden=reviewed.length>0;
  $('summaryList').innerHTML=reviewed.map(item=>{
    const entry=entryFor(item.id);
    return `<article class="summary-item" data-summary-id="${item.id}"><button class="summary-thumb" data-open="${item.id}" aria-label="Ver ${item.id}">${item.type==='image'?`<img src="${esc(item.thumbnail)}" alt="" loading="lazy">`:'<span aria-hidden="true">▷</span>'}</button><div><h3>${item.id} · ${esc(item.title)}</h3><div class="item-facts">${entry.decision?`<span>${labels[entry.decision]}</span>`:''}${entry.rating!=null?`<span>★ ${ratingValue(entry.rating)}/5</span>`:''}</div>${entry.comment.trim()?`<p class="summary-comment">${esc(entry.comment)}</p>`:''}</div><button class="summary-edit" data-open="${item.id}">Editar</button></article>`;
  }).join('');
}

function quickScopeLabel() {
  const direction=filter.direction==='all'?'Duas direções':`Direção ${filter.direction}`;
  const category=filter.category==='all'?'todos os tipos':$('categoryFilter').selectedOptions[0].textContent;
  return `${direction} · ${category}`;
}

function startQuick(includeDecided=false) {
  const items=visibleItems();
  quickIds=items.filter(item=>includeDecided||!entryFor(item.id).decision).map(item=>item.id);
  quickIndex=0;quickHistory=[];quickBusy=false;quickExtrasOpen=false;
  $('quickScope').textContent=quickScopeLabel();
  renderQuick();
}

function renderQuick() {
  pauseVideos($('quickStage'));
  quickBusy=false;
  const id=quickIds[quickIndex];
  $('quickCompleted').hidden=Boolean(id);
  $('quickStage').hidden=!id;
  $('quickCounter').textContent=id?`${quickIndex+1} de ${quickIds.length}`:quickIds.length?`${quickIds.length} peças vistas`:'Nenhuma peça nesta seleção';
  $('quickUndo').disabled=!quickHistory.length;
  if(!id){$('quickStage').innerHTML='';return;}
  const item=byId.get(id), entry=entryFor(id);
  $('quickStage').innerHTML=`<article class="quick-card" data-quick-id="${id}"><div class="quick-labels"><span><b class="code-badge">${id}</b> · Direção ${item.direction}</span><span>${esc(item.categoryLabel)}</span></div><div id="quickSurface" class="quick-surface" tabindex="0" aria-label="Peça ${id}. Arraste para a direita para usar, para a esquerda para não usar, ou escolha nos botões."><div class="quick-media">${mediaMarkup(item,true)}<span class="swipe-stamp yes">QUERO USAR</span><span class="swipe-stamp no">NÃO USAR</span></div><div class="drag-band"><span aria-hidden="true">←</span> Arraste aqui ou use os botões <span aria-hidden="true">→</span></div></div><div class="quick-title-row"><h2>${esc(item.title)}</h2><button class="text-button" data-open="${id}">Ampliar ⤢</button></div>${item.notes?`<p class="quick-note">${esc(item.notes)}</p>`:''}<div class="quick-actions"><button id="quickDiscard" class="discard"><span aria-hidden="true">×</span> Não usar</button><button id="quickAdjust" class="adjust"><span aria-hidden="true">✎</span> Ajustar</button><button id="quickKeep" class="keep"><span aria-hidden="true">♡</span> Usar</button></div><div class="quick-secondary"><button id="toggleQuickExtras" class="text-button" aria-expanded="${quickExtrasOpen}">${entry.rating!=null||entry.comment.trim()?'Editar nota ou comentário':'Nota ou comentário (opcional)'}</button><button id="quickSkip" class="text-button">Pular por enquanto →</button></div><div class="quick-extras" ${quickExtrasOpen?'':'hidden'}>${ratingMarkup(id,'quick')}<label class="field-label" for="quickComment">O que mudaria nesta peça?</label><textarea id="quickComment" rows="3" maxlength="10000" placeholder="Deixe sua ideia, se quiser…">${esc(entry.comment)}</textarea></div></article>`;
  attachSwipe();
}

function quickChoice(decision) {
  if(quickBusy||!quickIds[quickIndex]) return;
  quickBusy=true;
  const id=quickIds[quickIndex];
  quickHistory.push({index:quickIndex,id,previousDecision:entryFor(id).decision,changed:decision!==null});
  if(decision!==null) changeItem(id,{decision});
  const card=$('quickStage').querySelector('.quick-card');
  if(card&&decision){card.classList.add(decision==='discard'?'leaving-left':'leaving-right');}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(()=>{quickIndex++;quickExtrasOpen=false;renderQuick();$('quickSurface')?.focus({preventScroll:true});},reduced||decision===null?0:170);
}

function undoQuick() {
  if(quickBusy||!quickHistory.length)return;
  const action=quickHistory.pop();
  if(action.changed) changeItem(action.id,{decision:action.previousDecision});
  quickIndex=action.index;quickExtrasOpen=false;renderQuick();
  announce('Última escolha desfeita.');
}

function resetDrag() {
  const card=$('quickStage').querySelector('.quick-card');
  if(card){card.classList.remove('dragging');card.style.transform='';card.querySelectorAll('.swipe-stamp').forEach(el=>el.style.opacity=0);}
  drag=null;
}

function attachSwipe() {
  const surface=$('quickSurface');
  if(!surface)return;
  surface.addEventListener('pointerdown',event=>{
    if(quickBusy||event.button!==0||event.target.closest('video,button,a,input,textarea'))return;
    drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,dx:0,active:false};
  });
  surface.addEventListener('pointermove',event=>{
    if(!drag||drag.pointerId!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.active&&Math.abs(dy)>20&&Math.abs(dy)>Math.abs(dx)){resetDrag();return;}
    if(!drag.active&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.15){drag.active=true;surface.setPointerCapture(event.pointerId);}
    if(!drag.active)return;
    event.preventDefault();drag.dx=dx;
    const card=surface.closest('.quick-card');card.classList.add('dragging');card.style.transform=`translateX(${dx}px) rotate(${dx/32}deg)`;
    card.querySelector('.yes').style.opacity=dx>0?Math.min(1,dx/100):0;
    card.querySelector('.no').style.opacity=dx<0?Math.min(1,-dx/100):0;
  });
  surface.addEventListener('pointerup',event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    const dx=drag.dx,active=drag.active,threshold=Math.max(75,Math.min(120,surface.clientWidth*.24));
    resetDrag();
    if(active&&Math.abs(dx)>=threshold)quickChoice(dx>0?'keep':'discard');
  });
  surface.addEventListener('pointercancel',resetDrag);
  // Touch starts with implicit capture on the media child. Transferring capture
  // to this surface emits a bubbling loss on that child; it is not a cancel.
  surface.addEventListener('lostpointercapture',event=>{
    if(event.target===surface&&drag?.pointerId===event.pointerId&&!surface.hasPointerCapture(event.pointerId))resetDrag();
  });
}

function exportFilename() {
  const date=new Date().toLocaleDateString('en-CA');
  return `Leopoldina_avaliacao_${date}.json`;
}
function exportBlob() { return new Blob([JSON.stringify(exportReview(session,ITEMS),null,2)],{type:'application/json'}); }
function openExport() {
  const sum=summarize(session,ITEMS);
  $('exportStats').innerHTML=`<b>${sum.reviewed}</b> de ${sum.total} peças com avaliação<br>${sum.keep} para usar · ${sum.adjust} para ajustar · ${sum.discard} para não usar<br>${sum.rated} com nota · ${sum.commented} com comentário`;
  let canShare=false;
  try {canShare=Boolean(navigator.canShare?.({files:[new File([exportBlob()],exportFilename(),{type:'application/json'})]}));} catch { /* Optional system share. */ }
  $('shareExportBtn').hidden=!canShare;
  showDialog('exportDialog');
}
function downloadReview() {
  const url=URL.createObjectURL(exportBlob());
  const anchor=document.createElement('a');anchor.href=url;anchor.download=exportFilename();document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  announce('Avaliação preparada para baixar. Envie o JSON ao Matheus.');
}

async function readImport(file) {
  if(!file)return;
  if(file.size>MAX_IMPORT_BYTES){announce('O JSON deve ter no máximo 4 MB.');return;}
  try {
    const result=parseReview(await file.text(),ITEMS);
    imported=result;
    const sum=summarize(result.session,ITEMS);
    $('importPreview').innerHTML=`<p><b>${sum.reviewed} peças com avaliação</b><br>${sum.keep} para usar · ${sum.adjust} para ajustar · ${sum.discard} para não usar</p>${result.session.reviewer.name?`<p>Nome: ${esc(result.session.reviewer.name)}</p>`:''}<p class="micro">Ao mesclar, as respostas do arquivo substituem as atuais nos mesmos códigos. As peças sem resposta no arquivo não apagam suas escolhas.</p>${result.warnings.map(w=>`<p class="micro">${esc(w)}</p>`).join('')}`;
    document.querySelector('input[name="importMode"][value="merge"]').checked=true;
    showDialog('importDialog');
  }catch(error){imported=null;announce(error.message||'Não foi possível importar este arquivo.');}
}

function confirmImport() {
  if(!imported)return;
  const replace=document.querySelector('input[name="importMode"]:checked').value==='replace';
  session=mergeSessions(session,imported.session,{replace});
  imported=null;closeDialog('importDialog');quickIds=[];quickHistory=[];
  persist();updateProgress();renderGallery();renderSummary();if(mode==='quick')startQuick();
  announce('Avaliação importada. Você pode continuar de onde parou.');
}

function resetReview() {
  const result=clearSession(storage,STORAGE_KEY);
  session=createSession(PROJECT.id);writeBlocked=false;conflict=false;storageWarning=result.warning;
  quickIds=[];quickHistory=[];
  closeDialog('resetDialog');persist();updateProgress();clearFilters();renderSummary();
  if(mode==='quick')startQuick();
  announce(result.ok?'Avaliação limpa. Você pode recomeçar.':result.warning);
}

document.addEventListener('click',event=>{
  const target=event.target.closest('button,a');
  if(!target)return;
  if(target.dataset.nav){event.preventDefault();setMode(target.dataset.nav);return;}
  if(target.dataset.close){closeDialog(target.dataset.close);return;}
  if(target.dataset.open){openItem(target.dataset.open);return;}
  if(target.dataset.directionPick){filter.direction=target.dataset.directionPick;$('directionFilter').value=filter.direction;quickIds=[];quickHistory=[];renderGallery();document.querySelector('.collection').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;}
  if(target.dataset.clearRating){changeItem(target.dataset.clearRating,{rating:null});return;}
  if(target.dataset.decision){const id=target.dataset.id;changeItem(id,{decision:entryFor(id).decision===target.dataset.decision?null:target.dataset.decision});if(mode==='gallery'&&filter.status!=='all')renderGallery();return;}
  if(target.dataset.preference){session=updateOverview(session,{direction:session.overview.direction===target.dataset.preference?null:target.dataset.preference});persist();renderSummary();return;}
  const handlers={
    startQuickBtn:()=>setMode('quick',{restartQuick:true}),
    toggleFilters:()=>{const open=!$('filterControls').classList.contains('open');$('filterControls').classList.toggle('open',open);$('toggleFilters').setAttribute('aria-expanded',String(open));},
    clearFiltersBtn:clearFilters,emptyClearBtn:clearFilters,
    downloadJsonBtn:openExport,summaryExportBtn:openExport,confirmExportBtn:downloadReview,
    importBtn:()=>{$('importFile').value='';$('importFile').click();},confirmImportBtn:confirmImport,
    resetBtn:()=>showDialog('resetDialog'),confirmResetBtn:resetReview,
    resetExportBtn:()=>{closeDialog('resetDialog');openExport();},
    quickKeep:()=>quickChoice('keep'),quickAdjust:()=>quickChoice('adjust'),quickDiscard:()=>quickChoice('discard'),quickSkip:()=>quickChoice(null),quickUndo:undoQuick,
    restartQuickBtn:()=>startQuick(true),
    toggleQuickExtras:()=>{quickExtrasOpen=!quickExtrasOpen;const extras=$('quickStage').querySelector('.quick-extras');extras.hidden=!quickExtrasOpen;target.setAttribute('aria-expanded',String(quickExtrasOpen));},
    recoverStorageBtn:()=>{if(confirm('Reativar o salvamento com a avaliação que está nesta página? Se havia dados ilegíveis, baixe uma cópia JSON antes de continuar.')){clearSession(storage,STORAGE_KEY);writeBlocked=false;conflict=false;persist();}},
    reloadStorageBtn:()=>{if(confirm('Carregar as avaliações salvas pela outra aba? Se você fez alterações nesta página, baixe uma cópia antes de continuar.')){const result=loadSession(storage,STORAGE_KEY);session=result.session;writeBlocked=result.writeBlocked;storageWarning=result.warning;conflict=false;quickIds=[];updateSaveStatus(result.ok,result.warning);updateProgress();renderGallery();renderSummary();if(mode==='quick')startQuick();}}
  };
  handlers[target.id]?.();
});

document.addEventListener('click',event=>{
  if(event.target instanceof HTMLImageElement&&event.target.dataset.open)openItem(event.target.dataset.open);
});
document.addEventListener('input',event=>{
  const target=event.target;
  if(target.matches('input[data-rating]')){changeItem(target.dataset.rating,{rating:Number(target.value)});return;}
  if(target.id==='itemComment'&&activeId){changeItem(activeId,{comment:target.value});return;}
  if(target.id==='quickComment'&&quickIds[quickIndex]){changeItem(quickIds[quickIndex],{comment:target.value});return;}
  if(target.id==='overallComment'){session=updateOverview(session,{comment:target.value});persist();return;}
  if(target.id==='searchInput'){filter.search=target.value.trim();quickIds=[];quickHistory=[];renderGallery();}
});
// Align the ten visual half-stars with pointer/touch positions. Keyboard users
// retain the native range's 1–5 bounds and 0.5 step. No interaction means null.
function pointerRating(input,x){
  const box=input.getBoundingClientRect();
  const fraction=Math.max(0,Math.min(1,(x-box.left)/box.width));
  const rating=Math.max(1,Math.min(5,Math.ceil(fraction*10)/2));
  if(entryFor(input.dataset.rating).rating!==rating)changeItem(input.dataset.rating,{rating});
}
document.addEventListener('pointerdown',event=>{
  const input=event.target.closest('input[data-rating]');
  if(!input||event.button!==0)return;
  event.preventDefault();input.focus({preventScroll:true});input.setPointerCapture(event.pointerId);
  ratingDrag={input,pointerId:event.pointerId};pointerRating(input,event.clientX);
});
document.addEventListener('pointermove',event=>{if(ratingDrag&&ratingDrag.pointerId===event.pointerId){event.preventDefault();pointerRating(ratingDrag.input,event.clientX);}});
document.addEventListener('pointerup',event=>{if(ratingDrag&&ratingDrag.pointerId===event.pointerId){pointerRating(ratingDrag.input,event.clientX);ratingDrag=null;}});
document.addEventListener('pointercancel',()=>{ratingDrag=null;});
document.addEventListener('change',event=>{
  if(event.target.id==='importFile')readImport(event.target.files[0]);
  const field={directionFilter:'direction',categoryFilter:'category',statusFilter:'status'}[event.target.id];
  if(field){filter[field]=event.target.value;quickIds=[];quickHistory=[];renderGallery();}
});
document.addEventListener('keydown',event=>{
  if(event.target.matches('input[data-rating]')&&entryFor(event.target.dataset.rating).rating==null&&['ArrowLeft','ArrowDown','Home'].includes(event.key)){event.preventDefault();changeItem(event.target.dataset.rating,{rating:1});return;}
  if(mode!=='quick'||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select,video,[contenteditable]')||event.ctrlKey||event.metaKey||event.altKey)return;
  const action={ArrowRight:'keep',ArrowLeft:'discard',ArrowUp:'adjust'}[event.key];
  if(action){event.preventDefault();quickChoice(action);}
  if(event.key==='ArrowDown'){event.preventDefault();quickChoice(null);}
});

document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.addEventListener('close',()=>{
    pauseVideos(dialog);
    if(dialog.id==='detailDialog'){
      const closedId=activeId;activeId=null;
      requestAnimationFrame(()=>{
        const scope=mode==='summary'?$('summaryList'):mode==='quick'?$('quickStage'):$('artGrid');
        const preferred=mode==='summary'?scope.querySelector(`.summary-edit[data-open="${closedId}"]`):scope.querySelector(`button[data-open="${closedId}"]`);
        if(preferred)preferred.focus({preventScroll:true});
        else if(mode==='gallery')$('searchInput').focus({preventScroll:true});
      });
    }
  });
  dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))closeDialog(dialog.id);});
});
$('shareExportBtn').addEventListener('click',async()=>{
  try {await navigator.share({title:'Avaliação Joias Leopoldina',files:[new File([exportBlob()],exportFilename(),{type:'application/json'})]});}
  catch(error){if(error.name!=='AbortError')announce('Não foi possível compartilhar. Use a opção Baixar arquivo JSON.');}
});
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY||event.newValue===JSON.stringify(session))return;
  conflict=true;storageWarning='Outra aba alterou esta avaliação. Para evitar sobrepor escolhas, carregue os dados atualizados ou baixe a cópia desta página.';
  updateSaveStatus(false,storageWarning);
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(next!==mode)setMode(next);});
window.addEventListener('beforeunload',event=>{if((writeBlocked||conflict||$('saveStatus').classList.contains('error'))&&(summarize(session,ITEMS).reviewed||session.overview.comment||session.reviewer.name)){event.preventDefault();event.returnValue='';}});

updateSaveStatus(loaded.ok,loaded.warning);
updateProgress();
renderGallery();
setMode(location.hash.slice(1)||'gallery');
