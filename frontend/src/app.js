/* ==========================================================================
   PF2e Character Sheet — клиентское приложение (vanilla JS, без сборки).
   Один файл app.js подключается из sheet.html.
   Данные: канонический JSON персонажа (schema 1).
   Хранилища: localStorage браузера, встроенный JSON в HTML, сервер.
   ========================================================================== */
(function () {
'use strict';

var SCHEMA = 1;
var LS_CHARS = 'pf2e.characters.v1';     // {id: sheetJson}
var LS_CURRENT = 'pf2e.currentId';
var LS_SERVERS = 'pf2e.servers.v1';      // [{url,name,token,user}]
var LS_THEME = 'pf2e.theme.v1';
var LS_PALETTE = 'pf2e.palette.v1';   // цветовая гамма (независимо от темы-раскладки)
var LS_EDITMODE = 'pf2e.editmode.v1';   // чек-бокс «режим редактирования раскладки»
/* Варианты оформления листа. Тема может быть задана сборщиком build.py
   (плейсхолдер __PF2E_THEME__ / класс на <body>) или выбрана пользователем. */
/* Каждая тема задаёт и цветовое оформление, и РАСПОЛОЖЕНИЕ блоков вкладки
   «Лист» (layout). Секции листа помечены class="sheet-sec sec-<id>"; узлы с
   одним sec-id — одна логическая секция (переносится целиком).
   Раскладка описывается так:
     cols — число колонок (2 или 3);
     map  — состав и порядок секций в колонках left/mid/right (для cols=2
            содержимое mid дописывается после left в первую grid-колонку);
     strip — показывать верхнюю горизонтальную ленту ПЗ/щита (VTT);
     hide — селекторы панелей, скрываемых в этой раскладке (дубликаты). */
var SECTIONS = ['abil', 'def', 'skills', 'strikes', 'hp', 'combat', 'magic', 'feats', 'actions'];

/* Уникальные идентификаторы ВСЕХ drag-блоков вкладки «Лист» — включая
   «Основное», «Профичности оружия» и дублирующуюся панель «ПЗ и щит».
   Каждый блок получает data-bid по порядку обхода DOM; это стабильный ключ
   раскладки: блоки больше не путаются из-за одинаковых sec-* классов и
   никогда не переносятся внутрь друг друга. */
/* Все раскладки строятся на 12-колоночной сетке (#sheet-grid — grid из
   12 равных колонок). Каждому блоку в map соответствует span (число
   колонок сетки): по умолчанию блоки занимают 4 колонки (три столбца),
   в официальной теме Paizo — 6 колонок (два столбца). */
function colSpan(themeId) { return themeId === 'official' ? 6 : 4; }

var THEMES = [
  { id: 'default', name: 'Раскладка: Классическая', layout: { cols: 3, map: {
      left: ['abil', 'def', 'hp'], mid: ['skills', 'strikes', 'wpnprof', 'combat'], right: ['magic', 'feats', 'actions'] },
      hide: ['#hp-shield-panel'] } },
  { id: 'official', name: 'Раскладка: Официальная (Paizo)', layout: { cols: 2, map: {
      left: ['abil', 'skills', 'feats', 'actions'], right: ['hp', 'combat', 'def', 'strikes', 'wpnprof', 'magic'] },
      hide: [] } },
  { id: 'sanych', name: 'Раскладка: Боевая (Саныч)', layout: { cols: 3, map: {
      left: ['def', 'hp', 'combat'], mid: ['abil', 'skills', 'strikes', 'wpnprof'], right: ['magic', 'feats', 'actions'] },
      hide: ['#hp-shield-panel'] } },
  { id: 'dark', name: 'Раскладка: Тёмный VTT', layout: { strip: true, cols: 3, map: {
      left: ['abil', 'skills'], mid: ['def', 'strikes', 'wpnprof', 'feats'], right: ['magic', 'actions'] },
      hide: ['#hp-shield-panel'] } }
];

/* Пользовательская раскладка (режим редактирования): куда перетащили секции
   и какая у них ширина. Хранится в localStorage по каждой теме отдельно,
   чтобы правки не «текли» между вариантами оформления. */
var LS_LAYOUT = 'pf2e.layout.v1';        // {themeId: {map:{left:[..],mid:[..],right:[..]}, widths:{secId:'wide|normal|narrow'}}}
var LS_TABSTRUCT = 'pf2e.tabstruct.v1';  // {tabId: {cols:[[dkey,...],[...]]}} — раскладка блоков на вкладках Инвентарь/Биография/Серверы
var LAYOUT_WIDTHS = ['narrow', 'normal', 'wide'];

/* ---------------- утилиты ---------------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function el(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'text') e.textContent = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'value') e.value = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(function (c) { e.appendChild(c); });
  return e;
}
function uid() {
  return 'c-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function nowISO() { return new Date().toISOString(); }

/* ---------------- автоскрытие текстовых полей (растягивание вниз) --------
   Функция была потеряна при рефакторинге раскладок — восстановлена.
   wireAutogrow вешает обработчик на textarea; refreshAllTextareas
   пересчитывает высоты всех полей после программной смены значений,
   перемещения блоков и применения раскладки. */
function autogrowTa(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(28, ta.scrollHeight + 2) + 'px';
}
function wireAutogrow(ta) {
  if (ta._autogrow) { autogrowTa(ta); return; }
  ta._autogrow = true;
  ta.addEventListener('input', function () { autogrowTa(ta); });
  requestAnimationFrame(function () { autogrowTa(ta); });
}
function refreshAllTextareas(root) {
  $all('textarea', root || document).forEach(autogrowTa);
}

function toast(msg, isErr) {
  var t = el('div', { class: 'toast' + (isErr ? ' err' : ''), text: msg });
  $('#toast-wrap').appendChild(t);
  setTimeout(function () { t.remove(); }, isErr ? 5200 : 2600);
}
function getPath(obj, path) {
  return path.split('.').reduce(function (o, k) { return (o == null ? undefined : o[k]); }, obj);
}
function setPath(obj, path, val) {
  var keys = path.split('.'), o = obj;
  for (var i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------------- модель пустого листа ---------------- */
function emptySheet() {
  return {
    schema: SCHEMA,
    id: uid(),
    name: 'Новый персонаж',
    player: '',
    meta: { createdAt: nowISO(), updatedAt: nowISO(), source: 'manual' },
    core: {
      level: 1, xp: 0, ancestry: '', heritage: '', size: 'Ср', background: '',
      'class': '', classNotes: '', alignment: '', deity: '', languages: 'Общий',
      speed: { feet: 25, notes: '' }, heroPoints: 0
    },
    abilities: {
      str: { score: 10, boost: false }, dex: { score: 10, boost: false },
      con: { score: 10, boost: false }, int: { score: 10, boost: false },
      wis: { score: 10, boost: false }, cha: { score: 10, boost: false }
    },
    armor: {
      acBase: 0, dexOrCap: 2, prof: 'u', item: 0, checkPenalty: 0,
      shield: { ac: 0, hardness: 3, hp: 6, bt: 3, current: 6 },
      groups: { unarmored: 't', light: 'u', medium: 'u', heavy: 'u' }
    },
    classDC: { value: 0, key: 0, prof: 'u', item: 0 },
    saves: {
      fortitude: { total: 0, prof: 'u', keyAttr: 'con', item: 0 },
      reflex:     { total: 0, prof: 'e', keyAttr: 'dex', item: 0 },
      will:       { total: 0, prof: 'u', keyAttr: 'wis', item: 0 }
    },
    perception: { total: 0, prof: 'u', keyAttr: 'wis', item: 0, notes: '' },
    skills: [
      sk('acrobatics','Акробатика','dex'), sk('arcana','Аркана','int'),
      sk('athletics','Атлетика','str'), sk('crafting','Ремесло','int'),
      sk('deception','Обман','cha'), sk('diplomacy','Дипломатия','cha'),
      sk('intimidation','Запугивание','cha'), sk('medicine','Медицина','wis'),
      sk('nature','Природа','wis'), sk('occultism','Оккультизм','int'),
      sk('performance','Выступление','cha'), sk('religion','Религия','wis'),
      sk('society','Общество','int'), sk('stealth','Скрытность','dex'),
      sk('survival','Выживание','wis'), sk('thievery','Воровство','dex')
    ],
    hitPoints: { max: 0, current: 0, temp: 0, dying: 0, wounded: 0, hardness: 0, bt: 0 },
    strikes: { melee: [], ranged: [] },
    weaponProficiencies: { unarm: 't', simple: 't', martial: 'u', advanced: 'u', other: 'u' },
    weaponProfNotes: '',
    spellcasting: {
      tradition: '', method: '', keyAttr: 'int',
      attack: { total: 0, prof: 'u', keyAttr: 'int', item: 0 },
      dc: { total: 0, prof: 'u', keyAttr: 'int', item: 0 },
      focusPoints: { max: 0, current: 0 },
      slots: [], spells: [], rituals: []
    },
    inventory: { worn: [], held: [], consumables: [], other: [],
      coins: { pp: 0, gp: 0, sp: 0, cp: 0 }, bulkMax: 5, notes: '' },
    feats: [], actions: [],
    resistances: '', conditions: '', defenseNotes: '',
    biography: { portrait: '', ethnicity: '', birthplace: '', age: '', gender: '',
      height: '', weight: '', appearance: '', attitude: '', edicts: '', anathema: '',
      likes: '', dislikes: '', catchphrases: '', backstory: '', allies: '',
      enemies: '', organizations: '', notes: '' }
  };
  function sk(key, name, attr) {
    return { key: key, name: name, attr: attr, total: 0, prof: 'u', keyAttr: attr, item: 0 };
  }
}

/* Миграция/достройка произвольного json до полной модели */
function normalizeSheet(raw) {
  var base = emptySheet();
  var out = deepMerge(base, raw || {});
  if (!out.id) out.id = uid();
  if (!out.meta) out.meta = {};
  out.meta.createdAt = out.meta.createdAt || nowISO();
  out.meta.updatedAt = out.meta.updatedAt || nowISO();
  out.schema = SCHEMA;
  // acBase: если есть только итоговое ac (старые данные)
  if (raw && raw.armor && raw.armor.ac != null && raw.armor.acBase == null) {
    out.armor.acBase = raw.armor.ac;
  }
  if (raw && raw.classDC && raw.classDC.value != null && !raw.classDC.base) {
    out.classDC.base = raw.classDC.value - 10;
  }
  return out;
}
function deepMerge(a, b) {
  var out = Array.isArray(a) ? a.slice() : {};
  Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
  Object.keys(b || {}).forEach(function (k) {
    var av = a ? a[k] : undefined, bv = b[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && av && typeof av === 'object' && !Array.isArray(av)) {
      out[k] = deepMerge(av, bv);
    } else if (bv !== undefined) {
      out[k] = Array.isArray(bv) ? bv.map(function (x) {
        return (x && typeof x === 'object') ? deepMerge({}, x) : x;
      }) : bv;
    }
  });
  return out;
}

/* ---------------- вычисления PF2e ---------------- */
var PROF_VAL = { u: 0, t: 2, e: 4, m: 6, l: 8 };
var PROF_NAME = { u: 'Неизученный', t: 'Изученный', e: 'Экспертный', m: 'Мастерский', l: 'Легендарный' };
var ABIL_RU = { str: 'Сила', dex: 'Ловкость', con: 'Выносливость', int: 'Интеллект', wis: 'Мудрость', cha: 'Харизма' };
function abilityMod(s) {
  var score = (s.score || 10) + (s.boost ? 2 : 0);
  return Math.floor((score - 10) / 2);
}
function modStr(n) { return (n >= 0 ? '+' : '') + n; }
function computeDerived(sheet) {
  var lvl = sheet.core.level || 1;
  var d = {};
  d.mods = {};
  ['str','dex','con','int','wis','cha'].forEach(function (k) { d.mods[k] = abilityMod(sheet.abilities[k]); });
  // КБ = базовая(10+броня etc.) + мод ЛВК (или cap) + проф + предмет
  var dexMod = Math.min(d.mods.dex, sheet.armor.dexOrCap == null ? 99 : sheet.armor.dexOrCap);
  d.ac = (sheet.armor.acBase || 0) + dexMod + PROF_VAL[sheet.armor.prof || 'u'] + (sheet.armor.item || 0);
  // Классовая КС = 10 + ключ.мод + проф + предмет
  d.classDC = 10 + (sheet.classDC.key || 0) + PROF_VAL[sheet.classDC.prof || 'u'] + (sheet.classDC.item || 0);
  // спасброски/восприятие/навыки: total = заданный базовый + проф? В нашей модели total хранится как «прочие бонусы», а итог считается так:
  function bonusOf(blk, defAttr) {
    var attr = blk.keyAttr || defAttr || 'wis';
    return (blk.total || 0) + PROF_VAL[blk.prof || 'u'] + (blk.item || 0) + (d.mods[attr] || 0);
  }
  d.saves = {
    fortitude: bonusOf(sheet.saves.fortitude, 'con'),
    reflex: bonusOf(sheet.saves.reflex, 'dex'),
    will: bonusOf(sheet.saves.will, 'wis')
  };
  d.perception = bonusOf(sheet.perception, 'wis');
  d.skills = {};
  (sheet.skills || []).forEach(function (s) { d.skills[s.key] = bonusOf(s, s.attr); });
  d.spellAttack = bonusOf(sheet.spellcasting.attack, sheet.spellcasting.keyAttr);
  d.spellDC = 10 + bonusOf({ total: sheet.spellcasting.dc.total || 0, prof: sheet.spellcasting.dc.prof, item: sheet.spellcasting.dc.item }, sheet.spellcasting.keyAttr);
  d.strikes = { melee: [], ranged: [] };
  ['melee', 'ranged'].forEach(function (kind) {
    (sheet.strikes[kind] || []).forEach(function (st) {
      var ab = st.ability && d.mods[st.ability] != null ? d.mods[st.ability] : d.mods[kind === 'melee' ? 'str' : 'dex'];
      d.strikes[kind].push((st.total != null ? st.total : ab) + PROF_VAL[st.prof || 'u'] + (st.item || 0));
    });
  });
  d.level = lvl;
  return d;
}

/* ---------------- хранилище браузера ---------------- */
var Store = {
  loadAll: function () {
    try { return JSON.parse(localStorage.getItem(LS_CHARS) || '{}'); }
    catch (e) { return {}; }
  },
  saveAll: function (map) {
    localStorage.setItem(LS_CHARS, JSON.stringify(map));
  },
  upsert: function (sheet) {
    sheet.meta.updatedAt = nowISO();
    var map = Store.loadAll();
    map[sheet.id] = sheet;
    Store.saveAll(map);
    saveCurrentState('Сохранено локально: ' + new Date().toLocaleTimeString());
  },
  remove: function (id) {
    var map = Store.loadAll(); delete map[id]; Store.saveAll(map);
    if (State.currentId === id) {
      State.currentId = Object.keys(map)[0] || null;
      localStorage.setItem(LS_CURRENT, State.currentId || '');
    }
  },
  servers: {
    load: function () { try { return JSON.parse(localStorage.getItem(LS_SERVERS) || '[]'); } catch (e) { return []; } },
    save: function (list) { localStorage.setItem(LS_SERVERS, JSON.stringify(list)); }
  }
};
function setState(txt) { $('#save-state').textContent = txt; }

/* ---------------- глобальное состояние ---------------- */
var State = {
  currentId: null,
  sheet: null,          // активный лист (объект)
  dirty: false,
  tab: 'sheet',
  selectedServer: null, // url
  serverChars: {},      // url -> [chars]
  autoSaveTimer: null
};

/* ---------------- вкладки ---------------- */
var TABS = [
  ['sheet', 'Лист'], ['inventory', 'Инвентарь'], ['bio', 'Биография'],
  ['servers', 'Серверы'], ['io', 'Импорт/Экспорт']
];
function renderTabs() {
  var nav = $('#tabs-nav');
  nav.innerHTML = '';
  TABS.forEach(function (t) {
    nav.appendChild(el('button', {
      text: t[1], class: State.tab === t[0] ? 'active' : '',
      onclick: function () { switchTab(t[0]); }
    }));
  });
}
function switchTab(id) {
  State.tab = id;
  $all('.tabpage').forEach(function (p) { p.classList.add('hidden'); });
  $('#tab-' + id).classList.remove('hidden');
  renderTabs();
  applyTabStructure(id);   // восстанавливаем пользовательскую раскладку блоков вкладки
  if (id === 'servers') renderServersUI();
  if (id === 'io') refreshJsonEditor();
  ensureBlockIds(); applyTabStructure(id);
}

/* ---------------- переключатель персонажей ---------------- */
function renderCharSwitcher() {
  var sel = $('#character-select');
  var map = Store.loadAll();
  sel.innerHTML = '';
  Object.keys(map).forEach(function (id) {
    var s = map[id];
    sel.appendChild(el('option', { value: id, text: s.name + (s.core['class'] ? ' — ' + s.core['class'] + ' ' + s.core.level : '') }));
  });
  if (!Object.keys(map).length) sel.appendChild(el('option', { value: '', text: '(нет персонажей)' }));
  sel.value = State.currentId || '';
}
function switchCharacter(id) {
  commitEdits();
  var map = Store.loadAll();
  if (!map[id]) { toast('Персонаж не найден', true); return; }
  State.currentId = id;
  State.sheet = normalizeSheet(map[id]);
  localStorage.setItem(LS_CURRENT, id);
  renderAll();
}

/* ---------------- рендеринг листа ---------------- */
function bindInputs(root) {
  $all('[data-bind]', root).forEach(function (inp) {
    var path = inp.getAttribute('data-bind');
    var val = getPath(State.sheet, path);
    if (val == null) val = '';
    inp.value = val;
    if (inp._bound) return;
    inp._bound = true;
    inp.addEventListener('input', function () {
      var v = inp.type === 'number' ? (inp.value === '' ? 0 : Number(inp.value)) : inp.value;
      setPath(State.sheet, path, v);
      markDirty();
      updateComputed();
    });
    if (inp.tagName === 'TEXTAREA') wireAutogrow(inp);   // растягивание вниз по содержимому
  });
}
function markDirty() {
  State.dirty = true;
  setState('Изменения…');
  clearTimeout(State.autoSaveTimer);
  State.autoSaveTimer = setTimeout(function () { saveCurrent(); }, 800);
}
function commitEdits() { /* input-обработчики пишут сразу в State.sheet */ }
function saveCurrentState(txt) { setState(txt); }
function saveCurrent() {
  if (!State.sheet) return;
  Store.upsert(State.sheet);
  State.dirty = false;
}

function profPicker(cur, onchange) {
  var wrap = el('span', { class: 'prof-pick' });
  ['u', 't', 'e', 'm', 'l'].forEach(function (r) {
    wrap.appendChild(el('button', {
      text: r.toUpperCase(), title: PROF_NAME[r],
      class: cur === r ? 'on' : '',
      onclick: function (ev) {
        ev.preventDefault();
        onchange(r);
        $all('button', wrap).forEach(function (b, i) {
          b.classList.toggle('on', ['u','t','e','m','l'][i] === cur2());
        });
      }
    }));
  });
  function cur2() { return wrap.dataset.val; }
  wrap.dataset.val = cur;
  var origClick = null;
  // обновляем dataset при клике
  $all('button', wrap).forEach(function (b, i) {
    b.addEventListener('click', function () { wrap.dataset.val = ['u','t','e','m','l'][i]; });
  });
  return wrap;
}

function renderAbilities() {
  var tb = $('#abilities-body'); tb.innerHTML = '';
  ['str','dex','con','int','wis','cha'].forEach(function (k) {
    var a = State.sheet.abilities[k];
    var tr = el('tr');
    tr.appendChild(el('td', { text: ABIL_RU[k] }));
    var inp = el('td'); var numInp = el('input', { type: 'number', value: a.score });
    numInp.addEventListener('input', function () { a.score = Number(numInp.value) || 0; markDirty(); updateComputed(); renderAbilities(); });
    inp.appendChild(numInp); tr.appendChild(inp);
    tr.appendChild(el('td', { html: '<span class="mod-badge">' + modStr(abilityMod(a)) + '</span>' }));
    var cb = el('td'); var chk = el('input', { type: 'checkbox' }); chk.checked = !!a.boost;
    chk.addEventListener('change', function () { a.boost = chk.checked; markDirty(); updateComputed(); renderAbilities(); });
    cb.appendChild(chk); tr.appendChild(cb);
    tb.appendChild(tr);
  });
  // карточки (раскладки classic/official): аббр -> [название, мод, значение, +2 ув.]
  var cards = $('#ability-cards');
  if (cards) {
    cards.innerHTML = '';
    [['str','СИЛ'],['dex','ЛОВ'],['con','ВЫН'],['int','ИНТ'],['wis','МУД'],['cha','ХАР']].forEach(function (pair) {
      var k = pair[0], a = State.sheet.abilities[k];
      var numInp = el('input', { type: 'number', value: a.score, class: 'card-score' });
      numInp.addEventListener('input', function () { a.score = Number(numInp.value) || 0; markDirty(); updateComputed(); renderAbilities(); });
      var chk = el('input', { type: 'checkbox', title: '+2 улучшение' }); chk.checked = !!a.boost;
      chk.addEventListener('change', function () { a.boost = chk.checked; markDirty(); updateComputed(); renderAbilities(); });
      var card = el('div', { class: 'abil-card' }, [
        el('span', { class: 'card-abbr', text: pair[1] }),
        el('b', { class: 'card-mod', text: modStr(abilityMod(a)) }),
        numInp,
        el('label', { class: 'card-boost' }, [chk, document.createTextNode('+2')])
      ]);
      cards.appendChild(card);
    });
  }
}

/* Панель «ПЗ и щит» (крупные цифры раскладки official) — синхронизируется из updateComputed */
function renderHpShieldPanel() {
  var box = $('#hps-quick'); if (!box || box.childNodes.length) return;
  [[-5,'−5'],[-1,'−1'],[1,'+1'],[5,'+5']].forEach(function (p) {
    box.appendChild(el('button', { class: 'btn small', text: p[1], onclick: function () { applyDamage(p[0]); } }));
  });
  box.appendChild(el('button', { class: 'btn small', text: 'Отдых', onclick: function () {
    var hp = State.sheet.hitPoints; hp.current = hp.max; hp.temp = 0; hp.dying = 0; hp.wounded = 0;
    markDirty(); updateComputed();
  }}));
}

/* Компактная сводка боя (раскладка sanych): КБ/спасброски/КСС + удары с броском */
function renderCombatSummary() {
  var box = $('#combat-summary'); if (!box) return;
  var d = getComputed(), s = State.sheet;
  box.innerHTML = '';
  var stats = el('div', { class: 'combat-stats' });
  [['КБ', String(d.ac)], ['Воспр', modStr(d.perception)],
   ['Стoйк', modStr(d.saves.fortitude)], ['Реакц', modStr(d.saves.reflex)], ['Воля', modStr(d.saves.will)],
   ['Кл.КС', String(d.classDC)], ['Маг.атк', modStr(d.spellAttack)], ['Маг.КС', String(d.spellDC)]].forEach(function (p) {
    stats.appendChild(el('span', { class: 'cstat' }, [
      el('small', { text: p[0] }), el('b', { text: p[1] })]));
  });
  box.appendChild(stats);
  ['melee', 'ranged'].forEach(function (kind) {
    (s.strikes[kind] || []).forEach(function (st, i) {
      var v = d.strikes[kind][i];
      box.appendChild(el('div', { class: 'combat-strike' }, [
        el('button', { class: 'roll-btn', text: '🎲', onclick: function () { rollStrike(st.name, v, st.damage); } }),
        el('span', { class: 'strike-attack', text: modStr(v) }),
        el('span', { text: st.name || '(без названия)' }),
        el('small', { text: st.damage || '' })
      ]));
    });
  });
}

function renderDefense() {
  var s = State.sheet;
  var ab = $('#armor-block'); ab.innerHTML = '';
  ab.appendChild(el('div', { class: 'row' }, [
    el('span', { text: 'Профичность брони: ' }),
    profPicker(s.armor.prof, function (r) { s.armor.prof = r; markDirty(); updateComputed(); })
  ]));
  var sb = $('#saves-block'); sb.innerHTML = '';
  // плитки итоговых спасбросков (раскладка official) — id save-total-* обновляет updateComputed
  var tiles = el('div', { class: 'saves-tiles' });
  [['fortitude', 'Стойкость'], ['reflex', 'Реакция'], ['will', 'Воля']].forEach(function (pair) {
    tiles.appendChild(el('div', { class: 'save-tile' }, [
      el('span', { text: pair[1] }),
      el('b', { id: 'save-tile-' + pair[0], text: '' })
    ]));
  });
  sb.appendChild(tiles);
  [['fortitude', 'Стойкость'], ['reflex', 'Реакция'], ['will', 'Воля']].forEach(function (pair) {
    var blk = s.saves[pair[0]];
    var row = el('div', { class: 'row' });
    row.appendChild(el('label', { text: pair[1] }));
    var inp = el('input', { type: 'number', value: blk.total, class: 'xs' });
    inp.addEventListener('input', function () { blk.total = Number(inp.value) || 0; markDirty(); updateComputed(); });
    row.appendChild(inp);
    row.appendChild(el('span', { text: '+проф+предм+хар →' }));
    row.appendChild(el('b', { id: 'save-total-' + pair[0], text: '' }));
    row.appendChild(profPicker(blk.prof, function (r) { blk.prof = r; markDirty(); updateComputed(); }));
    var sel = el('select');
    ['str','dex','con','int','wis','cha'].forEach(function (k) {
      sel.appendChild(el('option', { value: k, text: ABIL_RU[k] }));
    });
    sel.value = blk.keyAttr;
    sel.addEventListener('change', function () { blk.keyAttr = sel.value; markDirty(); updateComputed(); });
    row.appendChild(sel);
    sb.appendChild(row);
  });
  // классовая КС проф
  var cdRow = el('div', { class: 'row' });
  cdRow.appendChild(el('span', { text: 'Профiclass DC:' }));
  cdRow.appendChild(profPicker(s.classDC.prof, function (r) { s.classDC.prof = r; markDirty(); updateComputed(); }));
  $('#armor-block').appendChild(cdRow);
}

function renderSkills() {
  var box = $('#skills-block'); box.innerHTML = '';
  State.sheet.skills.forEach(function (sk) {
    var row = el('div', { class: 'row' });
    row.appendChild(el('label', { style: 'flex:1 1 130px', text: sk.name }));
    var inp = el('input', { type: 'number', value: sk.total, class: 'xs' });
    inp.addEventListener('input', function () { sk.total = Number(inp.value) || 0; markDirty(); updateComputed(); });
    row.appendChild(inp);
    row.appendChild(profPicker(sk.prof, function (r) { sk.prof = r; markDirty(); updateComputed(); }));
    var sel = el('select');
    ['str','dex','con','int','wis','cha'].forEach(function (k) {
      sel.appendChild(el('option', { value: k, text: ABIL_RU[k] }));
    });
    sel.value = sk.keyAttr || sk.attr;
    sel.addEventListener('change', function () { sk.keyAttr = sel.value; markDirty(); updateComputed(); });
    row.appendChild(sel);
    row.appendChild(el('b', { id: 'skill-total-' + sk.key, text: '' }));
    // броски кубиков в навыках намеренно отсутствуют — проверка бросается
    // кнопкой «🎲 Проверка» в сводке боя и через контекстные меню атак
    box.appendChild(row);
  });
  var addBtn = el('button', { class: 'btn small', text: '＋ Знание (Lore)', onclick: function () {
    var key = 'lore' + (Date.now() % 10000);
    State.sheet.skills.push({ key: key, name: 'Знание (?)', attr: 'int', total: 0, prof: 't', keyAttr: 'int', item: 0 });
    markDirty(); renderSkills();
  }});
  box.appendChild(addBtn);
  // переименование lore
  $all('label[style]', box).forEach(function (lb, i) {
    var sk = State.sheet.skills[i];
    if (sk && /^lore/.test(sk.key)) {
      lb.textContent = '';
      var t = el('input', { value: sk.name, class: 'm' });
      t.addEventListener('input', function () { sk.name = t.value; markDirty(); });
      lb.appendChild(t);
    }
  });
}

function renderStrikes() {
  var box = $('#strikes-block'); box.innerHTML = '';
  ['melee', 'ranged'].forEach(function (kind) {
    box.appendChild(el('div', { class: 'feats-cat', text: kind === 'melee' ? 'Ближний бой' : 'Дальний бой' }));
    var list = State.sheet.strikes[kind];
    list.forEach(function (st, idx) {
      var row = el('div', { class: 'item-row' });
      var nm = el('input', { value: st.name, class: 'grow' });
      nm.addEventListener('input', function () { st.name = nm.value; markDirty(); });
      var dmg = el('input', { value: st.damage || '', placeholder: 'урон 1d6+2', style: 'width:110px' });
      dmg.addEventListener('input', function () { st.damage = dmg.value; markDirty(); });
      var abSel = el('select');
      abSel.appendChild(el('option', { value: '', text: 'авто' }));
      ['str','dex'].forEach(function (k) { abSel.appendChild(el('option', { value: k, text: ABIL_RU[k] })); });
      abSel.value = st.ability || '';
      abSel.addEventListener('change', function () { st.ability = abSel.value; markDirty(); updateComputed(); });
      var atk = el('span', { class: 'strike-attack', id: 'strike-atk-' + kind + '-' + idx });
      var prof = profPicker(st.prof, function (r) { st.prof = r; markDirty(); updateComputed(); });
      var rm = el('button', { class: 'rm', text: '✕', onclick: function () {
        list.splice(idx, 1); markDirty(); renderStrikes();
      }});
      var roll = el('button', { class: 'roll-btn', text: '🎲', onclick: function () {
        var d = getComputed();
        var v = d.strikes[kind][idx];
        rollStrike(st.name, v, st.damage);
      }});
      row.append(nm, atk, roll, dmg, abSel, prof, rm);
      box.appendChild(row);
    });
    box.appendChild(el('button', { class: 'btn small add-line', text: '＋ Оружие', onclick: function () {
      list.push({ name: '', attack: null, total: 0, ability: '', prof: 't', item: 0, damage: '', traits: '', range: '', reload: '', agile: false, fatal: '', map: ['-5', '-10'] });
      markDirty(); renderStrikes();
    }}));
  });
}

function renderWeaponProf() {
  var box = $('#weapon-prof-block'); box.innerHTML = '';
  var names = { unarm: 'Без оружия', simple: 'Простое', martial: 'Военное', advanced: 'Продвинутое', other: 'Иное' };
  Object.keys(names).forEach(function (k) {
    var row = el('div', { class: 'row' });
    row.appendChild(el('label', { text: names[k] }));
    row.appendChild(profPicker(State.sheet.weaponProficiencies[k], function (r) {
      State.sheet.weaponProficiencies[k] = r; markDirty();
    }));
    box.appendChild(row);
  });
}

function renderHeroPoints() {
  var box = $('#hero-points'); box.innerHTML = '';
  for (var i = 1; i <= 3; i++) {
    (function (i) {
      var b = el('button', { class: 'roll-btn', text: '★', title: 'Пункт героизма ' + i,
        style: 'font-size:18px;color:' + ((State.sheet.core.heroPoints || 0) >= i ? '#d9a520' : '#c5bba8') });
      b.addEventListener('click', function () {
        State.sheet.core.heroPoints = (State.sheet.core.heroPoints === i) ? i - 1 : i;
        markDirty(); renderHeroPoints();
      });
      box.appendChild(b);
    })(i);
  }
}

/* ---------------- известные языки: список, а не текст ------------------- */
/* Хранимся по-прежнему в core.languages (строка через запятую — совместимость
   с JSON-форматом и сервером), но отображаем как редактируемый список:
   каждый язык отдельной строкой, кнопка ＋ добавляет язык из справочника
   PF2e или произвольный, ✕ удаляет. */
var KNOWN_LANGUAGES = ['Общий', 'Эльфийский', 'Гномий', 'Гоблинский', 'Огрский',
  'Полуросликовый', 'Козлитин', 'Дварфский', 'Драконий', 'Сквозной', 'Небесный',
  'Адский', 'Язык демонов', 'Феей', 'Акван', 'Азlantian', 'Валутский', 'Юни',
  'Икс', 'Тengu', 'Jotun', 'Ундинский', 'Терраский', 'Циклопский'];
function splitLanguages(str) {
  return String(str || '').split(/[,;\n]+/).map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length; });
}
function renderLanguages() {
  var box = $('#languages-list'); if (!box) return;
  box.innerHTML = '';
  var langs = splitLanguages(State.sheet.core.languages);
  var ul = el('ul', { class: 'lang-items' });
  if (!langs.length) ul.appendChild(el('li', { class: 'lang-empty', text: '(нет)' }));
  langs.forEach(function (name, idx) {
    var li = el('li', { class: 'lang-item' });
    var inp = el('input', { value: name, class: 'lang-name', size: Math.max(6, name.length) });
    inp.addEventListener('input', function () {
      langs[idx] = inp.value.trim();
      State.sheet.core.languages = langs.filter(Boolean).join(', ');
      inp.setAttribute('size', Math.max(6, inp.value.length));
      markDirty();
    });
    li.appendChild(inp);
    var del = el('button', { class: 'btn small danger lang-del', text: '✕', title: 'Убрать язык' });
    del.addEventListener('click', function () {
      langs.splice(idx, 1);
      State.sheet.core.languages = langs.join(', ');
      markDirty(); renderLanguages();
    });
    li.appendChild(del);
    ul.appendChild(li);
  });
  box.appendChild(ul);
  var addRow = el('div', { class: 'lang-add' });
  var sel = el('select', { class: 'lang-pick' });
  sel.appendChild(el('option', { value: '', text: '— добавить язык —' }));
  KNOWN_LANGUAGES.forEach(function (l) {
    if (langs.indexOf(l) < 0) sel.appendChild(el('option', { value: l, text: l }));
  });
  sel.addEventListener('change', function () {
    if (!sel.value) return;
    langs.push(sel.value);
    State.sheet.core.languages = langs.join(', ');
    markDirty(); renderLanguages();
  });
  addRow.appendChild(sel);
  var custom = el('input', { class: 'lang-custom', placeholder: 'свой язык…' });
  var btnAdd = el('button', { class: 'btn small', text: '＋', title: 'Добавить указанный язык' });
  function addCustom() {
    var v = custom.value.trim();
    if (!v) return;
    langs.push(v);
    State.sheet.core.languages = langs.join(', ');
    custom.value = '';
    markDirty(); renderLanguages();
  }
  btnAdd.addEventListener('click', addCustom);
  custom.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addCustom(); } });
  addRow.appendChild(custom);
  addRow.appendChild(btnAdd);
  box.appendChild(addRow);
}

