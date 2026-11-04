/* pf2e-field-file — выбор файла (Web Component). */
(function () {
  if (!window.customElements || window.customElements.get('pf2e-field-file')) return;
  class Pf2eFieldFile extends HTMLElement {
    connectedCallback() {
      if (this._ctl) return;
      var inp = document.createElement('input');
      inp.type = 'file';
      if (this.hasAttribute('accept')) inp.setAttribute('accept', this.getAttribute('accept'));
      if (this.className) inp.className = this.className;
      this.appendChild(inp);
      this._ctl = inp;
    }
    get control() { return this._ctl; }
  }
  window.customElements.define('pf2e-field-file', Pf2eFieldFile);
})();
