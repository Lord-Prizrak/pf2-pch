/* pf2e-field-text — текстовое поле (Web Component).
   Источник: frontend/src/fields/field-text.js, встраивается сборщиком build.py. */
(function () {
  if (!window.customElements || window.customElements.get('pf2e-field-text')) return;
  class Pf2eFieldText extends HTMLElement {
    connectedCallback() {
      if (this._ctl) return;
      var inp = document.createElement('input');
      inp.type = 'text';
      if (this.hasAttribute('bind')) inp.setAttribute('data-bind', this.getAttribute('bind'));
      if (this.hasAttribute('placeholder')) inp.placeholder = this.getAttribute('placeholder');
      if (this.className) inp.className = this.className;
      this.appendChild(inp);
      this._ctl = inp;
    }
    get control() { return this._ctl; }
  }
  window.customElements.define('pf2e-field-text', Pf2eFieldText);
})();