function renderSpells() {
  var box = $('#spellcasting-block'); box.innerHTML = '';
  var sc = State.sheet.spellcasting;
  var row = el('div', { class: 'row' });
  ['tradition:Традиция', 'method:Метод', 'keyAttr:Ключ. хар'].forEach(function (spec) {
    var parts = spec.split(':');
    if (parts[0] === 'keyAttr') {
      var lbl = el('label', { text: parts[1] });
      var sel = el('select');
      ['str','dex','con','int','wis','cha'].forEach(function (k) { sel.appendChild(el('option', { value: k, text: ABIL_RU[k] })); });
      sel.value = sc.keyAttr;
      sel.addEventListener('change', function () { sc.keyAttr = sel.value; sc.attack.keyAttr = sel.value; sc.dc.keyAttr = sel.value; markDirty(); updateComputed(); });
      lbl.appendChild(sel); row.appendChild(lbl);
    } else {
      var inp = el('input', { value: sc[parts[0]] || '', placeholder: parts[1], class: 'm' });
      inp.addEventListener('input', function () { sc[parts[0]] = inp.value; markDirty(); });
      row.appendChild(inp);
    }
  });
  box.appendChild(row);
  var row2 = el('div', { class: 'row' });
  row2.appendChild(el('span', { text: 'Атака: ' }));
  row2.appendChild(el('b', { id: 'spell-atk-total' }));
  row2.appendChild(profPicker(sc.attack.prof, function (r) { sc.attack.prof = r; sc.dc.prof = r; markDirty(); updateComputed(); renderSpells(); }));
  var ti = el('input', { type: 'number', value: sc.attack.total, class: 'xs', title: 'модификатор ключевой характеристики' });
  ti.addEventListener('input', function () { sc.attack.total = Number(ti.value) || 0; sc.dc.total = Number(ti.value) || 0; markDirty(); updateComputed(); });
  row2.appendChild(ti);
  row2.appendChild(el('span', { text: ' КС: ' }));
  row2.appendChild(el('b', { id: 'spell-dc-total' }));
  box.appendChild(row2);

  // Слоты
  var grid = el('div', { class: 'spell-slot-grid' });
  for (var r0 = 0; r0 <= 10; r0++) {
    (function (rank) {
      var slot = findSlot(rank);
      var cell = el('div', { class: 'slot-cell' });
      cell.appendChild(el('b', { text: rank === 0 ? 'Ч' : String(rank) }));
      var per = el('input', { type: 'number', value: slot ? slot.perDay : 0, class: 'xs', style: 'width:44px' });
      per.addEventListener('change', function () {
        var sl = ensureSlot(rank);
        sl.perDay = Math.max(0, Number(per.value) || 0);
        sl.used = Math.min(sl.used, sl.perDay);
        markDirty(); renderSpells();
      });
      cell.appendChild(per);
      if (slot && slot.perDay > 0) {
        var dots = el('div', { class: 'slot-dots' });
        for (var i = 0; i < slot.perDay; i++) {
          (function (i) {
            dots.appendChild(el('span', {
              class: 'dot' + (i < slot.used ? ' used' : ''),
              onclick: function () { slot.used = (i < slot.used) ? i : i + 1; markDirty(); renderSpells(); }
            }));
          })(i);
        }
        cell.appendChild(dots);
      }
      grid.appendChild(cell);
    })(r0);
  }
  box.appendChild(grid);

  // Список заклинаний
  box.appendChild(el('div', { class: 'feats-cat', text: 'Известные заклинания' }));
  sc.spells.forEach(function (sp, idx) {
    var rowI = el('div', { class: 'item-row' });
    var nm = el('input', { value: sp.name, class: 'grow' });
    nm.addEventListener('input', function () { sp.name = nm.value; markDirty(); });
    var rk = el('input', { type: 'number', value: sp.rank, class: 'xs', style: 'width:50px', title: 'ранг' });
    rk.addEventListener('input', function () { sp.rank = Number(rk.value) || 0; markDirty(); });
    var prep = el('input', { type: 'number', value: sp.prepared, class: 'xs', style: 'width:50px', title: 'подготовлено' });
    prep.addEventListener('input', function () { sp.prepared = Number(prep.value) || 0; markDirty(); });
    var rm = el('button', { class: 'rm', text: '✕', onclick: function () { sc.spells.splice(idx, 1); markDirty(); renderSpells(); } });
    rowI.append(nm, rk, prep, rm);
    box.appendChild(rowI);
  });
  box.appendChild(el('button', { class: 'btn small add-line', text: '＋ Заклинание', onclick: function () {
    sc.spells.push({ name: '', rank: 0, prepared: 1, heights: [] }); markDirty(); renderSpells();
  }}));
  function findSlot(rank) {
    for (var i = 0; i < sc.slots.length; i++) if (sc.slots[i].rank === rank) return sc.slots[i];
    return null;
  }
  function ensureSlot(rank) {
    var s = findSlot(rank);
    if (!s) { s = { rank: rank, perDay: 0, used: 0 }; sc.slots.push(s); }
    return s;
  }
}

