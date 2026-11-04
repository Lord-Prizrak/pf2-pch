/* pf2e-field-number — числовое поле (Web Component). */
(function () {
  if (!window.customElements || window.customElements.get('pf2e-field-number')) return;
  class Pf2eFieldNumber extends HTMLElement {
    connectedCallback() {
      if (this._ctl) return;
      var inp = document.createElement('input');
      inp.type = 'number';
      if (this.hasAttribute('bind')) inp.setAttribute('data-bind', this.getAttribute('bind'));
      if (this.hasAttribute('placeholder')) inp.placeholder = this.getAttribute('placeholder');
      if (this.className) inp.className = this.className;
      this.appendChild(inp);
      this._ctl = inp;
    }
    get control() { return this._ctl; }
  }
  window.customElements.define('pf2e-field-number', Pf2eFieldNumber);
})();
