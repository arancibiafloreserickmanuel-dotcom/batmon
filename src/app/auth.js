import { supabase, $ } from '../supabase.js';

const userPattern = '^[a-zA-Z0-9_.-]{3,24}$';

function themeName() {
  // Al entrar sin sesión todavía no conocemos la preferencia guardada del usuario.
  return document.body.dataset.theme || 'light';
}

function inputField(id, label, type = 'text', attrs = '') {
  return `<div class="auth-field"><input id="${id}" class="auth-input" type="${type}" placeholder=" " ${attrs}><svg class="auth-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><label class="auth-label" for="${id}">${label}</label></div>`;
}

function friendlySignupError(error) {
  const message = String(error?.message || '');
  if (/FunctionsFetchError|Failed to fetch/i.test(message)) {
    return 'No se pudo conectar con Supabase. Revisa tu conexión e inténtalo de nuevo.';
  }
  return message || 'No se pudo crear la cuenta. Inténtalo de nuevo.';
}

async function edgeFunctionError(error, fallback) {
  try {
    const response = error?.context;
    if (response && typeof response.clone === 'function') {
      const body = await response.clone().json();
      if (typeof body?.error === 'string' && body.error.trim()) return body.error;
    }
  } catch { /* Si la respuesta no es JSON, usar el mensaje general. */ }
  const message = String(error?.message || '');
  if (/FunctionsFetchError|Failed to fetch/i.test(message)) return 'No se pudo conectar con Supabase. Revisa tu conexión e inténtalo de nuevo.';
  return fallback;
}

