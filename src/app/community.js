import { likeMarkup, mountLike } from './like-button.js';
import { openShredder } from './shredder.js';
import { TALK_ICON } from './talk-icon.js';
import { openComments } from './comments-sheet.js';
import './comments-sheet.css';
import { supabase, $, esc } from '../supabase.js';
import { confirmDialog, notify } from './common.js';
import { renderEventsFeed, renderChallenges } from './club-pages.js';
import { avatarSrc, avatarImg, initialsOf, openPhotoViewer } from './avatar.js';
import { openProfileCard } from './social.js';
import { renderSharedFeed } from './share.js';

let section = 'activity';
const MODULES = [['running','Running'],['cycling','Ciclismo'],['plyo','Pliometría'],['training','Entrenamiento'],['swimming','Natación']];

export async function renderCommunity(view, ctx) {
  const TABS = [['activity', 'Actividad'], ['events', 'Eventos'], ['challenges', 'Retos'], ['members', 'Miembros']];
  view.innerHTML = `<section class="community-page run-module"><header class="run-module__head"><div><p class="run-kicker">CLUB · BATMON CROWD</p><h1>Club</h1></div></header>
    <nav class="running-pages tabs-pill tabs-pill--4" aria-label="Secciones del Club">${TABS.map(([key, label]) => `<input class="tabs-pill__input" type="radio" name="club-page" id="club-page-${key}" value="${key}"${section === key ? ' checked' : ''}><label class="tabs-pill__label" for="club-page-${key}">${label}</label>`).join('')}<div class="tabs-pill__indicator" aria-hidden="true"></div></nav>
    <div id="community-content"><p class="card muted">Cargando comunidad…</p></div></section>`;
  view.querySelectorAll('.tabs-pill__input').forEach(input => { input.onchange = () => { section = input.value; renderCommunity(view, ctx); }; });
  const box = $('#community-content', view);
  if (section === 'members') await renderMembers(box, ctx);
  else if (section === 'events') await renderEventsFeed(box, ctx);
  else if(section==='challenges') await renderChallenges(box,ctx);
  else {
    box.innerHTML = '<div id="club-acts"></div><div id="club-wall"></div>';
    await Promise.all([renderSharedFeed($('#club-acts', box), ctx), renderActivity($('#club-wall', box), ctx)]);
    const share = $('[data-share-open]', box); if (share) box.prepend(share); // el botón va arriba de las actividades
    // Un solo aviso de "vacío": solo si no hay ni actividades ni publicaciones
    const hasAny = box.querySelector('.act-card, .community-post');
    box.querySelectorAll('.profile-empty').forEach((el, i) => { if (hasAny || i > 0) el.remove(); });
  }
}

