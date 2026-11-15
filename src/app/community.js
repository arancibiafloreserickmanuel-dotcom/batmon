import { supabase, $, esc } from '../supabase.js';
import { confirmDialog, notify } from './common.js';

let section = 'activity';
const MODULES = [['running','Running'],['cycling','Ciclismo'],['plyo','Pliometría'],['training','Entrenamiento'],['swimming','Natación']];

export async function renderCommunity(view, ctx) {
  view.innerHTML = `<section class="community-page"><h1>Club</h1><p class="muted">Actividad deportiva y miembros de Batmon Crowd.</p><div class="tabs sub" role="tablist"><button data-community-tab="activity">Actividad</button><button data-community-tab="members">Miembros</button><button data-community-tab="challenges">Retos</button></div><div id="community-content"><p class="card muted">Cargando comunidad…</p></div></section>`;
  view.querySelectorAll('[data-community-tab]').forEach(button => {
    button.classList.toggle('on', button.dataset.communityTab === section);
    button.onclick = () => { section = button.dataset.communityTab; renderCommunity(view, ctx); };
  });
  const box = $('#community-content', view);
  if (section === 'members') await renderMembers(box, ctx);
  else if(section==='challenges') await renderChallenges(box,ctx);
  else await renderActivity(box, ctx);
}

async function renderChallenges(box, ctx) {
  const [{data:challenges=[],error:challengeError},{data:joined=[],error:joinedError}]=await Promise.all([
    supabase.from('club_challenges').select('*').order('starts_on',{ascending:false}),
    supabase.from('challenge_participants').select('challenge_id').eq('user_id',ctx.user.id),
  ]);
  if(challengeError||joinedError){box.innerHTML=`<div class="card warn">No se pudieron cargar los retos. Comprueba que esté aplicada la migración 0015: ${esc(challengeError?.message||joinedError?.message||'')}</div>`;return;}
  if(!challenges.length){box.innerHTML='<div class="card profile-empty">Todavía no hay retos del club.</div>';return;}
  const joinedIds=new Set(joined.map(row=>row.challenge_id));
  const {data:participants=[]}=await supabase.from('challenge_participants').select('challenge_id');
  const counts=new Map();for(const row of participants||[])counts.set(row.challenge_id,(counts.get(row.challenge_id)||0)+1);
  box.innerHTML=`<div class="challenge-list">${challenges.map(challenge=>{
    const now=new Date(),start=new Date(`${challenge.starts_on}T00:00:00`),end=new Date(`${challenge.ends_on}T23:59:59`);
    const status=now<start?'Próximamente':now>end?'Finalizado':'En curso';
    const unit=challenge.metric==='distance_km'?'km':'sesiones';
    return `<article class="card challenge-card"><div class="challenge-top"><span class="notification-kind">${esc(MODULES.find(([key])=>key===challenge.discipline)?.[1]||challenge.discipline)} · ${status}</span><span>${counts.get(challenge.id)||0} participantes</span></div><h2>${esc(challenge.title)}</h2><p>${esc(challenge.description||'')}</p><p class="muted">${new Date(`${challenge.starts_on}T12:00:00`).toLocaleDateString('es-BO')} – ${new Date(`${challenge.ends_on}T12:00:00`).toLocaleDateString('es-BO')} · Meta ${challenge.goal_value} ${unit}</p><div class="quick-actions">${joinedIds.has(challenge.id)?'<span class="muted">Ya participas</span>':status==='Finalizado'?'<span class="muted">Reto finalizado</span>':`<button class="btn sm" data-join-challenge="${challenge.id}">Participar</button>`}<button type="button" class="link" data-leaderboard="${challenge.id}">Ver clasificación</button></div><div class="challenge-leaderboard" id="challenge-rank-${challenge.id}" hidden></div></article>`;
  }).join('')}</div>`;
  box.querySelectorAll('[data-join-challenge]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;const {error}=await supabase.from('challenge_participants').insert({challenge_id:button.dataset.joinChallenge,user_id:ctx.user.id});
    if(error){button.disabled=false;notify('No se pudo registrar tu participación: '+error.message);return;}notify('Ya participas en el reto.','success');renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  });
  box.querySelectorAll('[data-leaderboard]').forEach(button=>button.onclick=async()=>{
    const target=$(`#challenge-rank-${button.dataset.leaderboard}`,box);
    if(!target)return; target.hidden=!target.hidden; if(target.dataset.loaded==='true')return;
    target.innerHTML='<p class="muted">Calculando resultados reales…</p>';
    const {data:ranking=[],error}=await supabase.rpc('club_challenge_leaderboard',{p_challenge_id:button.dataset.leaderboard});
    if(error){target.innerHTML=`<p class="msg">No se pudo calcular: ${esc(error.message)}</p>`;return;}
    const challenge=challenges.find(item=>item.id===button.dataset.leaderboard);
    target.innerHTML=ranking.length?`<ol>${ranking.map((row,index)=>`<li><b>${esc(row.full_name||'Socio')}</b><span>${row.score}${challenge.metric==='distance_km'?' km':' sesiones'}${row.completed?' · Meta cumplida':''}</span></li>`).join('')}</ol>`:'<p class="muted">Aún no hay participantes con actividad registrada.</p>';
    target.dataset.loaded='true';
  });
}