/* ---------------- «Черты и умения»: списки, а не текстовые поля ---------- */
var FEAT_CATS = { ancestry: 'Народа', class: 'Класса', skill: 'Навыков', general: 'Общие', bonus: 'Бонусные' };

/* Черта как элемент списка. В обычном режиме — компактный <li>: название,
   уровень, категория; клик по строке разворачивает описание (details/summary).
   В режиме редактирования добавляются ✎ (правка имени/уровня/категории inline)
   и ✕ (удаление). Данные при этом остаются в State.sheet.feats как раньше. */
function featListItem(ft, editMode) {
  var li = el('li', { class: 'feat-li' });
  var det = el('details', { class: 'feat-det' });
  var sum = el('summary', { class: 'feat-sum' });
  sum.appendChild(el('span', { class: 'feat-name', text: ft.name || '(без названия)' }));
  sum.appendChild(el('span', { class: 'feat-meta', text: 'ур. ' + (ft.level != null ? ft.level : 0) +
    ' · ' + (FEAT_CATS[ft.category] || ft.category || 'общ.') }));
  if (editMode) {
    var editBtn = el('button', { class: 'mini-btn', text: '✎', title: 'Редактировать черту' });
    editBtn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      openFeatEditor(ft);
    });
    var rmBtn = el('button', { class: 'mini-btn danger', text: '✕', title: 'Удалить черту' });
    rmBtn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      State.sheet.feats.splice(State.sheet.feats.indexOf(ft), 1);
      markDirty(); renderFeats();
    });
    sum.appendChild(editBtn); sum.appendChild(rmBtn);
  }
  det.appendChild(sum);
  var body = el('div', { class: 'feat-body' });
  // описание — обычный текст (не textarea): read-only вне редактора
  body.appendChild(el('p', { class: 'feat-text', text: ft.text || 'Описание отсутствует.' }));
  if (ft.actions) body.appendChild(el('p', { class: 'feat-traits', text: 'Действия: ' + ft.actions }));
  if (ft.traits) body.appendChild(el('p', { class: 'feat-traits', text: 'Черты: ' + ft.traits }));
  det.appendChild(body);
  li.appendChild(det);
  return li;
}

