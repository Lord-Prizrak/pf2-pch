/* pf2e-field-button — кнопка (Web Component).
   Атрибут action ("hp:-1", "export:html", ...) вешает обработчик из
   реестра window.PF2E_ACTIONS (wireActions в app.js). */
(function () {
  if (!window.customElements || window.customElements.get('pf2e-field-button')) return;
  class Pf2eFieldButton extends HTMLElement {
    connectedCallback() {
      if (this._btn) return;
      var b = document.createElement('button');
      b.type = this.getAttribute('type') || 'button';
      if (this.textContent.trim()) b.textContent = this.textContent.trim();
      if (this.className) b.className = this.className;
      var act = this.getAttribute('action');
      if (act) b.setAttribute('data-action', act);
      this.textContent = '';
      this.appendChild(b);
      this._btn = b;
      if (act && window.PF2E_ACTIONS && typeof window.PF2E_ACTIONS[act] === 'function') {
        b.addEventListener('click', function (ev) { ev.preventDefault(); window.PF2E_ACTIONS[act](ev, b); });
      }
    }
    get control() { return this._btn; }
  }
  window.customElements.define('pf2e-field-button', Pf2eFieldButton);
})();
