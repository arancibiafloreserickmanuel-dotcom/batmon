// Desplegable propio (neumórfico + animado) que reemplaza visualmente a todos los <select> de la app.
// El <select> original se conserva oculto y sincronizado: todo el código existente (value, onchange, oninput) sigue funcionando.
const VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const CHEVRON = '<svg class="dd-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';
let openDd = null;

const closeOpen = () => { if (openDd) { openDd.close(); } };
document.addEventListener('pointerdown', (e) => { if (openDd && !openDd.wrap.contains(e.target) && !openDd.list.contains(e.target)) closeOpen(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openDd) { e.stopPropagation(); closeOpen(); } }, true);
window.addEventListener('resize', closeOpen);
document.addEventListener('scroll', (e) => { if (openDd && !openDd.list.contains(e.target)) closeOpen(); }, true);

function enhance(sel) {
  if (sel.dataset.dd || sel.multiple || sel.size > 1 || sel.classList.contains('no-dd') || sel.closest('.no-dd')) return;
  sel.dataset.dd = '1';
  const wrap = document.createElement('div'); wrap.className = 'dd';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span class="dd-label"></span>${CHEVRON}`;
  const list = document.createElement('ul'); list.className = 'dd-list'; list.setAttribute('role', 'listbox');
  sel.parentNode.insertBefore(wrap, sel); wrap.append(btn, sel);
  sel.classList.add('dd-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  let cursor = -1;

  const label = () => { const o = sel.options[sel.selectedIndex]; btn.querySelector('.dd-label').textContent = o ? o.textContent : ''; wrap.classList.toggle('has-val', !!(o && o.value !== '')); };
  const build = () => {
    list.innerHTML = [...sel.options].map((o, i) => `<li role="option" class="dd-opt${i === sel.selectedIndex ? ' sel' : ''}${o.disabled ? ' dis' : ''}" data-i="${i}" style="--i:${i}"><span>${o.textContent.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>${CHECK}</li>`).join('');
  };
  const place = () => {
    const r = btn.getBoundingClientRect(), vh = window.innerHeight, h = Math.min(list.scrollHeight, 280), below = vh - r.bottom - 12, up = below < h && r.top > below;
    list.style.left = `${r.left}px`; list.style.width = `${r.width}px`; list.style.maxHeight = `${Math.max(120, Math.min(280, (up ? r.top : below) - 8))}px`;
    list.style.top = up ? '' : `${r.bottom + 6}px`; list.style.bottom = up ? `${vh - r.top + 6}px` : '';
    list.classList.toggle('up', up);
  };
  const setCursor = (i) => { cursor = i; list.querySelectorAll('.dd-opt').forEach((li, k) => li.classList.toggle('cur', k === i)); list.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }); };
  const pick = (i) => {
    const o = sel.options[i]; if (!o || o.disabled) return;
    const changed = sel.selectedIndex !== i; sel.selectedIndex = i; label(); close();
    if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  const api = {
    wrap, list,
    open() {
      if (sel.disabled) return; closeOpen(); build(); document.body.appendChild(list); place();
      requestAnimationFrame(() => list.classList.add('open')); wrap.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
      openDd = api; setCursor(sel.selectedIndex); list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    },
    close() {
      wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); list.classList.remove('open');
      const l = list; setTimeout(() => { if (!l.classList.contains('open')) l.remove(); }, 180); if (openDd === api) openDd = null;
    },
  };
  const close = api.close;
  btn.onclick = () => (openDd === api ? close() : api.open());
  btn.onkeydown = (e) => {
    const n = sel.options.length;
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); if (openDd !== api) api.open(); else setCursor(Math.max(0, Math.min(n - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)))); }
    else if ((e.key === 'Enter' || e.key === ' ') && openDd === api) { e.preventDefault(); pick(cursor); }
  };
  list.addEventListener('pointerdown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const li = e.target.closest('.dd-opt'); if (li) pick(+li.dataset.i); });
  Object.defineProperty(sel, 'value', { configurable: true, get() { return VALUE.get.call(sel); }, set(v) { VALUE.set.call(sel, v); label(); } });
  new MutationObserver(label).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled'] });
  sel.addEventListener('change', label);
  label();
}

export function initDropdowns(root = document.body) {
  const scan = (n) => { if (n.nodeType !== 1) return; if (n.tagName === 'SELECT') enhance(n); n.querySelectorAll?.('select').forEach(enhance); };
  scan(root);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(scan))).observe(root, { childList: true, subtree: true });
}
