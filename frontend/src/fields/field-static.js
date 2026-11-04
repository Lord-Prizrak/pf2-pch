/* pf2e-field-static — фиксированный текст/подпись (Web Component).
   Не является полем ввода; содержимое задаётся атрибутами text/html. */
(function () {
  if (!window.customElements || window.customElements.get('pf2e-field-static')) return;
  class Pf2eFieldStatic extends HTMLElement {
    connectedCallback() {
      if (this._done) return;
      this._done = true;
      var tag = this.getAttribute('tag') || 'span';
      var inner = document.createElement(tag);
      if (this.hasAttribute('html')) inner.innerHTML = this.getAttribute('html');
      else inner.textContent = this.getAttribute('text') || this.textContent || '';
      this.textContent = '';
      this.appendChild(inner);
    }
  }
  window.customElements.define('pf2e-field-static', Pf2eFieldStatic);
})();
