import { supabase, $, esc } from '../supabase.js';

const OTP_LENGTH = 6;
const userPattern = '^[a-zA-Z0-9_.-]{3,24}$';

function themeName() {
  // Al entrar sin sesión todavía no conocemos la preferencia guardada del usuario.
  // La pantalla de acceso empieza en claro para que fondo y tarjeta no se contradigan.
  return document.body.dataset.theme || 'light';
}

function inputField(id, label, type = 'text', attrs = '') {
  return `<div class="auth-field"><input id="${id}" class="auth-input" type="${type}" placeholder=" " ${attrs}><svg class="auth-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><label class="auth-label" for="${id}">${label}</label></div>`;
}

function otpBoxes() {
  return `<div class="auth-otp" role="group" aria-label="Código de verificación">${Array.from({ length: OTP_LENGTH }, (_, i) => `<input class="auth-otp-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Dígito ${i + 1} de ${OTP_LENGTH}" required>`).join('')}</div>`;
}

function bindOtpInputs(root) {
  const inputs = [...root.querySelectorAll('.auth-otp-input')];
  inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value && inputs[index + 1]) inputs[index + 1].focus();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value && inputs[index - 1]) inputs[index - 1].focus();
      if (event.key === 'ArrowLeft' && inputs[index - 1]) { event.preventDefault(); inputs[index - 1].focus(); }
      if (event.key === 'ArrowRight' && inputs[index + 1]) { event.preventDefault(); inputs[index + 1].focus(); }
    });
    input.addEventListener('paste', (event) => {
      const digits = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
      if (!digits) return;
      event.preventDefault();
      digits.split('').forEach((digit, i) => { if (inputs[i]) inputs[i].value = digit; });
      inputs[Math.min(digits.length, inputs.length - 1)]?.focus();
    });
  });
}

function otpValue(root) {
  return [...root.querySelectorAll('.auth-otp-input')].map((input) => input.value).join('');
}

function normalizePhone(value) {
  const clean = String(value || '').trim().replace(/[\s().-]/g, '');
  if (clean.startsWith('+')) return `+${clean.slice(1).replace(/\D/g, '')}`;
  const digits = clean.replace(/\D/g, '');
  if (/^591\d{8,9}$/.test(digits)) return `+${digits}`;
  if (/^[67]\d{7}$/.test(digits)) return `+591${digits}`;
  return `+${digits}`;
}

function validPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function digitsError(error) {
  const message = String(error?.message || '');
  if (/phone_provider_disabled|phone signups are disabled/i.test(message)) {
    return 'Supabase tiene desactivado el proveedor Teléfono. Actívalo en Autenticación → Proveedores → Teléfono y desactiva Confirmar teléfono para no enviar SMS al registrarte.';
  }
  if (error?.message?.includes('FunctionsFetchError') || error?.message?.includes('Failed to fetch')) {
    return 'No se pudo conectar con la verificación SMS. Revisa la configuración del servidor.';
  }
  return message || 'Ocurrió un error. Inténtalo de nuevo.';
}