/* Редактор одной черты — модальное окно с полями (единственное место, где
   текст черты вводится через поле ввода; на листе остаются только списки). */
function openFeatEditor(ft) {
  var nameI = el('input', { value: ft.name || '', class: 'grow' });
  var lvlI = el('input', { type: 'number', value: ft.level != null ? ft.level : 0, class: 'xs' });
  var catS = el('select');
  Object.keys(FEAT_CATS).forEach(function (c) { catS.appendChild(el('option', { value: c, text: FEAT_CATS[c] })); });
  catS.value = FEAT_CATS[ft.category] ? ft.category : 'general';
  var txtA = el('textarea', { rows: 5, class: 'autogrow', placeholder: 'Текст черты' });
  txtA.value = ft.text || '';
  wireAutogrow(txtA);
  var saveB = el('button', { class: 'btn primary', text: 'Сохранить' });
  saveB.addEventListener('click', function () {
    ft.name = nameI.value.trim() || '(без названия)';
    ft.level = Number(lvlI.value) || 0;
    ft.category = catS.value;
    ft.text = txtA.value;
    markDirty(); closeModal(); renderFeats();
  });
  var cancelB = el('button', { class: 'btn', text: 'Отмена' });
  cancelB.addEventListener('click', closeModal);
  modal([
    el('h3', { text: 'Черта: ' + (ft.name || '') }),
    el('div', { class: 'row' }, [el('label', {}, [nameI]), el('label', {}, [lvlI]), el('label', {}, [catS])]),
    el('div', { class: 'row' }, [el('label', { class: 'grow' }, [txtA])]),
    el('div', { class: 'row' }, [saveB, cancelB])
  ]);
  wireAutogrow(txtA);
}

function renderFeats() {
  var box = $('#feats-block'); box.innerHTML = '';
  var editMode = isEditMode();
  var byCat = {};
  State.sheet.feats.forEach(function (ft) { (byCat[ft.category] = byCat[ft.category] || []).push(ft); });
  Object.keys(FEAT_CATS).forEach(function (cat) {
    var items = byCat[cat] || [];
    box.appendChild(el('div', { class: 'feats-cat', text: FEAT_CATS[cat] + ' черты' }));
    var ul = el('ul', { class: 'feat-list' });
    if (!items.length && editMode) ul.appendChild(el('li', { class: 'feat-empty', text: '— пусто —' }));
    items.forEach(function (ft) { ul.appendChild(featListItem(ft, editMode)); });
    box.appendChild(ul);
  });
  if (editMode) {
    box.appendChild(el('button', { class: 'btn small', text: '＋ Черта', onclick: function () {
      var ft = { name: 'Новая черта', level: State.sheet.core.level, category: 'general', text: '' };
      State.sheet.feats.push(ft);
      markDirty(); renderFeats(); openFeatEditor(ft);
    }}));
  }
}

/* Действия — тоже список. Строка: значок кол-ва действий, название, черты;
   клик разворачивает описание. Правка/удаление — только в режиме редактирования. */
var ACTION_GLYPH = { '1': '◆', '2': '◆◆', '3': '◆◆◆', 'free': '⟁', 'reaction': '↺' };
function actionGlyph(a) {
  var key = String(a == null ? '' : a).trim().toLowerCase();
  if (ACTION_GLYPH[key]) return ACTION_GLYPH[key];
  var n = parseInt(key, 10);
  if (n >= 1 && n <= 3) return Array(n + 1).join('◆');
  return key ? '(' + key + ')' : '';
}
function actionListItem(act, idx, editMode) {
  var li = el('li', { class: 'act-li' });
  var det = el('details', { class: 'feat-det' });
  var sum = el('summary', { class: 'feat-sum' });
  sum.appendChild(el('span', { class: 'act-glyph', text: actionGlyph(act.actions) }));
  sum.appendChild(el('span', { class: 'feat-name', text: act.name || '(без названия)' }));
  if (act.traits) sum.appendChild(el('span', { class: 'feat-meta', text: act.traits }));
  if (editMode) {
    var editBtn = el('button', { class: 'mini-btn', text: '✎', title: 'Редактировать действие' });
    editBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); openActionEditor(act); });
    var rmBtn = el('button', { class: 'mini-btn danger', text: '✕', title: 'Удалить действие' });
    rmBtn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      State.sheet.actions.splice(idx, 1); markDirty(); renderActions();
    });
    sum.appendChild(editBtn); sum.appendChild(rmBtn);
  }
  det.appendChild(sum);
  var body = el('div', { class: 'feat-body' });
  body.appendChild(el('p', { class: 'feat-text', text: act.text || 'Описание отсутствует.' }));
  if (act.source) body.appendChild(el('p', { class: 'feat-traits', text: 'Источник: ' + act.source }));
  det.appendChild(body);
  li.appendChild(det);
  return li;
}
function openActionEditor(act) {
  var nameI = el('input', { value: act.name || '', class: 'grow' });
  var actI = el('input', { value: act.actions || '', class: 'xs', title: 'Кол-во действий: 1/2/3/free/reaction' });
  var traitsI = el('input', { value: act.traits || '', class: 's' });
  var srcI = el('input', { value: act.source || '', class: 's' });
  var txtA = el('textarea', { rows: 5, class: 'autogrow', placeholder: 'Описание' });
  txtA.value = act.text || '';
  var saveB = el('button', { class: 'btn primary', text: 'Сохранить' });
  saveB.addEventListener('click', function () {
    act.name = nameI.value.trim() || '(без названия)';
    act.actions = actI.value.trim(); act.traits = traitsI.value.trim();
    act.source = srcI.value.trim(); act.text = txtA.value;
    markDirty(); closeModal(); renderActions();
  });
  var cancelB = el('button', { class: 'btn', text: 'Отмена' });
  cancelB.addEventListener('click', closeModal);
  modal([
    el('h3', { text: 'Действие' }),
    el('div', { class: 'row' }, [el('label', {}, [nameI]), el('label', {}, [actI]), el('label', {}, [traitsI]), el('label', {}, [srcI])]),
    el('div', { class: 'row' }, [el('label', { class: 'grow' }, [txtA])]),
    el('div', { class: 'row' }, [saveB, cancelB])
  ]);
  wireAutogrow(txtA);
}
function renderActions() {
  var box = $('#actions-block'); box.innerHTML = '';
  var editMode = isEditMode();
  var ul = el('ul', { class: 'feat-list act-list' });
  if (!State.sheet.actions.length && editMode) ul.appendChild(el('li', { class: 'feat-empty', text: '— пусто —' }));
  State.sheet.actions.forEach(function (act, idx) { ul.appendChild(actionListItem(act, idx, editMode)); });
  box.appendChild(ul);
  if (editMode) {
    box.appendChild(el('button', { class: 'btn small', text: '＋ Действие', onclick: function () {
      var act = { name: 'Новое действие', actions: '1', traits: '', source: '', text: '' };
      State.sheet.actions.push(act);
      markDirty(); renderActions(); openActionEditor(act);
    }}));
  }
}

function renderInventory() {
  var inv = State.sheet.inventory;
  bindLists([
    ['#inv-worn', inv.worn, ['name', 'bulk', 'invested']],
    ['#inv-held', inv.held, ['name', 'bulk']],
    ['#inv-consumables', inv.consumables, ['name', 'qty']],
    ['#inv-other', inv.other, ['name', 'bulk']]
  ]);
  function bindLists(specs) {
    specs.forEach(function (spec) {
      var box = $(spec[0]), list = spec[1], fields = spec[2];
      box.innerHTML = '';
      box.classList.add('list-editor');
      list.forEach(function (item, idx) {
        var row = el('div', { class: 'item-row' });
        fields.forEach(function (fld) {
          if (fld === 'invested') {
            var lbl = el('label', { title: 'Инвестировано' });
            var chk = el('input', { type: 'checkbox' });
            chk.checked = !!item.invested;
            chk.addEventListener('change', function () { item.invested = chk.checked; markDirty(); });
            lbl.appendChild(chk); lbl.appendChild(document.createTextNode('инв'));
            row.appendChild(lbl);
          } else {
            var inp = el('input', { value: item[fld] || '', placeholder: fldLabel(fld),
              class: fld === 'name' ? 'grow' : 'xs' });
            inp.addEventListener('input', function () { item[fld] = inp.value; markDirty(); });
            row.appendChild(inp);
          }
        });
        var rm = el('button', { class: 'rm', text: '✕', onclick: function () { list.splice(idx, 1); markDirty(); renderInventory(); } });
        row.appendChild(rm);
        box.appendChild(row);
      });
      box.appendChild(el('button', { class: 'btn small add-line', text: '＋ Добавить', onclick: function () {
        var it = {}; fields.forEach(function (f) { it[f] = f === 'invested' ? false : ''; });
        list.push(it); markDirty(); renderInventory();
      }}));
    });
    function fldLabel(f) { return f === 'name' ? 'Название' : f === 'bulk' ? 'Вес' : f === 'qty' ? 'Кол-во' : f; }
  }
}

/* вычисляемые отображения */
var _computed = null;
function getComputed() { return _computed || computeDerived(State.sheet); }
function updateComputed() {
  _computed = computeDerived(State.sheet);
  var d = _computed;
  $('#ac-total').textContent = d.ac;
  $('#classdc-total').textContent = d.classDC;
  $('#perc-total').textContent = modStr(d.perception);
  $('#save-total-fortitude').textContent = modStr(d.saves.fortitude);
  $('#save-total-reflex').textContent = modStr(d.saves.reflex);
  $('#save-total-will').textContent = modStr(d.saves.will);
  var tf = $('#save-tile-fortitude');
  if (tf) { tf.textContent = modStr(d.saves.fortitude);
            $('#save-tile-reflex').textContent = modStr(d.saves.reflex);
            $('#save-tile-will').textContent = modStr(d.saves.will); }
  Object.keys(d.skills).forEach(function (k) {
    var e = $('#skill-total-' + k); if (e) e.textContent = modStr(d.skills[k]);
  });
  $('#spell-atk-total') && ($('#spell-atk-total').textContent = modStr(d.spellAttack));
  $('#spell-dc-total') && ($('#spell-dc-total').textContent = String(d.spellDC));
  ['melee', 'ranged'].forEach(function (kind) {
    d.strikes[kind].forEach(function (v, i) {
      var e = $('#strike-atk-' + kind + '-' + i);
      if (e) e.textContent = modStr(v);
    });
  });
  // HP bar
  var hp = State.sheet.hitPoints;
  var pct = hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0;
  $('#hp-bar').style.width = pct + '%';
  $('#hp-bar').style.background = pct > 50 ? 'linear-gradient(#a5d07f,#6da34f)' : pct > 25 ? 'linear-gradient(#e8c76a,#cf9b34)' : 'linear-gradient(#e08a7a,#b9503c)';
  $('#hp-text').textContent = hp.current + ' / ' + hp.max + (hp.temp ? ' (+' + hp.temp + ' врем.)' : '');
  $('#dying-val').textContent = hp.dying || 0;
  $('#wounded-val').textContent = hp.wounded || 0;
  // панель «ПЗ и щит» (раскладка official)
  renderHpShieldPanel();
  var hc = $('#hp-big-cur'), hm = $('#hp-big-max'), sc = $('#shield-big'), sm = $('#shield-big-max');
  if (hc) {
    hc.textContent = hp.current;
    hm.textContent = 'из ' + hp.max + (hp.temp ? ' +' + hp.temp : '');
    var sh = State.sheet.armor.shield || {};
    sc.textContent = sh.current != null ? sh.current : (sh.hp || 0);
    sm.textContent = 'из ' + (sh.hp || 0);
  }
  // сводка боя (раскладка sanych): обновляем только цифры, список ударов — в renderAll
  var cbox = $('#combat-summary');
  if (cbox && cbox.childNodes.length) {
    var vals = [d.ac, modStr(d.perception), modStr(d.saves.fortitude), modStr(d.saves.reflex),
                modStr(d.saves.will), d.classDC, modStr(d.spellAttack), d.spellDC];
    $all('.cstat b', cbox).forEach(function (bEl, i) { if (vals[i] != null) bEl.textContent = String(vals[i]); });
    $all('.combat-strike .strike-attack', cbox).forEach(function (e, i) {
      var all = d.strikes.melee.concat(d.strikes.ranged);
      if (all[i] != null) e.textContent = modStr(all[i]);
    });
  }
}

function renderAll() {
  if (!State.sheet) return;
  renderCharSwitcher();
  bindInputs(document);
  renderAbilities();
  renderDefense();
  renderSkills();
  renderStrikes();
  renderWeaponProf();
  renderHeroPoints();
  renderLanguages();
  renderCombatSummary();
  renderSpells();
  renderFeats();
  renderActions();
  renderInventory();
  updateComputed();
  syncCombatStrip();

  /* Пересобираем раскладку, если пользователь сменил тему между рендерами */
  var grid = $('#sheet-grid');
  if (grid && grid.dataset.layoutApplied !== currentTheme()) applyLayout(currentTheme());
  refreshAllTextareas();   // после подстановки значений data-bind
}

/* Раскладка «Тёмный VTT» (strip): панель «ПЗ и щит» дублируется в верхнюю
   горизонтальную ленту над колонками. Копия — только для отображения
   (id удалены), поэтому не конфликтует с оригиналом при updateComputed. */
function syncCombatStrip() {
  var grid = $('#sheet-grid'); if (!grid) return;
  var src = $('#hp-shield-panel');
  var stripBox = $('.combat-strip', grid);
  if (!src || !stripBox) return;
  if (grid.dataset.strip === '1') {
    // пересобираем копию при каждом рендере, чтобы цифры были актуальны
    stripBox.innerHTML = '';
    var clone = src.cloneNode(true);
    clone.removeAttribute('id');
    $all('[id]', clone).forEach(function (n) { n.removeAttribute('id'); });
    // в копии не нужны элементы управления блоком и drag-обработчики
    $all('.sec-controls', clone).forEach(function (n) { n.remove(); });
    $all('legend.drag-handle', clone).forEach(function (n) { n.classList.remove('drag-handle'); });
    $all('[data-dkey]', clone).forEach(function (n) { delete n.dataset.dkey; });
    stripBox.appendChild(clone);
  } else {
    stripBox.innerHTML = '';
  }
}