async function renderActivity(box, ctx) {
  const { data: edges = [], error: friendError } = await supabase.from('friendships')
    .select('requester,addressee,status').eq('status','accepted')
    .or(`requester.eq.${ctx.user.id},addressee.eq.${ctx.user.id}`);
  if (friendError) { box.innerHTML = `<div class="card warn">No se cargó la actividad: ${esc(friendError.message)}</div>`; return; }
  const friendIds = edges.map(row => row.requester === ctx.user.id ? row.addressee : row.requester);
  const ownerIds = [ctx.user.id, ...friendIds];
  const [{ data: posts = [], error }, { data: directory = [] }] = await Promise.all([
    supabase.from('profile_posts').select('*').in('user_id', ownerIds).order('created_at',{ascending:false}).limit(50),
    supabase.rpc('profile_directory'),
  ]);
  if (error) { box.innerHTML = `<div class="card warn">No se pudo cargar el muro: ${esc(error.message)}</div>`; return; }
  if (!posts.length) {
    box.innerHTML = `${postForm()}<div class="card profile-empty">Aún no hay publicaciones tuyas ni de tus amigos. Comparte una foto o video de entrenamiento para iniciar el muro.</div>`;
    bindPostForm(box, ctx); return;
  }
  const postIds = posts.map(post => post.id);
  const [reactionResult, commentResult] = await Promise.all([
    supabase.from('post_reactions').select('post_id,user_id').in('post_id', postIds),
    supabase.from('post_comments').select('id,post_id,user_id,body,created_at').in('post_id', postIds).order('created_at',{ascending:true}),
  ]);
  const interactionsReady=!reactionResult.error&&!commentResult.error;
  const reactions=reactionResult.data||[],comments=commentResult.data||[];
  const people = new Map(directory.map(person => [person.id,person.full_name || 'Socio Batmon']));
  people.set(ctx.user.id,ctx.profile?.full_name||'Tú');
  const owner = new Map(directory.map(person => [person.id,person]));
  owner.set(ctx.user.id,{id:ctx.user.id,full_name:ctx.profile?.full_name||'Tú'});
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
      : `<img class="community-media" src="${esc(src)}" alt="Publicación de ${esc(people.get(post.user_id)||'un socio')}" loading="lazy">`
      : '<div class="card warn">El archivo ya no está disponible.</div>';
    return `<article class="card community-post" data-post-card="${post.id}"><header class="community-post-head"><span class="community-avatar">${esc((people.get(post.user_id)||'BC').split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase())}</span><div><b>${esc(people.get(post.user_id)||'Socio Batmon')}</b><small>${esc(MODULES.find(([key])=>key===post.module_key)?.[1]||post.module_key)} · ${new Date(post.created_at).toLocaleDateString('es-BO',{day:'numeric',month:'short',year:'numeric'})}</small></div></header>${content}${post.caption?`<p>${esc(post.caption)}</p>`:''}<div class="community-post-actions">${interactionsReady?`<button type="button" class="link" data-like-post="${post.id}" aria-pressed="${ownLike}">${ownLike?'♥':'♡'} ${likes.length} Me gusta</button>`:''}${post.user_id===ctx.user.id?`<button type="button" class="link" data-delete-post="${post.id}" data-media-path="${esc(post.media_path)}">Eliminar</button>`:''}</div><div class="community-comments">${interactionsReady?`${postComments.slice(-5).map(comment=>`<p><b>${esc(people.get(comment.user_id)||'Socio')}:</b> ${esc(comment.body)}</p>`).join('')}<form data-comment-form="${post.id}"><input name="body" maxlength="500" placeholder="Escribe un comentario…" aria-label="Comentario" required><button type="submit" class="link">Enviar</button></form>`:'<p class="muted">Comentarios y reacciones requieren la migración 0014.</p>'}</div></article>`;
  }).join('');
  box.innerHTML = `${postForm()}<div class="quick-actions"><a class="link" href="#inicio">Ver calendario y eventos del club</a></div><div class="community-feed">${cards}</div>`;
  bindPostForm(box, ctx);
  box.querySelectorAll('[data-like-post]').forEach(button => button.onclick = async () => {
    const postId = button.dataset.likePost;
    const action = button.getAttribute('aria-pressed') === 'true'
      ? supabase.from('post_reactions').delete().eq('post_id',postId).eq('user_id',ctx.user.id)
      : supabase.from('post_reactions').insert({post_id:postId,user_id:ctx.user.id});
    const {error: actionError} = await action;
    if (actionError) notify(`No se pudo actualizar la reacción: ${actionError.message}`);
    else renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  });
  box.querySelectorAll('[data-comment-form]').forEach(form => form.onsubmit = async event => {
    event.preventDefault(); const input=form.elements.body; const body=input.value.trim(); if(!body)return;
    const submit=form.querySelector('button'); submit.disabled=true;
    const {error: commentError}=await supabase.from('post_comments').insert({post_id:form.dataset.commentForm,user_id:ctx.user.id,body});
    if(commentError){submit.disabled=false;notify(`No se pudo comentar: ${commentError.message}`);return;}
    renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  });
  box.querySelectorAll('[data-delete-post]').forEach(button => button.onclick = async () => {
    if (!(await confirmDialog('¿Eliminar esta publicación?','Eliminar publicación'))) return;
    const postId=button.dataset.deletePost, path=button.dataset.mediaPath;
    const {error: deleteError}=await supabase.from('profile_posts').delete().eq('id',postId).eq('user_id',ctx.user.id);
    if(deleteError){notify(deleteError.message);return;}
    const {error:storageError}=await supabase.storage.from('profile-media').remove([path]);
    if(storageError)notify(`Publicación eliminada, pero no se pudo borrar el archivo: ${storageError.message}`);
    renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
  });
}

