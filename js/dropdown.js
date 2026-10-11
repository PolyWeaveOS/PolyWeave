'use strict';
// =====================================================================
//  Styled drop-downs: every <select> in the menus gets a dark, rounded drop-down with a yellow highlight in
//  place of the browser's own white list. The real <select> stays (hidden) and keeps the value, so the code
//  that reads it or listens for 'change' works as before. Loaded last (after the menus have set their values).
// =====================================================================
const Dropdowns = {
  all: [],
  make(sel) {
    const box = document.createElement('div'), btn = document.createElement('button'), list = document.createElement('div');
    box.className = 'dd'; btn.type = 'button'; btn.className = 'ddBtn'; list.className = 'ddList hidden';
    sel.after(box); box.append(sel, btn, list); sel.classList.add('ddNative');
    const sync = () => {
      const o = sel.options[sel.selectedIndex]; btn.textContent = o ? o.textContent : '';
      for (const it of list.children) it.classList.toggle('sel', it.dataset.v === sel.value);
    };
    const close = () => { list.classList.add('hidden'); box.classList.remove('open'); };
    const open = () => { Dropdowns.closeAll(); sync(); list.classList.remove('hidden'); box.classList.add('open'); };
    for (const o of sel.options) {
      const it = document.createElement('div'); it.className = 'ddItem'; it.textContent = o.textContent; it.dataset.v = o.value;
      it.onclick = e => {
        e.preventDefault(); e.stopPropagation();
        if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        close(); sync();
      };
      list.appendChild(it);
    }
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); if (list.classList.contains('hidden')) open(); else close(); };
    sel.addEventListener('change', sync);
    sync();
    this.all.push({ sync, close });
  },
  closeAll() { for (const d of this.all) d.close(); },
  syncAll() { for (const d of this.all) d.sync(); },
};
document.querySelectorAll('#menu select').forEach(s => Dropdowns.make(s));
document.addEventListener('click', () => Dropdowns.closeAll());           // (clicking anywhere else closes it)
addEventListener('keydown', e => { if (e.key === 'Escape') Dropdowns.closeAll(); });
// changing screens: close any open list, and show values the game may have changed in the meantime
{ const prev = show; show = id => { prev(id); Dropdowns.closeAll(); Dropdowns.syncAll(); }; }