/* ---------------- броски кубиков ---------------- */
function modal(htmlNodes) {
  var m = $('#modal'); m.innerHTML = '';
  htmlNodes.forEach(function (n) { m.appendChild(n); });
  $('#modal-back').classList.remove('hidden');
  m.onclick = function (ev) { ev.stopPropagation(); };
  $('#modal-back').onclick = closeModal;
}
function closeModal() { $('#modal-back').classList.add('hidden'); }
function roll(n, sides) {
  var arr = []; var sum = 0;
  for (var i = 0; i < n; i++) { var v = 1 + Math.floor(Math.random() * sides); arr.push(v); sum += v; }
  return { arr: arr, sum: sum };
}
function rollCheck(name, bonus) {
  var d = roll(1, 20);
  var nat = d.arr[0];
  var total = nat + bonus;
  var crit = nat === 20 ? ' — критический успех!' : nat === 1 ? ' — провал!' : '';
  showRoll('Проверка: ' + name, '🎲 d20 = ' + nat + ' ' + modStr(bonus) + ' = <b>' + total + '</b>' + crit, nat);
}
function rollStrike(name, bonus, dmgExpr) {
  var d = roll(1, 20);
  var nat = d.arr[0];
  var html = 'Атака «' + name + '»: d20 = ' + nat + ' ' + modStr(bonus) + ' = <b>' + (nat + bonus) + '</b>';
  if (nat === 20) html += ' — критическое попадание!';
  if (dmgExpr) {
    var m = /(\d*)d(\d+)([+-]\d+)?/i.exec(dmgExpr);
    if (m) {
      var times = nat === 20 ? 2 : 1;
      var dice = roll(Math.max(1, parseInt(m[1] || '1', 10)) * times, parseInt(m[2], 10));
      var flat = m[3] ? parseInt(m[3], 10) * (m[3][0] === '-' ? 1 : times) : 0;
      html += '<br>Урон: ' + dice.sum + ' + ' + flat + ' = <b>' + (dice.sum + flat) + '</b> (' + dice.arr.join(',') + ')';
      applyDamage(-(dice.sum + flat));
    }
  }
  showRoll('Бросок атаки', html, nat);
}
function showRoll(title, html, nat) {
  modal([
    el('h3', { text: title }),
    el('div', { html: html, style: 'font-size:16px;margin:10px 0;' }),
    el('div', { class: 'row end' }, [el('button', { class: 'btn primary', text: 'Закрыть', onclick: closeModal })])
  ]);
}
function applyDamage(delta) {
  var hp = State.sheet.hitPoints;
  var d = delta;
  if (d < 0) {
    var t = hp.temp || 0;
    var absorbed = Math.min(t, -d);
    hp.temp = t - absorbed;
    d += absorbed;
  }
  hp.current = Math.max(-10, Math.min(hp.max, hp.current + d));
  markDirty();
  updateComputed();
}

/* ---------------- сохранение в HTML ---------------- */
var DATA_START = '<!-- PF2E-SHEET-DATA:START -->';
var DATA_END = '<!-- PF2E-SHEET-DATA:END -->';
function embeddedData() {
  var node = $('#pf2e-embedded-data');
  if (!node) return null;
  try { return JSON.parse(node.textContent); } catch (e) { return null; }
}
/**
 * Генерирует автономный HTML-файл с указанными персонажами внутри.
 * Берёт текущий документ и заменяет JSON-блок данных; инлайнит стили/скрипт,
 * чтобы файл работал сам по себе (file://).
 */
function buildStandaloneHTML(sheetsArr) {
  var docHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  var payload = JSON.stringify({ schema: SCHEMA, characters: sheetsArr });
  // экранируем </script>
  payload = payload.replace(/<\//g, '<\\/');
  var re = new RegExp('(' + DATA_START + '[\\s\\S]*?' + DATA_END + ')');
  var block = DATA_START + '\n<script id="pf2e-embedded-data" type="application/json">' +
    payload + '</scr' + 'ipt>\n' + DATA_END;
  docHtml = docHtml.replace(re, block.replace(/\$/g, '$$$$'));
  // инлайним css/js для автономности
  var css = $('link[rel=stylesheet]');
  if (css) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', css.getAttribute('href'), false);
      xhr.send();
      if (xhr.status === 0 || xhr.status === 200) {
        docHtml = docHtml.replace('<link rel="stylesheet" href="' + css.getAttribute('href') + '">',
          '<style>' + xhr.responseText.replace(/<\/style>/gi, '<\\/style>') + '</style>');
      }
    } catch (e) { /* остаётся ссылка */ }
  }
  var scripts = docHtml.match(/<script src="app\.js"><\/script>/);
  if (scripts) {
    try {
      var x2 = new XMLHttpRequest();
      x2.open('GET', 'app.js', false); x2.send();
      if (x2.status === 0 || x2.status === 200) {
        docHtml = docHtml.replace('<script src="app.js"></script>',
          '<script>' + x2.responseText.replace(/<\/script>/gi, '<\\/script>') + '</scr' + 'ipt>');
      }
    } catch (e) { /* ignore */ }
  }
  return docHtml;
}

function download(filename, content, mime) {
  var blob = new Blob([content], { type: mime || 'application/octet-stream' });
  var a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  toast('Файл сохранён: ' + filename);
}

/* ---------------- буфер обмена ---------------- */
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () { toast('Скопировано в буфер'); },
      function () { fallbackCopy(text); });
  }
  fallbackCopy(text);
  return Promise.resolve();
}
function fallbackCopy(text) {
  var ta = el('textarea', { style: 'position:fixed;left:-2000px' });
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Скопировано в буфер'); }
  catch (e) { toast('Не удалось скопировать — используйте JSON-поле', true); }
  ta.remove();
}
function pasteText() {
  if (navigator.clipboard && navigator.clipboard.readText) {
    return navigator.clipboard.readText().catch(function () { return promptPaste(); });
  }
  return Promise.resolve(promptPaste());
}
function promptPaste() {
  var t = window.prompt('Вставьте JSON данных персонажа:');
  return t || '';
}

/* ---------------- импорт/экспорт ---------------- */
function importJSONText(text, opts) {
  var data;
  try { data = JSON.parse(text); }
  catch (e) { toast('Некорректный JSON: ' + e.message, true); return false; }
  return importData(data, opts);
}
function importData(data, opts) {
  opts = opts || {};
  var list = [];
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.characters)) list = data.characters;
  else if (data && data.schema && data.name != null) list = [data];
  else if (data && typeof data === 'object') {
    // словарь {id: sheet}
    Object.keys(data).forEach(function (k) { if (data[k] && data[k].name) list.push(data[k]); });
  }
  if (!list.length) { toast('В данных не найдено ни одного персонажа', true); return false; }
  var map = Store.loadAll();
  var firstNew = null;
  list.forEach(function (raw) {
    var s = normalizeSheet(raw);
    if (map[s.id] && !opts.forceNewId) {
      // совпадение id — оставляем новый id если это явный импорт чужого
      if (opts.reassignIds) s.id = uid();
    }
    if (!firstNew) firstNew = s.id;
    map[s.id] = s;
  });
  Store.saveAll(map);
  renderCharSwitcher();
  if (firstNew && (!State.currentId || !opts.keepCurrent)) switchCharacter(firstNew);
  toast('Импортировано персонажей: ' + list.length);
  return true;
}
function exportCurrentJSON(pretty) {
  var s = clone(State.sheet);
  return JSON.stringify(s, null, pretty === false ? 0 : 2);
}
function refreshJsonEditor() {
  if (State.sheet) $('#json-editor').value = exportCurrentJSON();
}

/* ---------------- серверное взаимодействие ---------------- */
function api(server, path, opts) {
  opts = opts || {};
  var headers = { 'Content-Type': 'application/json' };
  if (server.token) headers['X-API-Key'] = server.token;
  if (server.jwt) headers['Authorization'] = 'Bearer ' + server.jwt;
  return fetch(server.url.replace(/\/$/, '') + path, {
    method: opts.method || 'GET',
    headers: headers,
    credentials: 'include',
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function (r) {
    if (!r.ok) {
      return r.text().then(function (t) {
        var msg = t; try { msg = JSON.parse(t).error || t; } catch (e) {}
        throw new Error(msg || ('HTTP ' + r.status));
      });
    }
    var ct = r.headers.get('content-type') || '';
    return ct.indexOf('json') >= 0 ? r.json() : r.text();
  });
}

function getServers() { return Store.servers.load(); }
function saveServers(list) { Store.servers.save(list); }
function findServer(url) { return getServers().filter(function (s) { return s.url === url; })[0]; }

function loginToServer(server, user, pass) {
  return api(server, '/api/login', { method: 'POST', body: { username: user, password: pass } })
    .then(function (res) {
      server.jwt = res.token;
      server.user = res.username || user;
      persistServer(server);
      toast('Вход на ' + server.url + ' выполнен');
      loadServerCharacters(server);
    });
}
function persistServer(server) {
  var list = getServers();
  var found = false;
  list = list.map(function (s) { if (s.url === server.url) { found = true; return server; } return s; });
  if (!found) list.push(server);
  saveServers(list);
}

function loadServerCharacters(server) {
  var p = server.token ? api(server, '/api/characters') :
         (server.jwt ? api(server, '/api/characters') : Promise.reject(new Error('Нет учётных данных')));
  return p.then(function (chars) {
    State.serverChars[server.url] = chars;
    renderServersUI();
  }).catch(function (e) {
    toast('Сервер ' + server.url + ': ' + e.message, true);
    State.serverChars[server.url] = null;
    renderServersUI();
  });
}

function pushToServer(server, sheet, charId) {
  var payload = clone(sheet);
  return api(server, '/api/characters' + (charId ? '/' + encodeURIComponent(charId) : ''), {
    method: charId ? 'PUT' : 'POST', body: payload
  }).then(function (res) {
    toast('Загружено на сервер: ' + (res.character ? res.character.name : payload.name));
    return loadServerCharacters(server);
  });
}

/* ---------------- UI вкладки «Серверы» ---------------- */
function renderServersUI() {
  var list = getServers();
  var box = $('#server-list'); box.innerHTML = '';
  if (!list.length) box.appendChild(el('div', { class: 'hint', text: 'Серверов пока нет. Добавьте адрес выше, например http://localhost:8090' }));
  list.forEach(function (srv) {
    var item = el('div', { class: 'srv-item' + (State.selectedServer === srv.url ? ' sel' : '') });
    var led = el('span', { class: 'dotled' + (State.serverChars[srv.url] ? ' ok' : (State.serverChars[srv.url] === null ? ' err' : '')), title: 'Статус' });
    item.append(led,
      el('span', { class: 'url', text: srv.url }),
      el('span', { text: srv.user ? '@' + srv.user : (srv.token ? '🔑 API' : 'не авторизован') }),
      el('button', { class: 'btn small', text: '⟳', title: 'Обновить список', onclick: function (ev) { ev.stopPropagation(); loadServerCharacters(srv); } }),
      el('button', { class: 'btn small danger', text: '✕', onclick: function (ev) {
        ev.stopPropagation();
        saveServers(getServers().filter(function (s) { return s.url !== srv.url; }));
        if (State.selectedServer === srv.url) State.selectedServer = null;
        renderServersUI();
      }})
    );
    item.addEventListener('click', function () { State.selectedServer = srv.url; renderServersUI(); });
    box.appendChild(item);
  });
  renderServerAuth(list);
  renderServerChars(list);
}

function renderServerAuth(list) {
  var box = $('#srv-auth'); box.innerHTML = '';
  var srv = list.filter(function (s) { return s.url === State.selectedServer; })[0];
  if (!srv) { box.appendChild(el('div', { class: 'hint', text: 'Выберите сервер.' })); return; }
  var uLbl = el('label', { text: 'Логин' }); var u = el('input', { value: srv.username || '' }); uLbl.appendChild(u);
  var pLbl = el('label', { text: 'Пароль' }); var p = el('input', { type: 'password' }); pLbl.appendChild(p);
  var btnLogin = el('button', { class: 'btn primary', text: 'Войти', onclick: function () {
    loginToServer(srv, u.value, p.value).catch(function (e) { toast('Ошибка входа: ' + e.message, true); });
  }});
  var regBtn = el('button', { class: 'btn', text: 'Регистрация', onclick: function () {
    api(srv, '/api/register', { method: 'POST', body: { username: u.value, password: p.value } })
      .then(function () { toast('Аккаунт создан, выполняю вход…'); return loginToServer(srv, u.value, p.value); })
      .catch(function (e) { toast('Регистрация: ' + e.message, true); });
  }});
  box.append(el('div', { class: 'row' }, [uLbl, pLbl]), el('div', { class: 'row' }, [btnLogin, regBtn]));

  var kLbl = el('label', { text: 'API-ключ (можно вместо логина)' });
  var k = el('input', { value: srv.token || '', placeholder: 'pf2e_xxxx…' }); kLbl.appendChild(k);
  var kBtn = el('button', { class: 'btn', text: 'Сохранить ключ', onclick: function () {
    srv.token = k.value.trim() || null; persistServer(srv); loadServerCharacters(srv);
  }});
  box.appendChild(el('div', { class: 'row' }, [kLbl, kBtn]));
  box.appendChild(el('div', { class: 'hint', html:
    'Ключи создаются на странице профиля пользователя на сервере (<code class="inline">' + esc(srv.url) + '/user</code>).', }));
}

function renderServerChars(list) {
  var box = $('#srv-chars'); box.innerHTML = '';
  if (!State.selectedServer) { box.textContent = 'Выберите сервер слева.'; return; }
  var srv = list.filter(function (s) { return s.url === State.selectedServer; })[0];
  var chars = State.serverChars[srv.url];
  if (chars === undefined) { box.textContent = 'Загрузка…'; loadServerCharacters(srv); return; }
  if (chars === null) { box.textContent = 'Не удалось получить список (см. уведомление об ошибке).'; return; }
  if (!chars.length) { box.textContent = 'На сервере персонажей нет.'; return; }
  var table = el('table');
  table.appendChild(el('tr', { html: '<th>Имя</th><th>Класс</th><th>Ур.</th><th>Обновлён</th><th></th>' }));
  chars.forEach(function (ch) {
    var tr = el('tr');
    tr.appendChild(el('td', { text: ch.name }));
    tr.appendChild(el('td', { text: ch.class || '' }));
    tr.appendChild(el('td', { text: String(ch.level || '') }));
    tr.appendChild(el('td', { text: (ch.updatedAt || '').slice(0, 16).replace('T', ' ') }));
    var td = el('td');
    td.append(
      el('button', { class: 'btn small', text: '⤓ Скачать', onclick: function () {
        api(srv, '/api/characters/' + encodeURIComponent(ch.id)).then(function (full) {
          importData(full.character || full, { keepCurrent: false });
        }).catch(function (e) { toast(e.message, true); });
      }}),
      el('button', { class: 'btn small', text: '⇄ Заменить текущего', onclick: function () {
        pushToServer(srv, State.sheet, ch.id);
      }}),
      el('button', { class: 'btn small danger', text: '✕', onclick: function () {
        if (!confirm('Удалить «' + ch.name + '» с сервера?')) return;
        api(srv, '/api/characters/' + encodeURIComponent(ch.id), { method: 'DELETE' })
          .then(function () { loadServerCharacters(srv); toast('Удалён с сервера'); })
          .catch(function (e) { toast(e.message, true); });
      }})
    );
    tr.appendChild(td);
    table.appendChild(tr);
  });
  box.appendChild(table);
  box.appendChild(el('button', { class: 'btn', text: '⤴ Загрузить текущего персонажа на этот сервер',
    onclick: function () { pushToServer(srv, State.sheet); } }));
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ---------------- кнопки вкладок IO ---------------- */
function wireIOButtons() {
  $('#exp-json-clipboard').addEventListener('click', function () { copyText(exportCurrentJSON()); });
  $('#exp-json-file').addEventListener('click', function () {
    download(slugify(State.sheet.name) + '.json', exportCurrentJSON(), 'application/json');
  });
  $('#exp-html').addEventListener('click', function () {
    download(slugify(State.sheet.name) + '-sheet.html', buildStandaloneHTML([clone(State.sheet)]), 'text/html');
  });
  $('#exp-all-json').addEventListener('click', function () {
    var map = Store.loadAll();
    download('pf2e-characters.json', JSON.stringify({ schema: SCHEMA, characters: Object.keys(map).map(function (k) { return map[k]; }) }, null, 2), 'application/json');
  });
  $('#exp-all-html').addEventListener('click', function () {
    var map = Store.loadAll();
    download('pf2e-all-sheets.html', buildStandaloneHTML(Object.keys(map).map(function (k) { return map[k]; })), 'text/html');
  });
  $('#imp-json-clipboard').addEventListener('click', function () {
    pasteText().then(function (t) { if (t) importJSONText(t, { reassignIds: false }); });
  });
  $('#imp-json-file-btn').addEventListener('click', function () { $('#imp-json-file').click(); });
  $('#imp-json-file').addEventListener('change', function (ev) {
    var f = ev.target.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () { importJSONText(String(fr.result)); };
    fr.readAsText(f); ev.target.value = '';
  });
  $('#imp-html-btn').addEventListener('click', function () { $('#imp-html-file').click(); });
  $('#imp-html-file').addEventListener('change', function (ev) {
    var f = ev.target.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var m = /<!-- PF2E-SHEET-DATA:START -->([\s\S]*?)<!-- PF2E-SHEET-DATA:END -->/.exec(String(fr.result));
      if (!m) { toast('В HTML не найден блок данных персонажа', true); return; }
      var jm = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(m[1]);
      if (!jm) { toast('Не найден JSON-блок в HTML', true); return; }
      importJSONText(jm[1].trim());
    };
    fr.readAsText(f); ev.target.value = '';
  });
  $('#imp-pdf-btn').addEventListener('click', function () {
    toast('Для PDF используйте конвертер tools/extract.py (python), затем импортируйте полученный JSON.', true);
  });
  $('#json-refresh').addEventListener('click', refreshJsonEditor);
  $('#json-apply').addEventListener('click', function () { importJSONText($('#json-editor').value, { forceNewId: false }); });
  $('#push-server').addEventListener('click', function () {
    var srv = pickServerForQuick();
    if (!srv) return;
    pushToServer(srv, State.sheet).catch(function (e) { toast(e.message, true); });
  });
  $('#pull-server').addEventListener('click', function () {
    var srv = pickServerForQuick();
    if (!srv) return;
    var chars = State.serverChars[srv.url] || [];
    var match = chars.filter(function (c) { return c.id === State.sheet.id || c.name === State.sheet.name; })[0];
    if (!match) { toast('Такого персонажа на сервере нет', true); return; }
    api(srv, '/api/characters/' + encodeURIComponent(match.id)).then(function (res) {
      var full = res.character || res;
      var map = Store.loadAll();
      var ns = normalizeSheet(full); ns.id = State.sheet.id;
      map[ns.id] = ns; Store.saveAll(map);
      switchCharacter(ns.id);
      toast('Обновлено с сервера');
    }).catch(function (e) { toast(e.message, true); });
  });
  function pickServerForQuick() {
    var list = getServers();
    if (!list.length) { toast('Нет настроенных серверов — добавьте на вкладке «Серверы»', true); switchTab('servers'); return null; }
    var srv = list.filter(function (s) { return s.url === State.selectedServer; })[0] || list[0];
    if (!srv.token && !srv.jwt) { toast('Сервер ' + srv.url + ' не авторизован — войдите или задайте API-ключ', true); switchTab('servers'); return null; }
    return srv;
  }
}
function slugify(s) {
  return (s || 'character').toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '') || 'character';
}

