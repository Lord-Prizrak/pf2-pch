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
      var act = this.getAttribute('action') || this.getAttribute('data-action');
      if (act) b.setAttribute('data-action', act);
      var hpAttr = this.getAttribute('hp');
      if (hpAttr != null) b.setAttribute('data-hp', hpAttr);
      this.textContent = '';
      this.appendChild(b);
      this._btn = b;
      if (act) {
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          /* реестр PF2E_ACTIONS может быть заполнен позже connectedCallback
             (wireActions вызывается в boot после монтирования блоков) —
             ищем функцию в момент клика */
          var fn = window.PF2E_ACTIONS && window.PF2E_ACTIONS[act];
          if (typeof fn === 'function') fn(ev, b);
        });
      }
    }
    get control() { return this._btn; }
  }
  window.customElements.define('pf2e-field-button', Pf2eFieldButton);
})();