export function showLogin(view, signup = false) {
  $('#tabs').hidden = true;
  const theme = themeName();
  document.body.dataset.theme = theme;
  view.innerHTML = `
    <section class="auth-layout"><a class="auth-back" href="/" aria-label="Volver a la página principal">← Volver</a><h1>Bienvenido<br>al Crowd</h1><p class="muted">${signup ? 'Crea tu cuenta de socio.' : 'Ingresa con tu usuario.'}</p>
    <form id="lf" class="auth-card auth-theme-${theme}">
      <p class="auth-title">${signup ? 'Crear cuenta' : 'Iniciar sesión'}</p>
      ${signup ? inputField('nm', 'Nombre completo', 'text', 'autocomplete="name" maxlength="100" required') : ''}
      ${signup ? inputField('username', 'Usuario', 'text', `autocomplete="username" autocapitalize="none" minlength="3" maxlength="24" pattern="${userPattern}" required`) : inputField('username', 'Usuario', 'text', 'autocomplete="username" autocapitalize="none" required')}
      ${signup ? inputField('carnet', 'Número de carnet', 'text', 'autocomplete="off" maxlength="32" required') : ''}
      ${signup ? `${inputField('phone', 'Número de teléfono (8 dígitos)', 'tel', 'autocomplete="tel-national" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" required')}<small class="auth-hint">Lo usaremos para recuperar tu contraseña. No enviaremos SMS.</small>` : ''}
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
    message.textContent = '';
    try {
      if (signup) {
        const payload = {
          full_name: $('#nm', view).value.trim(),
          username: $('#username', view).value.trim().toLowerCase(),
          carnet_number: $('#carnet', view).value.trim().toUpperCase(),
          recovery_phone: $('#phone', view).value.replace(/\D/g, ''),
          contact_email: $('#em', view).value.trim(),
          password: $('#pw', view).value,
        };
        if (!/^\d{8}$/.test(payload.recovery_phone)) throw new Error('Escribe tu número de teléfono de 8 dígitos.');
        const { data, error } = await supabase.functions.invoke('username-signup', { body: payload });
        if (error) throw new Error(await edgeFunctionError(error, 'No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.'));
        if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'El registro no devolvió una sesión. Inténtalo de nuevo.');
        const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
        if (sessionError) throw sessionError;
        return;
      }

      const username = $('#username', view).value.trim();
      const password = $('#pw', view).value;
      if (username.includes('@')) {
        // Cuentas antiguas pueden usar correo y contraseña si alguna vez la configuraron.
        const { error } = await supabase.auth.signInWithPassword({ email: username, password });
        if (error) throw new Error('No se pudo entrar con esa contraseña. Si esta cuenta se creó con Google, entra con el botón Google; después puedes configurar usuario y contraseña en Perfil → Configuración.');
        return;
      }
      const { data, error } = await supabase.functions.invoke('username-login', { body: { username, password } });
      if (error) throw new Error(await edgeFunctionError(error, 'No se pudo iniciar sesión. Revisa tu usuario y contraseña.'));
      if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'Usuario o contraseña incorrectos.');
      const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (sessionError) throw sessionError;
    } catch (error) {
      message.textContent = signup ? friendlySignupError(error) : error.message || 'Usuario o contraseña incorrectos.';
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
  view.innerHTML = `<section class="auth-layout"><button class="auth-back" id="recovery-login" type="button">← Volver al inicio de sesión</button><h1>Recuperar<br>contraseña</h1><p class="muted">Escribe tu usuario y el número de 8 dígitos registrado y elige una contraseña nueva.</p><form id="recovery-form" class="auth-card auth-theme-${themeName()}"><p class="auth-title">Verifica tu número</p>${inputField('recovery-username', 'Usuario', 'text', 'autocomplete="username" autocapitalize="none" required')}${inputField('recovery-phone', 'Número de teléfono (8 dígitos)', 'tel', 'autocomplete="tel-national" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" required')}${inputField('new-password', 'Nueva contraseña', 'password', 'autocomplete="new-password" minlength="8" required')}${inputField('confirm-password', 'Repite la contraseña', 'password', 'autocomplete="new-password" minlength="8" required')}<small class="auth-hint">No enviaremos mensajes ni códigos. Si tu cuenta admin se creó con Google, entra con Google y configura una contraseña en Perfil → Configuración.</small><p class="auth-msg" id="recovery-msg" aria-live="polite"></p><button class="auth-submit" type="submit">Cambiar contraseña</button></form></section>`;
  $('#recovery-login', view).onclick = () => showLogin(view);
  $('#recovery-form', view).onsubmit = async (event) => {
    event.preventDefault();
    const button = $('.auth-submit', view);
    const message = $('#recovery-msg', view);
    const phone = $('#recovery-phone', view).value.replace(/\D/g, '');
    const password = $('#new-password', view).value;
    if (!/^\d{8}$/.test(phone)) { message.textContent = 'El número debe tener exactamente 8 dígitos.'; return; }
    if (password !== $('#confirm-password', view).value) { message.textContent = 'Las contraseñas no coinciden.'; return; }
    button.disabled = true;
    const { data, error } = await supabase.functions.invoke('account-recovery', {
      body: { action: 'change', username, phone, new_password: password },
    });
    if (error || !data?.ok) {
      message.textContent = error
        ? await edgeFunctionError(error, 'No se pudo cambiar la contraseña. Revisa el número e inténtalo de nuevo.')
        : data?.error || 'No se pudo cambiar la contraseña. Revisa el número e inténtalo de nuevo.';
      button.disabled = false;
      return;
    }
    view.innerHTML = `<section class="auth-layout"><h1>Cuenta<br>recuperada</h1><section class="auth-card auth-theme-${themeName()}"><p class="auth-title">Contraseña actualizada</p><p class="muted">Ya puedes iniciar sesión con tu usuario y contraseña.</p><button class="auth-submit" id="recovery-done" type="button">Volver al inicio</button></section></section>`;
    $('#recovery-done', view).onclick = () => showLogin(view);
  };
}

export function hasMemberIdentity(_user, profile) {
  return Boolean(profile?.username && profile?.carnet_number && profile?.recovery_phone);
}

export function showIdentitySetup(view, _user, _profile = {}, onAccept = () => {}) {
  $('#tabs').hidden = true;
  view.innerHTML = `<section class="auth-layout"><h1>Tu cuenta</h1><section class="auth-card auth-theme-${themeName()}"><p class="auth-title">¡Bienvenido al Crowd!</p><p class="muted">Tu sesión está lista. Ya puedes entrar a la comunidad.</p><button class="auth-submit" id="identity-accept" type="button">Aceptar</button></section></section>`;
  $('#identity-accept', view).onclick = onAccept;
}