async function renderActivity(box, ctx) {
  const { data: edges = [], error: friendError } = await supabase.from('friendships')
    .select('requester,addressee,status').eq('status','accepted')
    .or(`requester.eq.${ctx.user.id},addressee.eq.${ctx.user.id}`);
  if (friendError) { box.innerHTML = `<div class="card warn">No se cargó la actividad: ${esc(friendError.message)}</div>`; return; }
  const friendIds = edges.map(row => row.requester === ctx.user.id ? row.addressee : row.requester);
  const ownerIds = [ctx.user.id, ...friendIds];
  const [{ data: allPosts = [], error }, { data: directory = [] }] = await Promise.all([
    supabase.from('profile_posts').select('*').in('user_id', ownerIds).order('created_at',{ascending:false}).limit(50),
    supabase.rpc('profile_directory'),
  ]);
  if (error) { box.innerHTML = `<div class="card warn">No se pudo cargar el muro: ${esc(error.message)}</div>`; return; }
  const posts = allPosts.filter((post) => post.published !== false);
  if (!posts.length) {
    box.innerHTML = `${shareButton()}<div class="card profile-empty">Aún no hay publicaciones tuyas ni de tus amigos. Comparte una foto o video de entrenamiento para iniciar el muro.</div>`;
    bindShareButton(box, ctx); return;
  }
  const postIds = posts.map(post => post.id);
  const [reactionResult, commentResult] = await Promise.all([
    supabase.from('post_reactions').select('post_id,user_id').in('post_id', postIds),
    supabase.from('post_comments').select('id,post_id,user_id,body,created_at').in('post_id', postIds).order('created_at',{ascending:true}),
  ]);
  const interactionsReady=!reactionResult.error&&!commentResult.error;
  const reactions=reactionResult.data||[],comments=commentResult.data||[];
  const commentCount = postId => comments.filter(x => x.post_id === postId).length;
  const people = new Map(directory.map(person => [person.id,person.full_name || 'Socio Batmon']));
  people.set(ctx.user.id,ctx.profile?.full_name||'Tú');
  const owner = new Map(directory.map(person => [person.id,person]));
  owner.set(ctx.user.id,{id:ctx.user.id,full_name:ctx.profile?.full_name||'Tú',avatar_path:ctx.profile?.avatar_path,avatar_url:ctx.profile?.avatar_url});
  const avatarOf=new Map(await Promise.all(ownerIds.map(async id=>[id,await avatarSrc(owner.get(id),1800)])));
  const media = await Promise.all(posts.map(async post => {
    const { data } = await supabase.storage.from('profile-media').createSignedUrl(post.media_path, 1800);
    return [post.id, data?.signedUrl || ''];
  }));
  const urls = new Map(media);
  const cards = posts.map(post => {
    const author = owner.get(post.user_id);
    const likes = reactions.filter(reaction => reaction.post_id === post.id);
    const ownLike = likes.some(reaction => reaction.user_id === ctx.user.id);
    const postComments = comments.filter(comment => comment.post_id === post.id);
    const src = urls.get(post.id);
    const content = src ? post.media_type === 'video'
      ? `<video class="community-media" src="${esc(src)}" controls playsinline preload="metadata"></video>`
      : `<img class="community-media look-${post.look||'orig'}" src="${esc(src)}" alt="Publicación de ${esc(people.get(post.user_id)||'un socio')}" loading="lazy">`
      : '<div class="card warn">El archivo ya no está disponible.</div>';
    return `<article class="card community-post" data-post-card="${post.id}"><header class="community-post-head"><button type="button" class="community-avatar" data-avatar="${post.user_id}" aria-label="Ver foto">${avatarOf.get(post.user_id)?avatarImg(avatarOf.get(post.user_id)):esc(initialsOf(people.get(post.user_id)))}</button><div><b>${esc(people.get(post.user_id)||'Socio Batmon')}</b><small>${esc(MODULES.find(([key])=>key===post.module_key)?.[1]||post.module_key)} · ${new Date(post.created_at).toLocaleDateString('es-BO',{day:'numeric',month:'short',year:'numeric'})}${post.visibility==='close'?' · Mejores amigos':''}</small></div></header>${content}${post.caption?`<p>${esc(post.caption)}</p>`:''}<div class="community-post-actions">${interactionsReady?`${likeMarkup(ownLike,likes.length,`data-like-post="${post.id}"`)}<button type="button" class="act-talk" data-focus-comment aria-label="Comentar" title="Comentar">${TALK_ICON}<span class="act-count" data-comment-count>${commentCount(post.id)||''}</span></button>`:''}<button type="button" class="act-share" data-share-post aria-label="Compartir" title="Compartir"><svg class="sh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="sh-arrow" d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/></svg></button>${post.user_id===ctx.user.id?`<button type="button" class="link icon-del" data-delete-post="${post.id}" data-media-path="${esc(post.media_path)}" aria-label="Eliminar publicación" title="Eliminar"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="tr-lid"><path d="M4 6.5h16"/><path d="M9.5 6.5V4.25h5V6.5"/></g><path d="M6.2 6.5l.9 13.25h9.8l.9-13.25"/><path d="M10.25 10.5v5.5M13.75 10.5v5.5"/></svg></button>`:''}</div></article>`;
  }).join('');
  box.innerHTML = `${shareButton()}<div class="quick-actions"><a class="link" href="#inicio">Ver calendario y eventos del club</a></div><div class="community-feed">${cards}</div>`;
  bindShareButton(box, ctx);
  box.querySelectorAll('[data-avatar]').forEach(b=>b.onclick=()=>openPhotoViewer(avatarOf.get(b.dataset.avatar),people.get(b.dataset.avatar)||''));
  box.querySelectorAll('[data-like-post]').forEach(button => {
    const postId = button.dataset.likePost, base = reactions.filter(r => r.post_id === postId && r.user_id !== ctx.user.id).length;
    let liked = button.getAttribute('aria-pressed') === 'true';
    const ctl = mountLike(button, { liked, count: base + (liked ? 1 : 0) });
    button.onclick = async () => {
      const was = liked; liked = !was; ctl.set(liked, base + (liked ? 1 : 0)); // anima en el mismo botón, sin recargar el muro
      const { error: actionError } = was
        ? await supabase.from('post_reactions').delete().eq('post_id', postId).eq('user_id', ctx.user.id)
        : await supabase.from('post_reactions').insert({ post_id: postId, user_id: ctx.user.id });
      if (actionError) { liked = was; ctl.set(was, base + (was ? 1 : 0)); notify(`No se pudo actualizar la reacción: ${actionError.message}`); }
    };
  });
  const openPost = postId => openComments({
    getList: () => comments.filter(x => x.post_id === postId).map(x => ({ id: x.id, name: people.get(x.user_id) || 'Socio', body: x.body, at: x.created_at, mine: x.user_id === ctx.user.id })),
    onSend: async body => {
      const { data, error: commentError } = await supabase.from('post_comments').insert({ post_id: postId, user_id: ctx.user.id, body }).select('id,post_id,user_id,body,created_at').single();
      if (commentError) { notify(`No se pudo comentar: ${commentError.message}`); return false; }
      comments.push(data); return true;
    },
    onClose: () => { const n = box.querySelector(`[data-post-card="${postId}"] [data-comment-count]`); if (n) n.textContent = commentCount(postId) || ''; },
  });
  box.querySelectorAll('[data-focus-comment]').forEach(button => button.onclick = () => openPost(button.closest('[data-post-card]').dataset.postCard));
  box.querySelectorAll('[data-share-post]').forEach(button => button.onclick = async () => {
    const card = button.closest('[data-post-card]'), who = card.querySelector('.community-post-head b')?.textContent || 'Un socio', text = `${who} compartió una publicación en Batmon Crowd`;
    try { if (navigator.share) await navigator.share({ title: 'Batmon Crowd', text, url: location.origin }); else { await navigator.clipboard.writeText(`${text} ${location.origin}`); notify('Enlace listo para pegar.', 'success'); } } catch { /* cancelado */ }
  });
  box.querySelectorAll('[data-delete-post]').forEach(button => button.onclick = () => openShredder({name:'publicación',image:button.closest('[data-post-card]')?.querySelector('img.community-media')?.src||'',onCommit:async()=>{
    const postId=button.dataset.deletePost, path=button.dataset.mediaPath;
    const {error: deleteError}=await supabase.from('profile_posts').delete().eq('id',postId).eq('user_id',ctx.user.id);
    if(deleteError){notify(deleteError.message);return;}
    const {error:storageError}=/\/(posts|session)\//.test(path)?await supabase.storage.from('profile-media').remove([path]):{error:null};
    if(storageError)notify(`Publicación eliminada, pero no se pudo borrar el archivo: ${storageError.message}`);
    renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  }}));
}