/* ---------------- шапка: создание/удаление ---------------- */
function wireTopbar() {
  $('#character-select').addEventListener('change', function (ev) { switchCharacter(ev.target.value); });
  $('#btn-new-char').addEventListener('click', function () {
    var s = emptySheet();
    var map = Store.loadAll(); map[s.id] = s; Store.saveAll(map);
    switchCharacter(s.id);
    toast('Создан новый персонаж');
  });
  $('#btn-del-char').addEventListener('click', function () {
    if (!State.sheet) return;
    if (!confirm('Удалить персонажа «' + State.sheet.name + '» из локального хранилища?')) return;
    Store.remove(State.sheet.id);
    var map = Store.loadAll();
    var ids = Object.keys(map);
    if (ids.length) switchCharacter(ids[0]);
    else { State.sheet = null; renderCharSwitcher(); location.reload(); }
  });
  $all('[data-hp]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-hp');
      if (v === 'full') { State.sheet.hitPoints.current = State.sheet.hitPoints.max; State.sheet.hitPoints.temp = 0; State.sheet.hitPoints.dying = 0; State.sheet.hitPoints.wounded = 0; }
      else applyDamage(Number(v));
      markDirty(); updateComputed();
    });
  });
}

/* ---------------- темы оформления (цвета + раскладка) ---------------- */
var BUILD_THEME = (typeof window !== 'undefined' && window.__PF2E_BUILD_THEME__) || '';

function validTheme(t) {
  return THEMES.some(function (x) { return x.id === t; }) ? t : 'default';
}
function currentTheme() {
  // приоритет: сохранённый выбор пользователя > тема, вшитая сборщиком > default
  return validTheme(localStorage.getItem(LS_THEME) || BUILD_THEME);
}
function themeById(id) {
  for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
  return THEMES[0];
}

/* ---------------- цветовые гаммы (независимы от тем-раскладок) ----------
   Тема (--theme / выбор в шапке) отвечает ТОЛЬКО за расположение блоков,
   гамма (--palette / отдельный список) — ТОЛЬКО за цвета и шрифты. */
var PALETTES = [
  { id: 'default',  name: 'Гамма: Классическая (пергамент)' },
  { id: 'official', name: 'Гамма: Официальная Paizo (cream)' },
  { id: 'sanych',   name: 'Гамма: Ночная пергаментно-зелёная (Саныч)' },
  { id: 'dark',     name: 'Гамма: Тёмный VTT (янтарь)' }
];
function validPalette(t) {
  for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === t) return t;
  return 'default';
}
var BUILD_PALETTE = (typeof window !== 'undefined' && window.__PF2E_BUILD_PALETTE__) || '';
function currentPalette() {
  return validPalette(localStorage.getItem(LS_PALETTE) || BUILD_PALETTE);
}

/* Выпадающий список тем-раскладок в шапке: только расположение блоков. */
function wireThemePicker() {
  var sel = $('#theme-select');
  if (!sel) return;
  sel.innerHTML = '';
  THEMES.forEach(function (t) {
    var o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    sel.appendChild(o);
  });
  var apply = function () {
    var id = validTheme(sel.value);
    localStorage.setItem(LS_THEME, id);
    // переключение раскладки — классом theme-<id> на <body> (как делает сборщик)
    THEMES.forEach(function (t) { document.body.classList.remove('theme-' + t.id); });
    if (id !== 'default') document.body.classList.add('theme-' + id);
    sel.value = id;
    applyLayout(id);
    renderAll();
  };
  sel.value = currentTheme();
  sel.addEventListener('change', apply);
  apply();
}

/* Выпадающий список цветовых гамм в шапке: только цвета/шрифты. */
function wirePalettePicker() {
  var sel = $('#palette-select');
  if (!sel) return;
  sel.innerHTML = '';
  PALETTES.forEach(function (t) {
    var o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    sel.appendChild(o);
  });
  var apply = function () {
    var id = validPalette(sel.value);
    localStorage.setItem(LS_PALETTE, id);
    PALETTES.forEach(function (t) { document.body.classList.remove('pal-' + t.id); });
    if (id !== 'default') document.body.classList.add('pal-' + id);
    sel.value = id;
  };
  sel.value = currentPalette();
  sel.addEventListener('change', apply);
  apply();
}

/* ---------------- инициализация ---------------- */
function boot() {
  renderTabs();
  ensureBlockIds();   // стабильные id блоков — до первой раскладки
  wireThemePicker();
  wirePalettePicker();
  wireTopbar();
  wireIOButtons();
  wireEditMode();

  // 1) загружаем персонажей: localStorage + встроенные в HTML данные
  var map = Store.loadAll();
  var embedded = embeddedData();
  var embeddedList = embedded && embedded.characters ? embedded.characters : (Array.isArray(embedded) ? embedded : (embedded && embedded.name ? [embedded] : []));
  var addedFromEmbed = 0;
  embeddedList.forEach(function (raw) {
    var s = normalizeSheet(raw);
    if (!map[s.id]) { map[s.id] = s; addedFromEmbed++; }
  });
  if (addedFromEmbed) Store.saveAll(map);

  var ids = Object.keys(map);
  // приоритет встроенному в HTML первому персонажу при первом запуске
  var savedCur = localStorage.getItem(LS_CURRENT);
  if (!savedCur && embeddedList.length && map[embeddedList[0].id]) savedCur = embeddedList[0].id;
  if (!ids.length) {
    var s = emptySheet(); s.name = 'Новый персонаж';
    map[s.id] = s; Store.saveAll(map); ids = [s.id]; savedCur = s.id;
  }
  State.currentId = (savedCur && map[savedCur]) ? savedCur : ids[0];
  State.sheet = normalizeSheet(map[State.currentId]);

  renderAll();
  wireTabBlocks();   // drag за блоки на вкладках Инвентарь/Биография/Серверы/Импорт
  setState('Готово');
  switchTab('sheet');
}

/* ==========================================================================
   РАСКЛАДКА И ПЕРЕТАСКИВАНИЕ БЛОКОВ (режим «Редактирование»)
   --------------------------------------------------------------------------
   Единый движок для всех вкладок. Исправлены три проблемы прежней версии:
     1) Блоки НЕ встраиваются друг в друга: drop-зоной может быть только
        колонка-контейнер (.sheet-area / .tabpage / grid2/grid3/srv-layout —
        только верхнего уровня). Блок fieldset принимает drop лишь когда под
        курсором его ЗАГОЛОВОК (legend), и тогда вставляется ПЕРЕД ним, а не
        внутрь. Вставка внутрь fieldset физически невозможна (insertBlock
        работает только с контейнерами-колонками).
     2) Если из колонки вынести все блоки — она остаётся видимой зоной
        (min-height в CSS + класс .area-empty), поэтому в неё снова можно
        перетащить блок; пустая колонка больше не «схлопывается», и блоки не
        уезжают вниз страницы на две колонки.
     3) Порядок блоков внутри одной колонки меняется перетаскиванием: цель
        определяется по вертикали (вставить перед/после блока), правка
        сохраняется в ту же раскладку, что и состав колонок.
   Ключи раскладки — стабильные data-bid (уникальны для каждого блока, включая
   одноимённые секции sec-hp/sec-strikes и панель #hp-shield-panel).
   ========================================================================== */

/* Назначение блока по id (для подсказок в панели управления). */
var BLOCK_LABELS = {
  'info': 'Основное', 'abil': 'Характеристики', 'def': 'Защиты',
  'hp-top': 'ПЗ и щит (верхняя панель)', 'hp': 'Пункты здоровья',
  'skills': 'Навыки', 'strikes': 'Удары', 'wpnprof': 'Профичности оружия',
  'combat': 'Бой', 'magic': 'Магия', 'feats': 'Черты и умения', 'actions': 'Действия'
};