function postForm() {
  return `<form class="card community-publish" id="community-publish"><h2>Compartir entrenamiento</h2><div class="row"><label>Disciplina<select name="module_key">${MODULES.map(([key,title])=>`<option value="${key}">${title}</option>`).join('')}</select></label><label>Foto o video<input type="file" name="media" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" required></label></div><label>Descripción<input name="caption" maxlength="500" placeholder="¿Qué entrenaste hoy?"></label><button class="btn" type="submit">Publicar</button><p class="msg" aria-live="polite"></p></form>`;
}

function bindPostForm(box, ctx) {
  const form=$('#community-publish',box); if(!form)return;
  form.onsubmit=async event=>{
    event.preventDefault(); const file=form.elements.media.files[0], msg=form.querySelector('.msg'), button=form.querySelector('button[type="submit"]');
    if(!file)return;
    if(file.size>30*1024*1024){msg.textContent='El archivo supera el límite de 30 MB.';return;}
    if(!['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'].includes(file.type)){msg.textContent='Formato no permitido. Usa JPG, PNG, WebP, MP4 o MOV.';return;}
    button.disabled=true; msg.textContent='Subiendo publicación…';
    const ext=file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'');
    const path=`${ctx.user.id}/posts/${crypto.randomUUID()}.${ext}`;
    const {error: uploadError}=await supabase.storage.from('profile-media').upload(path,file,{contentType:file.type,upsert:false});
    if(uploadError){button.disabled=false;msg.textContent=`No se pudo subir el archivo: ${uploadError.message}`;return;}
    const row={user_id:ctx.user.id,module_key:form.elements.module_key.value,media_path:path,media_type:file.type.startsWith('video/')?'video':'image',caption:form.elements.caption.value.trim()};
    const {error: postError}=await supabase.from('profile_posts').insert(row);
    if(postError){await supabase.storage.from('profile-media').remove([path]);button.disabled=false;msg.textContent=`No se publicó: ${postError.message}`;return;}
    notify('Publicación compartida con tus amigos.','success'); renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
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
  const avatars=await Promise.all(people.map(async person=>{
    if(!person.avatar_path)return [person.id,''];
    const {data}=await supabase.storage.from('profile-media').createSignedUrl(person.avatar_path,1800);
    return [person.id,data?.signedUrl||''];
  }));
  const avatarMap=new Map(avatars);
  box.innerHTML=`<p class="muted">Las publicaciones del muro solo se muestran entre amigos aceptados.</p><div class="community-members">${people.map(person=>{
    const relation=edgeByPerson.get(person.id), incoming=relation?.status==='pending'&&relation.addressee===ctx.user.id, outgoing=relation?.status==='pending'&&relation.requester===ctx.user.id, accepted=relation?.status==='accepted';
    const avatar=avatarMap.get(person.id), initials=(person.full_name||'BC').split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase();
    const action=incoming?`<button class="btn sm" data-accept-friend="${relation.id}">Aceptar</button>`:accepted?`<button class="link" data-remove-friend="${relation.id}">Amigos · Quitar</button>`:outgoing?'<span class="muted">Solicitud enviada</span>':`<button class="btn sm" data-add-friend="${person.id}">Agregar amigo</button>`;
    return `<article class="card community-member"><span class="community-avatar">${avatar?`<img src="${esc(avatar)}" alt="">`:esc(initials)}</span><b>${esc(person.full_name||'Socio Batmon')}</b>${action}</article>`;
  }).join('')||'<p class="card muted">No hay otros miembros disponibles.</p>'}</div>`;
  box.querySelectorAll('[data-add-friend]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;const {error}=await supabase.from('friendships').insert({requester:ctx.user.id,addressee:button.dataset.addFriend,status:'pending'});
    if(error){button.disabled=false;notify('No se pudo enviar la solicitud: '+error.message);return;}notify('Solicitud de amistad enviada.','success');renderCommunity(box.closest('#view')||document.querySelector('#view'),ctx);
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