function shareButton() {
  return `<button type="button" class="btn share-open" data-share-open><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Compartir entrenamiento</button>`;
}

function bindShareButton(box, ctx) {
  const open = $('[data-share-open]', box); if (!open) return;
  open.onclick = async () => {
    const { data: closeRows = [] } = await supabase.from('close_friends').select('friend');
    const modal = document.createElement('div'); modal.className = 'modal share-module';
    modal.innerHTML = `<section class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Compartir entrenamiento"><div class="sheet-h"><h2>Compartir entrenamiento</h2><button class="link" type="button" data-close>Cerrar</button></div>
      <form id="community-publish" class="community-publish"><label>Disciplina<select name="module_key">${MODULES.filter(([key])=>ctx.modules?.[key]).map(([key,title])=>`<option value="${key}">${title}</option>`).join('')}</select></label><label>Foto o video<input type="file" name="media" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" required></label><label>Descripción<input name="caption" maxlength="500" placeholder="¿Qué entrenaste hoy?"></label>
        <fieldset class="share-audience"><legend>¿Quién puede verlo?</legend>
          <nav class="running-pages tabs-pill tabs-pill--2" aria-label="Quién puede verlo"><input class="tabs-pill__input" type="radio" name="visibility" id="vis-friends" value="friends" checked><label class="tabs-pill__label" for="vis-friends">Mis amigos</label><input class="tabs-pill__input" type="radio" name="visibility" id="vis-close" value="close"><label class="tabs-pill__label" for="vis-close">Mejores amigos</label><div class="tabs-pill__indicator" aria-hidden="true"></div></nav>
          <small class="muted" data-audience-note></small></fieldset>
        <button class="btn" type="submit">Publicar</button><p class="msg" role="status"></p></form></section>`;
    document.body.append(modal);
    const form = $('#community-publish', modal), note = $('[data-audience-note]', modal);
    const paint = () => { note.textContent = form.elements.visibility.value === 'close' ? (closeRows.length ? `Solo lo verán tus ${closeRows.length} mejores amigos. Elígelos en Editar perfil.` : 'Aún no tienes mejores amigos: elígelos en Editar perfil.') : 'Lo verán todos tus amigos aceptados.'; };
    form.querySelectorAll('[name=visibility]').forEach(r => r.onchange = paint); paint();
    const close = () => modal.remove();
    modal.onclick = e => { if (e.target === modal) close(); };
    $('[data-close]', modal).onclick = close;
    form.onsubmit = async event => {
      event.preventDefault(); const file = form.elements.media.files[0], msg = form.querySelector('.msg'), button = form.querySelector('button[type="submit"]');
      if (!file) { msg.textContent = 'Elige una foto o video.'; return; }
      if (file.size > 30 * 1024 * 1024) { msg.textContent = 'El archivo supera el límite de 30 MB.'; return; }
      if (!['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'].includes(file.type)) { msg.textContent = 'Formato no permitido. Usa JPG, PNG, WebP, MP4 o MOV.'; return; }
      button.disabled = true; msg.textContent = 'Subiendo publicación…';
      const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${ctx.user.id}/posts/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('profile-media').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) { button.disabled = false; msg.textContent = `No se pudo subir el archivo: ${uploadError.message}`; return; }
      const onlyClose = form.elements.visibility.value === 'close';
      const row = { user_id: ctx.user.id, module_key: form.elements.module_key.value, media_path: path, media_type: file.type.startsWith('video/') ? 'video' : 'image', caption: form.elements.caption.value.trim(), ...(onlyClose ? { visibility: 'close' } : {}) };
      const { error: postError } = await supabase.from('profile_posts').insert(row);
      if (postError) { await supabase.storage.from('profile-media').remove([path]); button.disabled = false; msg.textContent = `No se publicó: ${postError.message}`; return; }
      notify(onlyClose ? 'Compartido con tus mejores amigos.' : 'Publicación compartida con tus amigos.', 'success'); close();
      renderCommunity(box.closest('#view') || document.querySelector('#view'), ctx);
    };
  };
}

