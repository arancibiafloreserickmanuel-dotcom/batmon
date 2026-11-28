// Fotos de perfil: la subida propia manda; si no hay, se usa la de la cuenta de Google.
import { closeButton } from './common.js';
import { supabase, esc } from '../supabase.js';

export const initialsOf = (name) => (name || 'BC').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

/** URL mostrable de una persona ({avatar_path, avatar_url}); '' si no tiene foto. */
export async function avatarSrc(person, seconds = 3600) {
  if (!person) return '';
  if (person.avatar_path) {
    const { data } = await supabase.storage.from('profile-media').createSignedUrl(person.avatar_path, seconds);
    if (data?.signedUrl) return data.signedUrl;
  }
  return person.avatar_url || '';
}

/** <img> de avatar (los enlaces de Google exigen no enviar referrer). */
export const avatarImg = (src, alt = '') => `<img src="${esc(src)}" alt="${esc(alt)}" referrerpolicy="no-referrer" loading="lazy">`;

/** Guarda la foto de Google en el perfil la primera vez, para que los demás socios también la vean. */
export async function syncGoogleAvatar(user, profile) {
  const url = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  if (!url || !profile || profile.avatar_path || profile.avatar_url === url) return;
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
  if (!error) profile.avatar_url = url; // sin la migración 0024 falla en silencio y se usa la URL local
  else profile.avatar_url = profile.avatar_url || url;
}

/** Visor grande de la foto, como en Instagram. */
export function openPhotoViewer(src, name = '') {
  if (!src) return;
  const modal = document.createElement('div');
  modal.className = 'modal photo-viewer';
  modal.innerHTML = `<section class="photo-viewer__box" role="dialog" aria-modal="true" aria-label="Foto de ${esc(name)}">${closeButton('', 'photo-viewer__close')}<img src="${esc(src)}" alt="Foto de ${esc(name)}" referrerpolicy="no-referrer">${name ? `<p>${esc(name)}</p>` : ''}</section>`;
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  modal.onclick = (e) => { if (e.target === modal || e.target.closest('.photo-viewer__close')) close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(modal);
  modal.querySelector('.photo-viewer__close').focus();
}