/* ---------- присвоение стабильных id блокам ---------- */
function ensureBlockIds() {
  var n = 0;
  function mark(node) { if (!node.dataset.bid) node.dataset.bid = 'b' + (++n); }
  // Вкладка «Лист»: сначала обход DOM (стабильно между темами), затем
  // отдельные панели по id (их порядок в DOM зависит от раскладки темы).
  var grid = $('#sheet-grid');
  if (grid) {
    /* «Основное» — прямой ребёнок #sheet-grid, помечаем первым, чтобы bid
       был стабильным независимо от порядка обхода колонок. */
    var info = $('.info-block', grid);
    if (info && !info.dataset.bid) info.dataset.bid = 'info';
    $all(':scope > .sheet-area > fieldset', grid).forEach(mark);
  }
  [['#hp-shield-panel', 'hp-top'], ['#weapon-prof-panel', 'wpnprof']].forEach(function (p) {
    var elx = $(p[0]);
    if (elx && elx.tagName === 'FIELDSET' && !elx.dataset.bid) elx.dataset.bid = p[1];
  });
  if (grid) $all('fieldset', grid).forEach(mark);
  // Остальные вкладки: все fieldset в порядке DOM.
  $all('.tabpage').forEach(function (page) {
    if (page.id === 'tab-sheet') return;
    $all('fieldset', page).forEach(mark);
  });
}
function blockTitle(node) {
  var lg = node.querySelector(':scope > legend');
  if (lg) return lg.textContent.trim();
  return BLOCK_LABELS[node.dataset.bid] || node.dataset.bid || 'Блок';
}

/* ---------- зоны и контейнеры ---------- */
/* Колонки-контейнеры текущей вкладки. Только они могут принимать блоки —
   поэтому вложение блоков друг в друга исключено структурно. */
function tabContainers(tabId) {
  if (tabId === 'sheet') {
    return ['left', 'mid', 'right'].map(function (c) {
      return $('.sheet-area[data-col="' + c + '"]');
    }).filter(Boolean);
  }
  var page = $('#tab-' + tabId);
  if (!page) return [];
  // раскладка вкладки запоминается ТОЛЬКО когда её контейнеры — колонки одного
  // grid-ряда (.grid3/.srv-layout): блоки можно менять местами между колонками.
  // Вкладки с запрещённым переносом («Серверы», «Импорт/экспорт») не имеют зон.
  if (NO_DRAG_TABS[tabId]) return [];
  // «Биография»: каждая секция — ячейка фиксированной 12-колоночной сетки
  // (span 4 = три столбца); drag меняет только порядок секций внутри ряда.
  if (tabId === 'bio') {
    var row = $('.bio-grid', page);
    return row ? [row] : [];
  }
  var out = [];
  for (var n = page.firstElementChild; n; n = n.nextElementSibling) {
    if (n.classList.contains('grid3') || n.classList.contains('srv-layout')) {
      /* grid3: fieldset-и — прямые дети ряда, сам ряд и есть контейнер.
         srv-layout: children div-колонки (.srv-left/.srv-right). */
      if (n.classList.contains('grid3')) { out.push(n); continue; }
      for (var k = n.firstElementChild; k; k = k.nextElementSibling) {
        if (k.classList.contains('srv-left') || k.classList.contains('srv-right')) out.push(k);
      }
    }
  }
  return out;
}
function isContainerNode(node, tabId) {
  if (tabId === 'sheet') return !!(node.classList && node.classList.contains('sheet-area'));
  if (node.tagName === 'FIELDSET') return false;
  var page = $('#tab-' + tabId);
  return !!page && page.contains(node);
}
function containerOf(node) {
  while (node) { if (node.dataset && node.dataset.col) return node; node = node.parentElement; }
  return null;
}
function visibleTabId() {
  var p = $('#main > .tabpage:not(.hidden)');
  return p ? p.id.replace('tab-', '') : 'sheet';
}
function blocksOf(container) {
  return Array.prototype.filter.call(container.children, function (c) {
    return c.nodeType === 1 && c.tagName === 'FIELDSET';
  });
}

/* ---------- хранилище пользовательских раскладок ---------- */
function loadUserLayouts() {
  try { return JSON.parse(localStorage.getItem(LS_LAYOUT) || '{}') || {}; }
  catch (e) { return {}; }
}
function saveUserLayouts(obj) { localStorage.setItem(LS_LAYOUT, JSON.stringify(obj)); }
function userLayoutFor(themeId) {
  var all = loadUserLayouts();
  return all[themeId] || null;
}
function setUserLayout(themeId, lay) {
  var all = loadUserLayouts();
  if (!lay) delete all[themeId]; else all[themeId] = lay;
  saveUserLayouts(all);
}
function loadTabStructures() {
  try { return JSON.parse(localStorage.getItem(LS_TABSTRUCT) || '{}') || {}; }
  catch (e) { return {}; }
}
function saveTabStructures(obj) { localStorage.setItem(LS_TABSTRUCT, JSON.stringify(obj)); }

/* Эффективная раскладка вкладки «Лист»: базовая от темы + правки поверх.
   Базовый map строится ПРЯМО из DOM (какой блок в какой колонке лежит в
   исходной разметке шаблона) — так исключаются ошибки ручного маппинга
   sec-* классов на колонки. Порядок внутри колонок сохраняется как в DOM.
   Правки пользователя (u.map) накладываются поверх, если существуют. */
var SHEET_AREA_COLS = ['left', 'mid', 'right'];
function baseSheetMap() {
  var grid = $('#sheet-grid');
  var out = { left: [], mid: [], right: [], full: [] };
  if (!grid) return out;
  /* Именные панели вне колонок («Основное», «Профичности оружия», дубль
     «ПЗ и щит») привязаны к своим секциям: без этого они оставались бы
     прямыми детьми #sheet-grid и ломали потоковую 12-колоночную сетку. */
  var HOME = { 'hp-shield-panel': 'hp', 'weapon-prof-panel': 'wpnprof' };
  SHEET_AREA_COLS.forEach(function (c) {
    var area = $('.sheet-area[data-col="' + c + '"]', grid);
    if (!area) return;
    blocksOf(area).forEach(function (f) { out[c].push(f.dataset.bid); });
  });
  $all(':scope > fieldset', grid).forEach(function (f) {
    var bid = f.dataset.bid;
    var homeSec = HOME[f.id];
    var col = null;
    if (homeSec) {
      for (var i = 0; i < SHEET_AREA_COLS.length; i++) {
        if (out[SHEET_AREA_COLS[i]].indexOf(homeSec) >= 0) { col = SHEET_AREA_COLS[i]; break; }
      }
    }
    if (col) {
      var at = out[col].indexOf(homeSec) + 1;
      out[col].splice(at, 0, bid);          // сразу после домашней секции
      f.dataset.col = col;
      var area = $('.sheet-area[data-col="' + col + '"]', grid);
      var ref = area.children[at - 1] || null;
      area.insertBefore(f, ref ? ref.nextSibling : null);
    } else {
      f.dataset.col = 'full';               // широкая шапка («Основное»)
      out.full.push(bid);
    }
  });
  return out;
}
function effectiveLayout(themeId) {
  var base = themeById(themeId).layout || {};
  var u = userLayoutFor(themeId) || {};
  var bmap = baseSheetMap();
  var map = { left: (u.map && u.map.left) || bmap.left,
              mid: (u.map && u.map.mid) || bmap.mid,
              right: (u.map && u.map.right) || bmap.right,
              full: (u.map && u.map.full) || bmap.full };
  return { cols: base.cols === 2 ? 2 : 3, map: map,
           textCols: u.textCols || {},
           strip: base.strip, hide: base.hide };
}
function mutateSheetLayout(fn) {
  var themeId = currentTheme();
  var all = loadUserLayouts();
  var u = all[themeId] || (all[themeId] = {});
  if (!u.map) u.map = effectiveLayout(themeId).map;
  fn(u);
  saveUserLayouts(all);
}

/* Запоминание текущего расположения блоков вкладки (лист — как map по bid,
   прочие вкладки — как список колонок dkey-сов... используется тот же bid). */
function captureStructure(tabId) {
  if (tabId === 'sheet') {
    var areas = { left: $('.sheet-area[data-col="left"]'),
                  mid: $('.sheet-area[data-col="mid"]'),
                  right: $('.sheet-area[data-col="right"]') };
    mutateSheetLayout(function (u) {
      u.map = u.map || {};
      ['left', 'mid', 'right'].forEach(function (c) {
        u.map[c] = areas[c] ? blocksOf(areas[c]).map(function (b) { return b.dataset.bid; }) : [];
      });
    });
    return;
  }
  var conts = tabContainers(tabId);
  var cols = conts.map(function (c) {
    return blocksOf(c).map(function (b) { return b.dataset.bid; });
  });
  var all = loadTabStructures();
  all[tabId] = { cols: cols };
  saveTabStructures(all);
  reflowGridRow(conts);
  conts.forEach(function (c) { c.classList.toggle('area-empty', blocksOf(c).length === 0); });
}

/* Перенос блока в контейнер (перед before или в конец). Гарантирует, что
   блок — прямой ребёнок колонки, т.е. вложение невозможно. */
function insertBlock(node, container, before) {
  if (before && before.parentNode !== container) before = null;
  if (before) container.insertBefore(node, before);
  else container.appendChild(node);
}

/* ---------- применение раскладки вкладки «Лист» (12-колоночная сетка) ----
   Колонки (.sheet-area) — прямые дети #sheet-grid; каждая занимает span
   колонок сетки: 4 (три столбца — все темы, кроме official) или 6 (два
   столбца — официальный лист Paizo). Блоки физически лежат ВНУТРИ колонок
   (flex-столбик), поэтому вложение блоков друг в друга структурно
   невозможно. Порядок = DOM (никаких order/grid-area трюков).

   Drag-and-drop на вкладке «Лист»: drop-цель всегда — колонка (.sheet-area)
   или чужой блок (легенда → вставка перед ним в ТОЙ ЖЕ колонке). При drop
   блок вынимается из своей колонки и вставляется в колонку-цель (перед
   целевым блоком или в конец) — никогда внутрь fieldset и не прямым ребёнком
   сетки. В 2-колоночных темах скрытая mid-колонка остаётся в DOM пустой и
   тоже является зоной возврата: её блоки физически живут в левой колонке, а
   их «домашняя» колонка хранится в u.map. Дублирующиеся панели скрываются
   .sec-hidden. ИЗМЕНЕНИЕ РАЗМЕРА БЛОКОВ УБРАНО полностью: ширина задаётся
   только раскладкой темы. */
function applyLayout(themeId) {
  var grid = $('#sheet-grid'); if (!grid) return;
  var lay = effectiveLayout(themeId);
  var cols = lay.cols === 2 ? 2 : 3;

  var areas = {
    left: $('.sheet-area[data-col="left"]', grid),
    mid: $('.sheet-area[data-col="mid"]', grid),
    right: $('.sheet-area[data-col="right"]', grid)
  };

  grid.dataset.cols = String(cols);
  grid.dataset.strip = lay.strip ? '1' : '0';
  var span = colSpan(themeId);            // 4 (три столбца) или 6 (Paizo)
  SHEET_AREA_COLS.forEach(function (c) {
    if (areas[c]) { areas[c].dataset.col = c; areas[c].style.setProperty('--span', String(span)); }
  });
  var strip = $('.combat-strip', grid);
  if (strip) strip.dataset.col = 'strip';
  var info = $('.info-block', grid);
  if (info) { info.dataset.col = 'full'; info.classList.add('sheet-sec'); }

  /* Санация структуры ДО нормализации: блоки, «убежавшие» прямыми детьми
     #sheet-grid или вложившиеся в чужой fieldset, возвращаем в домашние
     колонки (иначе map-нормализация их не найдёт и они уедут в конец). */
  function homeColOf(bid) {
    for (var ci = 0; ci < SHEET_AREA_COLS.length; ci++) {
      if ((lay.map[SHEET_AREA_COLS[ci]] || []).indexOf(bid) >= 0) return SHEET_AREA_COLS[ci];
    }
    return null;
  }
  $all(':scope > fieldset[data-bid]', grid).forEach(function (f) {
    if (f.dataset.col === 'full') return;
    var home = homeColOf(f.dataset.bid);
    var cont = home && !(home === 'mid' && cols === 2) ? areas[home] : areas.left;
    if (f.parentNode !== cont) { delete f._dragWire; cont.appendChild(f); }
  });
  $all('fieldset fieldset[data-bid]', grid).forEach(function (f) {   // вложение — недопустимо
    var host = f.closest('.sheet-area');
    if (host) { delete f._dragWire; host.appendChild(f); }
    else {
      var home2 = homeColOf(f.dataset.bid);
      var cont2 = home2 && areas[home2] ? areas[home2] : areas.right;
      delete f._dragWire; cont2.appendChild(f);
    }
  });
  /* Нормализация: каждый блок кладём КОНЦЕМ своей колонки согласно map
     (последовательный обход map задаёт точный порядок). В 2-колоночной
     теме блоки mid физически переезжают в левую колонку; скрытая mid-
     колонка остаётся в DOM пустой — она тоже допустимая drop-зона. */
  var placed = {};
  SHEET_AREA_COLS.forEach(function (col) {
    var cont = col === 'mid' && cols === 2 ? areas.left : areas[col];
    if (!cont) return;
    (lay.map[col] || []).forEach(function (bid) {
      var node = $('[data-bid="' + bid + '"]', grid);
      if (!node || placed[bid] || node === cont) return;
      placed[bid] = true;
      node.style.order = '';              // больше не используем order
      if (node.parentNode !== cont) cont.appendChild(node);
      else { delete node._dragWire; node.remove(); cont.appendChild(node); }
    });
  });
  // «Основное» и прочие full-блоки — прямые дети сетки, во всю ширину
  (lay.map.full || []).forEach(function (bid) {
    var node = $('[data-bid="' + bid + '"]', grid);
    if (node) { node.dataset.col = 'full'; placed[bid] = true; }
  });
  // страховка: любой непойманный блок владения листа — в правую колонку
  $all('fieldset[data-bid]', grid).forEach(function (f) {
    if (f.closest('#sheet-grid') !== grid) return;   // чужие вкладки — мимо
    if (f.classList.contains('sheet-area')) return;
    if (f.dataset.bid && !placed[f.dataset.bid] && f.dataset.col !== 'full') {
      areas.right.appendChild(f);
    }
  });
  areas.mid.style.display = cols === 2 ? 'none' : '';

  // число колонок текста; РАЗМЕР БЛОКОВ НЕ РЕГУЛИРУЕТСЯ: старые атрибуты
  // data-cols/data-width и панели .sec-controls удаляем со всех блоков —
  // ширина задаётся только раскладкой темы (12-колоночная сетка, span 4/6)
  $all('fieldset[data-bid]', grid).forEach(function (node) {
    if (node.closest('#sheet-grid') !== grid) return;
    node.removeAttribute('data-width');
    node.removeAttribute('data-cols');
    removeSecControls(node);
    ensureBodyWrap(node);
    wireBlockDrag(node);
  });

  // скрытие дублирующихся панелей (например, панель ПЗ/щит при ленте strip)
  $all('.sheet-sec', grid).forEach(function (n) { n.classList.remove('sec-hidden'); });
  (lay.hide || []).forEach(function (sel) {
    var n = $(sel, grid); if (n) n.classList.add('sec-hidden');
  });

  /* Якоря колонок: пустая колонка схлопнулась бы в нулевую ширину и блоки
     некуда было бы возвращать — поэтому в каждую .sheet-area кладётся
     невидимый anchor (не fieldset → blocksOf его игнорирует). Он же служит
     зоной drop под последним блоком. */
  SHEET_AREA_COLS.forEach(function (c) {
    if (!areas[c]) return;
    var anc = areas[c].querySelector(':scope > .area-anchor');
    if (!anc) {
      anc = el('div', { class: 'area-anchor' });
      areas[c].appendChild(anc);
    } else {
      areas[c].appendChild(anc);          // всегда последним
    }
  });

  markEmptyAreas();
  grid.dataset.layoutApplied = themeId;
  syncCombatStrip();
  refreshAllTextareas();
}

