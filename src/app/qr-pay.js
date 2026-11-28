// QR de pago: datos guardados y marco animado (lo usan la vista del cliente y el panel de administración).
import './qr-pay.css';
import { supabase } from '../supabase.js';
import { today } from './common.js';

export const QR_DEFAULT = '/qr-pago.webp';
export const QR_ANIMS = [['scan', 'Escáner'], ['focus', 'Enfoque'], ['orbit', 'Borde en giro'], ['mosaic', 'Mosaico']];

export async function loadPaymentQr() {
  const { data, error } = await supabase.from('payment_qr').select('image_path, expires_on, animation, animation_on').eq('id', 1).maybeSingle();
  return { row: data || null, error };
}
export const qrUrl = (path) => (path ? supabase.storage.from('payment-qr').getPublicUrl(path).data.publicUrl : QR_DEFAULT);
export const qrExpired = (row) => Boolean(row?.expires_on && row.expires_on < today()); // el día indicado todavía vale
export const qrDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' });

/** Marco con la animación encima; `anim` vacío = QR quieto. */
export const qrFrame = (src, anim = '') => `<div class="qr-fx" data-fx="${anim}"><div class="qr-fx__box"><img class="qr-fx__img" src="${src}" alt="QR para pagar la membresía"><div class="qr-fx__tiles" aria-hidden="true">${'<i></i>'.repeat(36)}</div><span class="qr-fx__line" aria-hidden="true"></span></div><span class="qr-fx__corners" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>`;

/** Pone el QR vigente dentro de `box` (vista del cliente). */
export async function mountPaymentQr(box) {
  box.innerHTML = '<p class="muted qr-note">Cargando QR…</p>';
  const { row } = await loadPaymentQr(); // sin la migración 0034 se muestra el QR de siempre
  if (qrExpired(row)) { box.innerHTML = `<p class="card alertbox qr-note">Este QR venció el ${qrDate(row.expires_on)}. Avisa al administrador para que lo actualice.</p>`; return; }
  box.innerHTML = qrFrame(qrUrl(row?.image_path), row?.animation_on ? row.animation : '') + (row?.expires_on ? `<p class="muted qr-note">Válido hasta el <b>${qrDate(row.expires_on)}</b></p>` : '');
}
