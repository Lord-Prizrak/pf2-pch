/* pf2e-field-list — контейнер динамического списка (Web Component):
   языки, навыки, удары, инвентарь и т.п. Содержимое наполняют
   штатные render*-функции приложения по id контейнера. */
(function () {
  if (!window.customElements || window.customElements.get('pf2e-field-list')) return;
  class Pf2eFieldList extends HTMLElement {
    connectedCallback() {
      if (this._done) return;
      this._done = true;
      this.setAttribute('data-be-list', this.getAttribute('list') || '');
    }
  }
  window.customElements.define('pf2e-field-list', Pf2eFieldList);
})();