async function renderMembers(box, ctx) {
  const [{data:people=[],error:directoryError},{data:edges=[],error:friendError}]=await Promise.all([
    supabase.rpc('profile_directory'),
    supabase.from('friendships').select('id,requester,addressee,status,created_at').or(`requester.eq.${ctx.user.id},addressee.eq.${ctx.user.id}`),
  ]);
  if(directoryError||friendError){box.innerHTML=`<div class="card warn">No se pudo cargar el directorio: ${esc(directoryError?.message||friendError?.message||'')}</div>`;return;}
  const edgeByPerson=new Map();
  for(const edge of edges){const other=edge.requester===ctx.user.id?edge.addressee:edge.requester;edgeByPerson.set(other,edge);}
  const {data:closeRows=[]}=await supabase.from('close_friends').select('friend');
  const closeSet=new Set(closeRows.map(row=>row.friend));
  const avatars=await Promise.all(people.map(async person=>[person.id,await avatarSrc(person,1800)]));
  const avatarMap=new Map(avatars);
  box.innerHTML=`<p class="muted">Sigue a los socios del club. Las publicaciones solo se ven entre quienes se siguen y aceptan. Elige a tus mejores amigos en Editar perfil.</p><div class="community-members">${people.map(person=>{
    const relation=edgeByPerson.get(person.id), incoming=relation?.status==='pending'&&relation.addressee===ctx.user.id, outgoing=relation?.status==='pending'&&relation.requester===ctx.user.id, accepted=relation?.status==='accepted';
    const avatar=avatarMap.get(person.id), initials=(person.full_name||'BC').split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase();
    const view=`<button type="button" class="btn sm ghost" data-view-profile="${person.id}">Ver perfil</button>`;
    const action=incoming?`<span class="member-actions"><button class="btn sm" data-accept-friend="${relation.id}">Aceptar</button>${view}</span>`:accepted?`<span class="member-actions">${view}<button class="link" data-remove-friend="${relation.id}">Dejar de seguir</button></span>`:outgoing?`<span class="member-actions"><span class="muted">Solicitud enviada</span>${view}</span>`:`<span class="member-actions"><button class="btn sm" data-add-friend="${person.id}">Seguir</button>${view}</span>`;
    return `<article class="card community-member"><button type="button" class="community-avatar" data-avatar="${person.id}" aria-label="Ver foto">${avatar?avatarImg(avatar):esc(initials)}</button><b>${esc(person.full_name||'Socio Batmon')}</b>${action}</article>`;
  }).join('')||'<p class="card muted">No hay otros miembros disponibles.</p>'}</div>`;
  box.querySelectorAll('[data-avatar]').forEach(b=>b.onclick=()=>openPhotoViewer(avatarMap.get(b.dataset.avatar),people.find(x=>x.id===b.dataset.avatar)?.full_name||''));
  box.querySelectorAll('[data-close-friend]').forEach(button=>button.onclick=async()=>{
    const id=button.dataset.closeFriend,on=button.getAttribute('aria-pressed')==='true';button.disabled=true;
    const {error}=on?await supabase.from('close_friends').delete().eq('owner',ctx.user.id).eq('friend',id):await supabase.from('close_friends').insert({friend:id});
    if(error){button.disabled=false;notify(`No se pudo actualizar: ${error.message}`);return;}
    notify(on?'Quitado de mejores amigos.':'Añadido a mejores amigos.','success');renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  });
  box.querySelectorAll('[data-view-profile]').forEach(b=>b.onclick=()=>openProfileCard(ctx,b.dataset.viewProfile));
  box.querySelectorAll('[data-add-friend]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;const {error}=await supabase.from('friendships').insert({requester:ctx.user.id,addressee:button.dataset.addFriend,status:'pending'});
    if(error){button.disabled=false;notify('No se pudo enviar la solicitud: '+error.message);return;}notify('Ahora sigues a esta persona.','success');renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  });
  box.querySelectorAll('[data-accept-friend]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;const {error}=await supabase.from('friendships').update({status:'accepted'}).eq('id',button.dataset.acceptFriend).eq('addressee',ctx.user.id);
    if(error){button.disabled=false;notify('No se pudo aceptar: '+error.message);return;}notify('Ahora son amigos.','success');renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  });
  box.querySelectorAll('[data-remove-friend]').forEach(button=>button.onclick=async()=>{
    if(!(await confirmDialog('¿Quitar a este amigo?','Quitar amigo')))return;
    const {error}=await supabase.from('friendships').delete().eq('id',button.dataset.removeFriend);
    if(error){notify(error.message);return;}renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  });
}