export function showLogin(view, signup = false) {
  $('#tabs').hidden = true;
  const theme = themeName();
  document.body.dataset.theme = theme;
  view.innerHTML = `
    <section class="auth-layout"><a class="auth-back" href="/" aria-label="Volver a la página principal">← Volver</a><h1>Bienvenido<br>al Crowd</h1><p class="muted">${signup ? 'Crea tu cuenta de socio.' : 'Ingresa con tu usuario.'}</p>
    <form id="lf" class="auth-card auth-theme-${theme}">
      <p class="auth-title">${signup ? 'Crear cuenta' : 'Iniciar sesión'}</p>
      ${signup ? inputField('nm', 'Nombre completo', 'text', 'autocomplete="name" required') : ''}
      ${signup ? inputField('username', 'Usuario', 'text', `autocomplete="username" autocapitalize="none" minlength="3" maxlength="24" pattern="${userPattern}" required`) : inputField('username', 'Usuario', 'text', 'autocomplete="username" autocapitalize="none" required')}
      ${signup ? inputField('carnet', 'Número de carnet', 'text', 'autocomplete="off" maxlength="32" required') : ''}
      ${signup ? `${inputField('phone', 'Número de teléfono', 'tel', 'autocomplete="tel" inputmode="tel" required')}<small class="auth-hint">Lo asociamos a tu cuenta. No enviaremos un código para registrarte.</small>` : ''}
      ${signup ? inputField('em', 'Correo electrónico (opcional)', 'email', 'autocomplete="email"') : ''}
      ${inputField('pw', 'Contraseña', 'password', `minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" required`)}
      <button class="auth-submit" type="submit">${signup ? 'Crear cuenta' : 'Entrar'}</button><p class="auth-msg" id="lm" aria-live="polite"></p>
      <div class="auth-footer">${!signup ? '<button class="auth-forgot" type="button" id="forgot">¿Olvidaste tu contraseña?</button>' : ''}<button class="auth-switch" type="button" id="tg">${signup ? 'Ya tengo cuenta' : 'Crear cuenta'}</button></div>
    </form>
    <!-- Mantener esta lista extensible para agregar otros proveedores OAuth en el futuro. -->
    <section class="auth-social" aria-label="Otras formas de acceso"><p>${signup ? 'O regístrate con' : 'O inicia sesión con'}</p><ul class="example-2"><li class="icon-content"><button id="google-login" class="social-button" type="button" aria-label="${signup ? 'Registrarse' : 'Iniciar sesión'} con Google" data-social="google"><span class="filled"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.35 5.35 0 0 1-2.2 3.31v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.15v2.84A11 11 0 0 0 12 23z"/><path fill="#fbbc05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.15a11 11 0 0 0 0 9.88l3.69-2.84z"/><path fill="#ea4335" d="M12 4.37c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.55 10.55 0 0 0 12 0 11 11 0 0 0 2.15 7.06l3.69 2.84C6.71 7.3 9.14 4.37 12 4.37z"/></svg></button><span class="tooltip">Google</span></li></ul></section></section>`;

  $('#tg').onclick = () => showLogin(view, !signup);
  const forgot = $('#forgot');
  if (forgot) forgot.onclick = () => showRecovery(view);

  $('#lf').onsubmit = async (event) => {
    event.preventDefault();
    const button = $('.auth-submit', view);
    button.disabled = true;
    const message = $('#lm', view);
    try {
      if (signup) {
        const username = $('#username', view).value.trim().toLowerCase();
        const carnet = $('#carnet', view).value.trim().toUpperCase();
        const phone = normalizePhone($('#phone', view).value);
        if (!validPhone(phone)) throw new Error('Escribe un teléfono válido en formato internacional.');
        const { data, error } = await supabase.auth.signUp({
          phone,
          password: $('#pw', view).value,
          options: { data: {
            full_name: $('#nm', view).value.trim(),
            username,
            carnet_number: carnet,
            contact_email: $('#em', view).value.trim() || null,
          } },
        });
        if (error) throw error;
        if (!data.session) {
          message.textContent = 'Supabase está pidiendo confirmar el teléfono por SMS. Para registrarte sin mensajes, desactiva “Confirmar teléfono” en Autenticación → Proveedores → Teléfono. Si quedó una cuenta pendiente, elimínala desde Authentication → Users antes de volver a intentarlo.';
          button.disabled = false;
        }
        return;
      }

      const username = $('#username', view).value.trim();
      const password = $('#pw', view).value;
      if (username.includes('@')) {
        // Compatibilidad durante el alta del nuevo flujo: las cuentas previas aún entran con correo.
        const { error } = await supabase.auth.signInWithPassword({ email: username, password });
        if (error) throw new Error('Usuario o contraseña incorrectos.');
        return;
      }
      const { data, error } = await supabase.functions.invoke('username-login', { body: { username, password } });
      if (error || !data?.access_token || !data?.refresh_token) {
        throw new Error(error ? 'El acceso por usuario aún no está desplegado en Supabase.' : 'Usuario o contraseña incorrectos.');
      }
      const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (sessionError) throw sessionError;
    } catch (error) {
      message.textContent = signup ? digitsError(error) : error.message || 'Usuario o contraseña incorrectos.';
      button.disabled = false;
    }
  };

  $('#google-login').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    $('#lm', view).textContent = 'Conectando con Google…';
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/app.html` } });
    if (error) {
      $('#lm', view).textContent = `No se pudo iniciar con Google: ${error.message}`;
      button.disabled = false;
    }
  };
}

function showRecovery(view) {
  view.innerHTML = `<section class="auth-layout"><button class="auth-back" id="recovery-login" type="button">← Volver al inicio de sesión</button><h1>Recuperar<br>contraseña</h1><p class="muted">Escribe el teléfono asociado a tu cuenta. Te enviaremos un código por SMS.</p><form id="recovery-start" class="auth-card auth-theme-${themeName()}"><p class="auth-title">Tu teléfono</p>${inputField('recovery-phone', 'Número de teléfono', 'tel', 'autocomplete="tel" inputmode="tel" required')}<small class="auth-hint">Bolivia: escribe tu número móvil o usa el formato +591.</small><p class="auth-msg" id="recovery-start-msg" aria-live="polite"></p><button class="auth-submit" type="submit">Enviar código</button></form></section>`;
  $('#recovery-login', view).onclick = () => showLogin(view);
  $('#recovery-start', view).onsubmit = async (event) => {
    event.preventDefault();
    const button = $('.auth-submit', view);
    const message = $('#recovery-start-msg', view);
    button.disabled = true;
    const phone = normalizePhone($('#recovery-phone', view).value);
    if (!validPhone(phone)) {
      message.textContent = 'Escribe un número válido, por ejemplo +591 70000000.';
      button.disabled = false;
      return;
    }
    const { data, error } = await supabase.functions.invoke('account-recovery', {
      body: { action: 'start', phone },
    });
    if (error) {
      message.textContent = 'No se pudo enviar el SMS. Inténtalo de nuevo más tarde.';
      button.disabled = false;
      return;
    }
    showRecoveryVerification(view, { phone, message: data?.message || 'Si el número está asociado a una cuenta, recibirás un código SMS.' });
  };
}

function showRecoveryVerification(view, recovery) {
  view.innerHTML = `<section class="auth-layout"><button class="auth-back" id="recovery-back" type="button">← Volver</button><h1>Verifica tu<br>cuenta</h1><p class="muted">${esc(recovery.message)}</p><form id="recovery-verify" class="auth-card auth-theme-${themeName()}"><p class="auth-title">Código SMS</p>${otpBoxes()}${inputField('new-password', 'Nueva contraseña', 'password', 'autocomplete="new-password" minlength="8" required')}${inputField('confirm-password', 'Repite la contraseña', 'password', 'autocomplete="new-password" minlength="8" required')}<p class="auth-msg" id="recovery-verify-msg" aria-live="polite"></p><button class="auth-submit" type="submit">Cambiar contraseña</button></form></section>`;
  bindOtpInputs(view);
  $('#recovery-back', view).onclick = () => showRecovery(view);
  $('#recovery-verify', view).onsubmit = async (event) => {
    event.preventDefault();
    const message = $('#recovery-verify-msg', view);
    const token = otpValue(view);
    const password = $('#new-password', view).value;
    if (token.length !== OTP_LENGTH) { message.textContent = `Ingresa los ${OTP_LENGTH} dígitos del mensaje.`; return; }
    if (password !== $('#confirm-password', view).value) { message.textContent = 'Las contraseñas no coinciden.'; return; }
    const button = $('.auth-submit', view);
    button.disabled = true;
    const { data, error } = await supabase.functions.invoke('account-recovery', {
      body: { action: 'verify', phone: recovery.phone, token, new_password: password },
    });
    if (error) {
      message.textContent = 'El código no es válido o venció. Revisa los datos e inténtalo de nuevo.';
      button.disabled = false;
      return;
    }
    view.innerHTML = `<section class="auth-layout"><h1>Cuenta<br>recuperada</h1><section class="auth-card auth-theme-${themeName()}"><p class="auth-title">Contraseña actualizada</p><p class="muted">${esc(data?.message || 'Ya puedes iniciar sesión con tu usuario y contraseña.')}</p><button class="auth-submit" id="recovery-done" type="button">Volver al inicio</button></section></section>`;
    $('#recovery-done', view).onclick = () => showLogin(view);
  };
}

export function hasMemberIdentity(user, profile) {
  return Boolean(profile?.username && profile?.carnet_number && user?.phone);
}

export function showIdentitySetup(view, user, profile = {}, onAccept = () => {}) {
  $('#tabs').hidden = true;
  view.innerHTML = `<section class="auth-layout"><h1>Tu cuenta</h1><p class="muted">Tu sesión está lista. Si olvidas tu contraseña, podrás recuperarla por SMS si tu cuenta tiene un teléfono asociado.</p><section class="auth-card auth-theme-${themeName()}"><p class="auth-title">¡Bienvenido al Crowd!</p><button class="auth-submit" id="identity-accept" type="button">Aceptar</button></section></section>`;
  $('#identity-accept', view).onclick = onAccept;
}
