/* pf2e-field-textarea — многострочное поле (Web Component). */
(function () {
  if (!window.customElements || window.customElements.get('pf2e-field-textarea')) return;
  class Pf2eFieldTextarea extends HTMLElement {
    connectedCallback() {
      if (this._ctl) return;
      var ta = document.createElement('textarea');
      ta.rows = parseInt(this.getAttribute('rows') || '3', 10);
      if (this.getAttribute('spellcheck') === 'false') ta.setAttribute('spellcheck', 'false');
      if (this.hasAttribute('bind')) ta.setAttribute('data-bind', this.getAttribute('bind'));
      if (this.hasAttribute('placeholder')) ta.placeholder = this.getAttribute('placeholder');
      if (this.className) ta.className = this.className;
      this.appendChild(ta);
      this._ctl = ta;
    }
    get control() { return this._ctl; }
  }
  window.customElements.define('pf2e-field-textarea', Pf2eFieldTextarea);
})();