/* Подсветка пустых колонок: они остаются.drop-зонами (min-height в CSS),
   поэтому вынесенные из колонки блоки можно вернуть обратно. */
function markEmptyAreas() {
  $all('.sheet-area').forEach(function (a) {
    a.classList.toggle('area-empty', blocksOf(a).length === 0);
  });
}

/* Обёртка содержимого секции (.sec-body-wrap) для multi-column: собираем в
   неё все дочерние узлы fieldset, кроме legend и старой панели управления.
   display:contents — не влияет на верстку (число колонок текста больше НЕ
   регулируется, правила [data-cols] удалены). */
function ensureBodyWrap(node) {
  var wrap = node.querySelector(':scope > .sec-body-wrap');
  if (!wrap) {
    wrap = el('div', { class: 'sec-body-wrap' });
    var kids = [];
    for (var n = node.firstChild; n; n = n.nextSibling) {
      if (n.tagName === 'LEGEND') continue;
      if (n.nodeType === 1 && n.classList.contains('sec-controls')) continue;
      kids.push(n);
    }
    var lg = node.querySelector('legend');
    if (lg && lg.nextSibling) node.insertBefore(wrap, lg.nextSibling);
    else node.appendChild(wrap);
    kids.forEach(function (k) { wrap.appendChild(k); });
  }
}

/* Старые сохранения могли содержать панель .sec-controls с регулировкой
   размера блока — удаляем её навсегда (режим «Редактирование» теперь
   позволяет только перетаскивание и порядок блоков). */
function removeSecControls(node) {
  var box = node.querySelector(':scope > .sec-controls');
  if (box) box.remove();
}

/* Вкладки с запрещённым переносом блоков (структура фиксирована). */
var NO_DRAG_TABS = { servers: true, io: true };
function tabDragAllowed(tabId) { return !NO_DRAG_TABS[tabId]; }

/* Все fieldset-детей контейнера, включая временно скрытые (.sec-hidden):
   display:none не мешает appendChild/insertBefore, поэтому санация
   «убежавших» и вложенных блоков работает без снятия классов. */
function allBlocksOf(container) { return blocksOf(container); }

/* Применение сохранённой раскладки произвольной вкладки (не «Листа»). */
function applyTabStructure(tabId) {
  if (tabId === 'sheet') return;
  var page = $('#tab-' + tabId);
  if (!tabDragAllowed(tabId)) {
    /* «Серверы» и «Импорт/экспорт»: перенос блоков запрещён — снимаем
       drag-обработчики и скрытую пользовательскую раскладку этой вкладки. */
    if (page) {
      $all('fieldset', page).forEach(function (f) {
        f._dragWire = false;
        var lg = f.querySelector(':scope > legend');
        if (lg) { lg.classList.remove('drag-handle'); lg.removeAttribute('title'); }
      });
      var stAll = loadTabStructures();
      if (stAll[tabId]) { delete stAll[tabId]; saveTabStructures(stAll); }
    }
    return;
  }
  ensureBlockIds();
  var st = loadTabStructures()[tabId];
  var conts = tabContainers(tabId);
  if (!conts.length) {
    /* Вкладка без зон drag: снимаем обработчики, чтобы блоки не «убегали»
       в конец DOM при случайном перетаскивании. */
    $all('fieldset', page || document).forEach(function (f) {
      if (!page || !page.contains(f)) return;
      f._dragWire = false;
      var lg = f.querySelector(':scope > legend');
      if (lg) { lg.classList.remove('drag-handle'); lg.removeAttribute('title'); }
    });
    return;
  }
  if (st && Array.isArray(st.cols)) {
    st.cols.forEach(function (keys, ci) {
      var container = conts[Math.min(ci, conts.length - 1)];
      keys.forEach(function (k) {
        var node = document.querySelector('#tab-' + tabId + ' [data-bid="' + k + '"]');
        if (node && node.tagName === 'FIELDSET' && node.parentNode !== container) {
          container.appendChild(node);
        }
      });
    });
  }
  /* Санация: прямые fieldset-дети страницы вне контейнеров (последствие
     старых багов) возвращаем в единственную/первую зону вкладки. */
  if (page && conts.length === 1) {
    $all(':scope > fieldset[data-bid]', page).forEach(function (f) {
      delete f._dragWire;
      conts[0].appendChild(f);
    });
  }
  /* Инвентарь: ряд .inv-grid — часть 12-колоночной сетки (см. CSS).
     reflowGridRow меняет число столбцов ряда по числу НЕпустых колонок;
     если блоки перенесли в одну колонку — остальные схлопываются. */
  if (tabId === 'inventory') {
    var invRow = $('.inv-grid', page);
    if (invRow) reflowGridRow([invRow]);
  }
  conts.forEach(function (c) {
    c.classList.toggle('area-empty', blocksOf(c).length === 0);
    $all(':scope > fieldset', c).forEach(wireBlockDrag);
  });
}

/* После переноса блоков между колонками grid-ряда пересчитываем
   grid-template-columns: столько колонок, сколько непустых контейнеров
   (1..3), иначе пустая колонка оставляла бы «дыру» посреди строки. */
function reflowGridRow(conts) {
  if (!conts.length) return;
  var row = conts[0].parentElement;
  if (!row) return;
  var filled = conts.filter(function (c) { return blocksOf(c).length > 0; }).length;
  var n = Math.max(1, Math.min(3, filled));
  row.style.gridTemplateColumns = 'repeat(' + n + ', minmax(0, 1fr))';
}

/* ---------- drag engine (единый для всех вкладок) ---------- */
var dragState = null;

function wireBlockDrag(node) {
  var tabEl = node.closest ? node.closest('.tabpage') : null;
  var tabId = tabEl ? tabEl.id.replace('tab-', '') : 'sheet';
  if (!tabDragAllowed(tabId)) return;      // вкладки с запретом переноса
  if (node._dragWire) return;
  node._dragWire = true;
  var head = node.querySelector(':scope > legend');
  if (head) {
    head.classList.add('drag-handle');
    head.setAttribute('title', 'Перетащите за заголовок: между колонками или для смены порядка');
    head.addEventListener('mousedown', function (ev) { startBlockDrag(ev, node); });
  }
  // таскание за «пустое» место блока (не за элементы ввода)
  node.addEventListener('mousedown', function (ev) {
    if (!isEditMode() || ev.button !== 0) return;
    if (ev.target.closest('input,select,textarea,button,a,label,.sec-controls')) return;
    if (ev.target.tagName === 'LEGEND') return; // уже обработано выше
    startBlockDrag(ev, node);
  });
}

function startBlockDrag(ev, node) {
  if (!isEditMode()) return;
  var tabEl = node.closest ? node.closest('.tabpage') : null;
  var tabId = tabEl ? tabEl.id.replace('tab-', '') : visibleTabId();
  if (!tabDragAllowed(tabId)) return;      // «Серверы»/«Импорт-экспорт» — таскать нельзя
  if (ev.button !== 0) return;
  ev.preventDefault();
  dragState = { node: node, tab: visibleTabId(), moved: false, sx: ev.clientX, sy: ev.clientY };
  node.classList.add('dragging');
  document.body.classList.add('dragging-active');
}

/* Определение цели по координатам. Возвращает:
   {container, before|null} — вставить блок в колонку (перед before или в конец);
   null — цели нет.
   Правила против «убегания» и вложения блоков:
   - контейнером может быть ТОЛЬКО узел из tabContainers() текущей вкладки
     (колонки .sheet-area на листе, div-колонки srv-layout, сам ряд grid3);
     прямые дети #sheet-grid вне колонок — не цель;
   - чужой fieldset принимается только когда точка в его legend — тогда это
     смена порядка ВНУТРИ его колонки (вложение исключено);
   - попали телом в чужой блок — целимся в его колонку, позиция по Y. */
function validContainer(n, tabId) {
  if (!n || n.nodeType !== 1) return false;
  var conts = tabContainers(tabId);
  for (var i = 0; i < conts.length; i++) if (conts[i] === n) return true;
  return false;
}
function dropTargetAt(x, y, ds) {
  var els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if (!e || e === ds.node || e.contains(ds.node)) continue;
    // 1) заголовок чужого блока → смена порядка перед ним (в ЕГО колонке)
    if (e.tagName === 'LEGEND') {
      var fs = e.parentElement;
      if (fs && fs.tagName === 'FIELDSET' && fs !== ds.node && fs.dataset.bid) {
        var fc = fs.parentNode;
        if (validContainer(fc, ds.tab)) return { container: fc, before: fs };
      }
    }
    // 2) колонка-контейнер (только разрешённые зоной вкладки)
    if (validContainer(e, ds.tab)) return { container: e, before: null };
    // 3) попали внутрь чужого блока — целимся в его колонку, позиция — по Y
    if (e.tagName === 'FIELDSET') {
      var host = e.parentNode;
      if (!validContainer(host, ds.tab)) continue;
      var sibs = blocksOf(host).filter(function (b) { return b !== ds.node; });
      var before = null;
      for (var j = 0; j < sibs.length; j++) {
        var r = sibs[j].getBoundingClientRect();
        if (y < r.bottom) { before = sibs[j]; break; }
      }
      return { container: host, before: before };
    }
  }
  return null;
}

function initDragEvents() {
  document.addEventListener('mousemove', function (ev) {
    if (!dragState) return;
    if (Math.abs(ev.clientX - dragState.sx) + Math.abs(ev.clientY - dragState.sy) > 4) dragState.moved = true;
    var t = dropTargetAt(ev.clientX, ev.clientY, dragState);
    clearDropMarks();
    if (t && t.container) {
      t.container.classList.add('drop-over');
      if (t.before) t.before.classList.add('drop-before');
    }
  });
  document.addEventListener('mouseup', function (ev) {
    if (!dragState) return;
    var ds = dragState; dragState = null;
    clearDropMarks();
    ds.node.classList.remove('dragging');
    document.body.classList.remove('dragging-active');
    if (!ds.moved) return;                       // простой клик — ничего не делаем
    var t = dropTargetAt(ev.clientX, ev.clientY, ds);
    if (!t || !t.container) return;
    if (t.before === ds.node) return;
    if (t.container === ds.node.parentNode && !t.before) return; // уже там же в конце
    insertBlock(ds.node, t.container, t.before === ds.node ? t.before.nextSibling && isBlock(t.before.nextSibling) ? t.before.nextSibling : null : t.before);
    rememberStructure(ds.tab);
    markEmptyAreas();
    refreshAllTextareas();
  });
  // при переключении вкладки — применяем её сохранённую раскладку блоков
  document.addEventListener('click', function (ev) {
    var tb = ev.target.closest ? ev.target.closest('#tabs-nav button') : null;
    if (tb) setTimeout(function () { applyTabStructure(visibleTabId()); refreshAllTextareas(); }, 0);
  });
}
function isBlock(n) { return n && n.nodeType === 1 && n.tagName === 'FIELDSET'; }
function clearDropMarks() {
  $all('.drop-over').forEach(function (n) { n.classList.remove('drop-over'); });
  $all('.drop-before').forEach(function (n) { n.classList.remove('drop-before'); });
}
function rememberStructure(tabId) {
  captureStructure(tabId);
  if (tabId === 'sheet') applyLayout(currentTheme());
}

/* ---------------- режим редактирования ---------------- */
function isEditMode() {
  var cb = $('#edit-mode-check');
  return !!(cb && cb.checked);
}

function wireEditMode() {
  var cb = $('#edit-mode-check');
  if (!cb) return;
  cb.checked = localStorage.getItem(LS_EDITMODE) === '1';
  cb.addEventListener('change', function () {
    localStorage.setItem(LS_EDITMODE, cb.checked ? '1' : '0');
    document.body.classList.toggle('edit-mode', cb.checked);
    applyLayout(currentTheme());   // в 2-колоночных темах показываем доп. зону
    renderAll();
  });
  document.body.classList.toggle('edit-mode', cb.checked);
  var resetBtn = $('#layout-reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    setUserLayout(currentTheme(), null);
    applyLayout(currentTheme());
    toast('Раскладка темы сброшена к исходной');
  });
  initDragEvents();
}

/* Расстановка drag-обработчиков на все блоки не-листовых вкладок. */
function wireTabBlocks() {
  ensureBlockIds();
  $all('.tabpage fieldset').forEach(wireBlockDrag);
}

document.addEventListener('DOMContentLoaded', boot);
window.PF2E = { Store: Store, emptySheet: emptySheet, normalizeSheet: normalizeSheet,
  computeDerived: computeDerived, buildStandaloneHTML: buildStandaloneHTML, State: State };
})();
