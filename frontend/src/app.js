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
  if (id === 'servers') renderServersUI();
  if (id === 'io') refreshJsonEditor();
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
}

function renderDefense() {
  var s = State.sheet;
  var ab = $('#armor-block'); ab.innerHTML = '';
  ab.appendChild(el('div', { class: 'row' }, [
    el('span', { text: 'Профичность брони: ' }),
    profPicker(s.armor.prof, function (r) { s.armor.prof = r; markDirty(); updateComputed(); })
  ]));
  var sb = $('#saves-block'); sb.innerHTML = '';
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
    row.appendChild(el('button', { class: 'roll-btn', text: '🎲', onclick: function () { rollCheck(sk.name, getComputed().skills[sk.key]); } }));
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

function renderFeats() {
  var box = $('#feats-block'); box.innerHTML = '';
  var cats = { ancestry: 'Народа', class: 'Класса', skill: 'Навыков', general: 'Общие', bonus: 'Бонусные' };
  var byCat = {};
  State.sheet.feats.forEach(function (ft) { (byCat[ft.category] = byCat[ft.category] || []).push(ft); });
  Object.keys(cats).forEach(function (cat) {
    var items = byCat[cat] || [];
    box.appendChild(el('div', { class: 'feats-cat', text: cats[cat] + ' черты' }));
    items.forEach(function (ft) {
      var div = el('div', { class: 'feat-item' });
      var nm = el('input', { value: ft.name, style: 'border:none;background:transparent;font-weight:600;width:70%' });
      nm.addEventListener('input', function () { ft.name = nm.value; markDirty(); });
      div.appendChild(nm);
      div.appendChild(el('span', { class: 'lvl', text: ' ур. ' }));
      var lv = el('input', { type: 'number', value: ft.level, class: 'xs', style: 'width:48px' });
      lv.addEventListener('input', function () { ft.level = Number(lv.value) || 0; markDirty(); });
      div.appendChild(lv);
      var tx = el('textarea', { rows: 2, style: 'width:100%' });
      tx.value = ft.text || '';
      tx.addEventListener('input', function () { ft.text = tx.value; markDirty(); });
      div.appendChild(tx);
      var rm = el('button', { class: 'rm', text: '✕ удалить', onclick: function () {
        State.sheet.feats.splice(State.sheet.feats.indexOf(ft), 1); markDirty(); renderFeats();
      }});
      div.appendChild(rm);
      box.appendChild(div);
    });
  });
  box.appendChild(el('button', { class: 'btn small', text: '＋ Черта', onclick: function () {
    State.sheet.feats.push({ name: 'Новая черта', level: State.sheet.core.level, category: 'general', text: '' });
    markDirty(); renderFeats();
  }}));
}

function renderActions() {
  var box = $('#actions-block'); box.innerHTML = '';
  State.sheet.actions.forEach(function (act, idx) {
    var div = el('div', { class: 'feat-item' });
    var nm = el('input', { value: act.name, placeholder: 'Название', style: 'width:60%' });
    nm.addEventListener('input', function () { act.name = nm.value; markDirty(); });
    var ac = el('input', { value: act.actions || '', placeholder: 'Действия', style: 'width:90px' });
    ac.addEventListener('input', function () { act.actions = ac.value; markDirty(); });
    div.append(nm, ac);
    var tx = el('textarea', { rows: 2, style: 'width:100%', placeholder: 'Описание' });
    tx.value = act.text || '';
    tx.addEventListener('input', function () { act.text = tx.value; markDirty(); });
    div.appendChild(tx);
    var rm = el('button', { class: 'rm', text: '✕', onclick: function () { State.sheet.actions.splice(idx, 1); markDirty(); renderActions(); } });
    div.appendChild(rm);
    box.appendChild(div);
  });
  box.appendChild(el('button', { class: 'btn small', text: '＋ Действие', onclick: function () {
    State.sheet.actions.push({ name: '', actions: '1', traits: '', source: '', text: '' });
    markDirty(); renderActions();
  }}));
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
  renderSpells();
  renderFeats();
  renderActions();
  renderInventory();
  updateComputed();
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

/* ---------------- инициализация ---------------- */
function boot() {
  renderTabs();
  wireTopbar();
  wireIOButtons();

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
  setState('Готово');
  switchTab('sheet');
}

document.addEventListener('DOMContentLoaded', boot);
window.PF2E = { Store: Store, emptySheet: emptySheet, normalizeSheet: normalizeSheet,
  computeDerived: computeDerived, buildStandaloneHTML: buildStandaloneHTML, State: State };
})();
