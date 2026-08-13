/* ИстСайд CRM — логика. Vanilla JS, без сборки.
   3 страницы: Обзор (что происходит) · Лиды (работа: сегменты+таблица/канбан) ·
   Путь (drop-off по шагам платформы). Карточка лида — drawer справа. */
(function () {
  'use strict';

  // Боевой бэкенд (self-host Selectel). Punycode домена api.истсайд.рф — чтобы работало
  // из любого браузера. Старый Railway-домен умер при переезде. Переопределяется
  // window.EASTSIDE_API_BASE (напр. на staging/локали).
  // У CRM два адреса: crm.истсайд.рф и зеркало crm.eastside.study для тех, кто работает
  // из-за рубежа (зона .рф резолвится не везде — публичный DNS Google не разрешает
  // api.истсайд.рф). С зеркала ходим в api.eastside.study, иначе CRM открывается, но
  // ни один запрос не проходит.
  var API = window.EASTSIDE_API_BASE
    || (/(^|\.)eastside\.study$/.test(location.hostname)
        ? 'https://api.eastside.study'
        : 'https://api.xn--80aikf2bag.xn--p1ai');
  var KEY_LS = 'eastside_crm_key';
  var SEEN_LS = 'eastside_crm_seen';
  var DC_PREF = 'eastside_crm_d_';
  var UI_LS = 'eastside_crm_ui3';
  var root = document.getElementById('root');
  var mqMobile = window.matchMedia('(max-width:960px)');

  var state = {
    role: 'owner', userName: '', loaded: false,
    leads: [], page: 'dash', seg: 'queue', viewMode: 'table',
    q: '', sort: null, filters: { funnel: '', period: '' }, quick: '',
    dashPeriod: '', dashFrom: '', dashTo: '',
    pathSel: null, pathPeriod: '',
    finPeriod: '', finance: null, finLoading: false,
    dialogs: {}, dialogAi: {}, dialogSeen: {}, inboxCh: '',
    inboxMode: 'bot',   // 'bot' — переписки из бота, 'threads' — обсуждения по задачам (одна страница, тумблер сверху)
    drafts: {},         // черновики композера по диалогам — живут в state, а не в DOM (см. composerSave)
    composer: { id: null, focus: false, caret: 0 },
    bot: { loaded: false, source: 'demo', list: null, msgs: {} }, botConvoId: null, botStats: null,
    drawerId: null, drawerList: [], modalSection: 'now',
    details: {}, inflight: {}, seenBefore: 0, updatedAt: null, timer: null,
    planStatus: {}, _templates: null, _tplEdit: null, _tplDraft: null,
    planChat: null,   // id лида, у которого открыт чат правок плана
    showBlank: false, // показывать ли пустые заходы (см. isBlankVisit) — по умолчанию свернуты
  };
  try {
    var savedUi = JSON.parse(localStorage.getItem(UI_LS) || '{}');
    ['page', 'seg', 'viewMode', 'dashPeriod', 'dashFrom', 'dashTo'].forEach(function (k) { if (savedUi[k]) state[k] = savedUi[k]; });
    if (savedUi.filters) state.filters = { funnel: savedUi.filters.funnel || '', period: savedUi.filters.period || '' };
  } catch (e) {}
  function saveUi() {
    try {
      localStorage.setItem(UI_LS, JSON.stringify({
        page: state.page, seg: state.seg, viewMode: state.viewMode, filters: state.filters,
        dashPeriod: state.dashPeriod, dashFrom: state.dashFrom, dashTo: state.dashTo,
      }));
    } catch (e) {}
  }

  /* ── словари ──────────────────────────────────────────── */
  var CRM = {
    new:            { label: 'новый',          order: 0, dot: '#AEB4C0' },
    contacted:      { label: 'связались',       order: 1, dot: '#EE9B33' },
    call_scheduled: { label: 'созвон назначен', order: 2, dot: '#2F6BFF' },
    call_done:      { label: 'разбор проведен', order: 3, dot: '#1C2B4A' },
    offer_sent:     { label: 'предложение',     order: 4, dot: '#EE9B33' },
    client:         { label: 'клиент',          order: 5, dot: '#1FA85C' },
    rejected:       { label: 'отказ',           order: 6, dot: '#A2A7B2' },
  };
  var ACTIVE_STATUSES = ['new', 'contacted', 'call_scheduled', 'call_done', 'offer_sent'];
  var SEGS = {
    queue:    { label: 'В работе',      hint: 'заявки в работе — от горячих к спокойным' },
    all:      { label: 'Пользователи',  hint: 'все, кто был на платформе — это ещё не клиенты' },
    clients:  { label: 'Клиенты',       hint: 'только те, кто оплатил — действующие клиенты' },
    rejected: { label: 'Отказы',        hint: 'не сложилось — но контакт остался' },
    archive:  { label: 'Архив',         hint: 'скрытые лиды и тестовые записи — можно вернуть' },
  };
  var FUNNEL = {
    booked: 'оставил заявку', diagnosed: 'прошел диагностику',
    submitted: 'заполнил анкету', visited: 'без анкеты',
    manual: 'добавлен вручную',
  };
  var EVENTS_RU = {
    anketa_started: 'начал анкету',
    anketa_step: 'шаг анкеты',
    questionnaire_submitted: 'отправил анкету',
    viewed_result: 'открыл результаты',
    clicked_book_call: 'нажал «записаться на разбор»',
    lead_submitted: 'оставил заявку на разбор',
    clicked_messenger: 'перешел в мессенджер',
    opened_product: 'открыл продукт',
    tg_nudge_sent: 'бот напомнил о записи',
    magnet_registered: 'забрал бесплатный мини-курс',
    magnet_progress: 'мини-курс: прогресс',
  };
  /* подпись события: словарь + уточнения из payload (одна на все ленты) */
  function evText(e) {
    var p = e.payload || {}, label = EVENTS_RU[e.type] || e.type;
    if (e.type === 'opened_product' && p.product) label += ': ' + p.product;
    if (e.type === 'clicked_messenger' && p.channel) label += ' (' + p.channel + ')';
    if (e.type === 'magnet_registered' && p.title) label += ' «' + p.title + '»';
    if (e.type === 'magnet_progress') {
      label = 'мини-курс: ' + (p.blocks_done || 0) + ' из ' + (p.blocks_total || 0) + ' блоков' +
        (p.quiz_total ? ', задания ' + (p.quiz_right || 0) + ' из ' + p.quiz_total : '');
    }
    return label;
  }
  var COMM_KINDS = { call: 'звонок', msg: 'написал', meet: 'встреча' };
  var UNI_TYPE = { dream: 'мечта', solid: 'надежный', safe: 'запасной' };
  var SNAPSHOT = [
    ['grade', 'Класс'], ['target_year', 'Год поступления'], ['program', 'Программа'],
    ['study_language', 'Язык учебы'], ['gpa', 'Средний балл'], ['english_level', 'Английский'],
    ['english_certificate', 'Сертификат'], ['chinese_level', 'Китайский'], ['hsk', 'HSK'],
  ];
  var ANKETA_STEP_NAMES = ['старт', 'цель', 'язык', 'оценки', 'англ.', 'кит.', 'о себе'];

  var FSTEPS = [
    { key: 'visited',   label: 'Зашли на платформу',    hint: 'создана сессия',          test: function () { return true; } },
    { key: 'submitted', label: 'Заполнили анкету',      hint: 'дошли до конца вопросов', test: function (l) { return l.status !== 'visited'; } },
    { key: 'diagnosed', label: 'Дождались диагностики', hint: 'AI отдал разбор',         test: function (l) { return l.status !== 'visited' && l.stages && l.stages.diagnostics === 'done'; } },
    { key: 'viewed',    label: 'Открыли разбор',        hint: 'увидели результат',       test: function (l) { return hasEv(l, 'viewed_result'); } },
    { key: 'cta',       label: 'Нажали «записаться»',   hint: 'клик по CTA',             test: function (l) { return hasEv(l, 'clicked_book_call') || hasEv(l, 'clicked_messenger'); } },
    { key: 'booked',    label: 'Оставили заявку',       hint: 'контакт + слот',          test: function (l) { return !!l.booking; } },
    { key: 'client',    label: 'Стали клиентами',       hint: 'статус в CRM',            test: function (l) { return !!l.paid; } },
  ];
  function hasEv(l, t) { return (l.events || []).indexOf(t) !== -1; }

  /* ── иконки ───────────────────────────────────────────── */
  function ic(name, size) {
    var P = {
      dash: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5"/>',
      leads: '<path d="M13 4.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/><path d="M3.5 16.5c0-3 2.9-5 6.5-5s6.5 2 6.5 5"/>',
      path: '<path d="M3 16.5c4.5 0 4-5.5 7-6.5s3.5-4.5 7-4.5"/><circle cx="3" cy="16.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="5.5" r="1.5" fill="currentColor" stroke="none"/>',
      csv: '<path d="M10 3v9M6 9l4 4 4-4"/><path d="M3.5 16.5h13"/>',
      exit: '<path d="M12 3.5H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h6"/><path d="M9 10h8M14.5 7l3 3-3 3"/>',
      refresh: '<path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6"/><path d="M16.5 2.5v3.5h-3.5"/>',
      go: '<path d="M7.5 5l5 5-5 5"/>',
      check: '<path d="M16 6l-8 8-4-4"/>',
      x: '<path d="M5 5l10 10M15 5L5 15"/>',
      alert: '<path d="M10 3.2 17.8 16.5a1 1 0 0 1-.9 1.5H3.1a1 1 0 0 1-.9-1.5L10 3.2z"/><path d="M10 8v3.6M10 14.3v.01"/>',
      phone: '<path d="M4.5 3.5h3l1.2 3.6-1.7 1.2a9.5 9.5 0 0 0 4.7 4.7l1.2-1.7 3.6 1.2v3a1.2 1.2 0 0 1-1.4 1.2A13.6 13.6 0 0 1 3.3 4.9a1.2 1.2 0 0 1 1.2-1.4z"/>',
      send: '<path d="M17 3L8.5 11.5"/><path d="M17 3l-5.5 14-3-6.5L2 7.5 17 3z"/>',
      cal: '<rect x="3" y="4.5" width="14" height="13" rx="2"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4"/>',
      spark: '<path d="M10 2l1.8 4.7L17 8.5l-4.6 2.1L10 16l-2.4-5.4L3 8.5l5.2-1.8L10 2z" fill="currentColor" stroke="none"/>',
      copy: '<rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
      kanban: '<rect x="3" y="3" width="4.2" height="14" rx="1.4"/><rect x="8.4" y="3" width="4.2" height="9" rx="1.4"/><rect x="13.8" y="3" width="4.2" height="6" rx="1.4"/>',
      rows: '<path d="M3 5.5h14M3 10h14M3 14.5h9"/>',
      pin: '<path d="M10 18s-6-5.5-6-9.5a6 6 0 0 1 12 0C16 12.5 10 18 10 18z"/><circle cx="10" cy="8.5" r="2"/>',
      pie: '<path d="M10 2.5a7.5 7.5 0 1 0 7.5 7.5H10V2.5z"/><path d="M13 2.9A7.5 7.5 0 0 1 17.1 7H13V2.9z"/>',
      bell: '<path d="M10 2.5a5 5 0 0 1 5 5c0 4 1.5 5 1.5 5h-13S5 11.5 5 7.5a5 5 0 0 1 5-5z"/><path d="M8.5 16a1.6 1.6 0 0 0 3 0"/>',
      task: '<rect x="3" y="3" width="14" height="14" rx="3"/><path d="M7 10.2l2.2 2.2L13.5 8"/>',
      note: '<path d="M5 3.5h7l3 3v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z"/><path d="M11.5 3.5V7h3.5M7 11h6M7 14h4"/>',
      doc: '<path d="M5.5 2.5h6l3 3V16a1.5 1.5 0 0 1-1.5 1.5h-7.5A1.5 1.5 0 0 1 4 16V4a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M11 2.5V6h3.5"/>',
      card: '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M2.5 8h15M5.5 12h3"/>',
      dl: '<path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/><path d="M4 15.5h12"/>',
      plus: '<path d="M10 4.5v11M4.5 10h11"/>',
      ext: '<path d="M7.5 4.5H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16.5h9A1.5 1.5 0 0 0 15.5 15v-2.5M11 4.5h5v5M16 4.5l-7 7"/>',
      filter: '<path d="M3 4.5h14l-5.5 6.5v4l-3 2v-6L3 4.5z"/>',
      flame: '<path d="M10 2.5c1 2.5 4.5 4 4.5 8a4.5 4.5 0 0 1-9 0c0-1.6.6-2.8 1.5-4 .3 1 .8 1.6 1.6 2 0-2.3.4-4.5 1.4-6z"/>',
      clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 6v4.4l2.8 1.6"/>',
      chart: '<path d="M3.5 16.5v-6M8 16.5V7M12.5 16.5v-3.5M17 16.5V4"/>',
      target: '<circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="3.5"/><circle cx="10" cy="10" r=".5" fill="currentColor"/>',
      coins: '<circle cx="7" cy="7" r="4"/><path d="M11 4.3a4 4 0 1 1 0 7.4"/><path d="M5.5 7h3M7 5.5v3"/>',
      wallet: '<rect x="3" y="5" width="14" height="11" rx="2.5"/><path d="M3 8.5h14"/><circle cx="13.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/>',
      chat: '<path d="M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-3.5 3v-3h-1a2 2 0 0 1-2-2z" transform="translate(0 -.5)"/>',
      bot: '<rect x="4" y="7" width="12" height="9" rx="2.5"/><path d="M10 4v3M7.5 11h.01M12.5 11h.01"/><path d="M2.6 10v2M17.4 10v2"/>',
      bolt: '<path d="M11 2.5 4 11h4.5L9 17.5 16 9h-4.5L11 2.5z" fill="currentColor" stroke="none"/>',
      wa: '<path d="M10 3a7 7 0 0 0-6 10.6L3 17l3.5-1A7 7 0 1 0 10 3z"/><path d="M7.5 7.5c0 3 2 5 5 5"/>',
      vk: '<rect x="3" y="4" width="14" height="12" rx="3"/><path d="M6.5 8c.3 2.2 1.6 3.6 3 3.6V8M9.5 9.8c1-.2 1.7-1 2-1.8M11.5 11.6c-.3-.9-1-1.6-2-1.8"/>',
      max: '<rect x="3" y="4" width="14" height="12" rx="3.5"/><path d="M7 12.3V7.9l3 3 3-3v4.4"/>',
      hand: '<path d="M7 9V4.5a1.3 1.3 0 0 1 2.6 0V9M9.6 9V3.7a1.3 1.3 0 0 1 2.6 0V9M12.2 9V5.2a1.3 1.3 0 0 1 2.6 0V12a5 5 0 0 1-5 5h-1a4 4 0 0 1-3-1.4L4 13s-.8-1 .2-1.8 2 .3 2 .3L7 13"/>',
      funnel: '<path d="M3.5 5h13l-5 6v4.5l-3 1.5V11L3.5 5z"/>',
      dialogs: '<path d="M2.5 6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H6l-3.5 2.5V6z"/><path d="M9 11v.5a2 2 0 0 0 2 2h3.5l3 2.2V10a2 2 0 0 0-2-2h-1"/>',
      cap: '<path d="M10 4 18 7.5 10 11 2 7.5 10 4z"/><path d="M5.5 9v4c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V9"/>',
      box: '<path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5z"/><path d="M3.5 6.5 10 10l6.5-3.5M10 10v7"/>',
      award: '<circle cx="10" cy="8" r="4.5"/><path d="M7.5 11.8 6.5 17l3.5-2 3.5 2-1-5.2"/>',
      mega: '<path d="M4 8.5 14 4.5v9L4 11.5z"/><path d="M4 8.5H3a1.5 1.5 0 0 0 0 4.5h1M6.5 12.5l1 3.5"/>',
      handshake: '<path d="M10 6 7.5 4.5 3 7v5l2 1.5M10 6l2.5-1.5L17 7v5l-2 1.5"/><path d="M10 6 7.5 8.5a1.3 1.3 0 0 0 1.8 1.8L10.5 9l2 2a1.3 1.3 0 0 0 1.8-1.8L13 8"/>',
      team: '<circle cx="7" cy="7.5" r="2.5"/><path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/><path d="M13 5.5a2.3 2.3 0 0 1 0 4.4M14.5 15.5c0-1.6-.6-2.9-1.6-3.6"/>',
      more: '<circle cx="4.5" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.5" fill="currentColor" stroke="none"/>',
      image: '<rect x="3" y="4" width="14" height="12" rx="2.5"/><circle cx="7.3" cy="8.3" r="1.4"/><path d="M3.5 13.5l3.5-3 2.5 2.2 3-2.7 4 3.5"/>',
      clip: '<path d="M14.5 7.5l-5.8 5.8a2.4 2.4 0 0 1-3.4-3.4l6.3-6.3a3.6 3.6 0 0 1 5.1 5.1l-6.3 6.3a4.8 4.8 0 0 1-6.8-6.8"/>',
      badge: '<rect x="2.5" y="4.5" width="15" height="11.5" rx="2.5"/><circle cx="7" cy="9" r="1.7"/><path d="M4.4 13.4c.3-1.3 1.3-2 2.6-2s2.3.7 2.6 2"/><path d="M12.2 8.6h3.3M12.2 11.6h2.3"/>',
      shield: '<path d="M10 2.6 16 5v4.6c0 3.6-2.4 6.2-6 7.8-3.6-1.6-6-4.2-6-7.8V5l6-2.4z"/><path d="M7.4 9.9 9.3 12l3.4-3.7"/>',
      search: '<circle cx="9" cy="9" r="5.6"/><path d="M13.2 13.2 17 17"/>',
      globe: '<circle cx="10" cy="10" r="7.5"/><path d="M2.8 7.8h14.4M2.8 12.2h14.4"/><path d="M10 2.5c-2 2.2-3 4.7-3 7.5s1 5.3 3 7.5c2-2.2 3-4.7 3-7.5s-1-5.3-3-7.5z"/>',
      play: '<circle cx="10" cy="10" r="7.5"/><path d="M8.4 7.2 13 10l-4.6 2.8V7.2z" fill="currentColor" stroke-width="1"/>',
    };
    var s = size || 18;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
  }

  /* ── helpers ──────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* лёгкий markdown для пузырей чата: бот отвечает с **жирным**, списками и переносами —
     рендерим их, а не показываем сырой текст. Сначала экранируем HTML, потом размечаем. */
  function mdMsg(s) {
    var t = esc(s);
    t = t.replace(/```([\s\S]*?)```/g, function (m, c) { return '<pre>' + c.replace(/^\n/, '') + '</pre>'; });
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<i>$2</i>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, '<b>$1</b>');
    t = t.replace(/^\s{0,3}[-*]\s+(.+)$/gm, '<span class="li">• $1</span>');
    t = t.replace(/\n/g, '<br>');
    return t;
  }
  function el(id) { return document.getElementById(id); }
  function getKey() {
    var m = location.search.match(/[?&]k=([^&]+)/);
    if (m) { localStorage.setItem(KEY_LS, decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + location.hash); }
    return localStorage.getItem(KEY_LS) || '';
  }
  function pad(n) { return ('0' + n).slice(-2); }
  function fmtWhen(iso) {
    if (!iso) return '—';
    var d = new Date(iso), now = new Date();
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    var day = new Date(d); day.setHours(0, 0, 0, 0);
    var today = new Date(now); today.setHours(0, 0, 0, 0);
    var diff = Math.round((today - day) / 86400000);
    if (diff === 0) return 'сегодня ' + hm;
    if (diff === 1) return 'вчера ' + hm;
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + hm;
  }
  function fmtTime(iso) { if (!iso) return ''; var d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  var MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function dayLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Вчера';
    return d.getDate() + ' ' + MONTHS_RU[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  /* Полная дата словами: «10 ноября 2026». Для сроков, до которых далеко, где
     «10.11» без года читается двусмысленно. */
  function dayFull(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS_RU[d.getMonth()] + ' ' + d.getFullYear();
  }
  function ago(iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' мин';
    if (s < 86400) return Math.round(s / 3600) + ' ч';
    return Math.round(s / 86400) + ' дн';
  }
  function hoursSince(iso) { return iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : 0; }
  function isToday(iso) {
    if (!iso) return false;
    var d = new Date(iso), n = new Date();
    return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  }
  function todayISO(plusDays) {
    var d = new Date(); d.setDate(d.getDate() + (plusDays || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fmtDue(due) {
    if (!due) return '';
    var t = todayISO(0), tm = todayISO(1);
    if (due === t) return 'сегодня';
    if (due === tm) return 'завтра';
    if (due < t) return 'просрочено · ' + due.slice(8, 10) + '.' + due.slice(5, 7);
    return due.slice(8, 10) + '.' + due.slice(5, 7);
  }
  function scoreTone(s) {
    if (s >= 70) return { c: '#2F6BFF', label: 'сильный профиль' };
    if (s >= 52) return { c: '#E0922F', label: 'реалистично с подготовкой' };
    return { c: '#E5484D', label: 'нужно усилить профиль' };
  }
  function fmtVal(v) {
    if (v === true) return 'Да';
    if (v === false) return 'Нет';
    if (Array.isArray(v)) return v.filter(function (x) { return x !== '' && x != null; }).join(', ');
    return v;
  }
  function contactAction(contact) {
    if (!contact) return null;
    // составной контакт («@user, +79990001122») — берём первый рабочий токен
    var raw = String(contact).trim();
    var cands = raw.split(/[,;·|]|\s\/\s|\s{2,}/).map(function (t) { return t.trim(); }).filter(Boolean);
    cands = cands.concat(raw.split(/\s+/));
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (/^@[\w\d_]{2,}$/.test(c)) return { href: 'https://t.me/' + c.slice(1), label: 'Написать в Telegram' };
      var digits = c.replace(/[\s\-()]/g, '');
      if (/^\+?\d{10,15}$/.test(digits)) return { href: 'tel:' + digits, label: 'Позвонить' };
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return { href: 'mailto:' + c, label: 'Написать письмо' };
    }
    return null;
  }
  function copyText(text, btn) {
    var done = function () {
      if (!btn) return;
      // подтверждение прямо в кнопке; иконочную кнопку не растягиваем текстом
      if (btn._cpHtml == null) btn._cpHtml = btn.innerHTML;
      btn.innerHTML = btn.textContent.trim() ? ic('check', 13) + 'Скопировано' : ic('check', 13);
      clearTimeout(btn._cpT);
      btn._cpT = setTimeout(function () { btn.innerHTML = btn._cpHtml; btn._cpHtml = null; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done();
    }
  }
  function findLead(id) {
    return state.leads.filter(function (l) { return l.id === id; })[0] || null;
  }
  /* ── прямая ссылка на карточку клиента ─────────────────────
     Адрес вида crm.истсайд.рф/#lead/<id>: кто из команды откроет его (уже войдя
     в CRM), сразу попадёт в карточку этого клиента. Копируем ВСЕГДА боевой адрес,
     а не адрес текущего окна: из превью ветки уехала бы временная ссылка с именем
     оператора внутри. Домен кириллицей — punycode в переписке нечитаем. */
  var CRM_HOME = 'https://crm.истсайд.рф/';
  function leadUrl(id) {
    return CRM_HOME + '#lead/' + encodeURIComponent(id);
  }
  function hashLeadId() { return hashRouteId('lead'); }
  /* Тот же приём для переписки: `#dialog/<id>` открывает конкретный диалог инбокса.
     На эту ссылку ведёт уведомление бота в Telegram («клиенту нужен менеджер») —
     из пуша попадаешь сразу в разговор, а не в общий список. */
  function dialogUrl(id) { return CRM_HOME + '#dialog/' + encodeURIComponent(id); }
  function hashDialogId() { return hashRouteId('dialog'); }
  /* id из адреса: #lead/<id> или #dialog/<id>. Имя намеренно не hashId — так уже зовётся
     хэш-функция строки ниже по файлу, и одноимённое объявление её перетирало. */
  function hashRouteId(kind) {
    var m = String(location.hash || '').match(new RegExp('^#' + kind + '\\/(.+)$'));
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  /* адрес в строке браузера всегда показывает открытую карточку (или диалог) — ссылку
     можно скопировать и оттуда; replaceState, чтобы не засорять историю «назад» */
  function syncHash(id, kind) {
    kind = kind || 'lead';
    try {
      if (hashRouteId(kind) === (id || '')) return;
      history.replaceState(null, '', id ? '#' + kind + '/' + encodeURIComponent(id)
                                        : location.pathname + location.search);
    } catch (e) {}
  }
  function isNewLead(l) {
    return state.seenBefore && l.created_at && new Date(l.created_at).getTime() > state.seenBefore;
  }
  /* Имени нет — подписываем тем, что человек успел сделать: заявку без имени менеджер
     откроет и разберет, а пустой заход трогать незачем. Голое «Без имени» на обоих
     не отличало заявку от случайного посетителя. */
  function leadName(l) {
    if (l.name) return l.name;
    return l.status === 'visited' ? 'Заход без анкеты' : 'Заявка без имени';
  }
  /* Пустой заход: человек открыл платформу и ушел, не оставив о себе ничего.
     Это не лид, а строка статистики — в «Людях» такие свернуты (см. blankFoot),
     в разделе «Путь» они считаются как раньше, первой ступенью воронки. */
  function isBlankVisit(l) {
    return l.status === 'visited' && !l.name && !l.email && !l.paid &&
      !(l.booking || {}).contact && !(l.events || []).length &&
      !l.crm.note && !(l.crm.tasks || []).length && l.crm.status === 'new';
  }
  /* override-поля менеджера поверх данных анкеты/booking */
  function ov(ctx, field) {
    var o = (ctx.crm && (ctx.crm._ov || ctx.crm.overrides)) || {};
    if (o[field] != null && o[field] !== '') return o[field];
    var base = ctx.base || {}, booking = base.booking || {};
    if (field === 'name') return base.name || '';
    if (field === 'contact') return booking.contact || '';
    if (field === 'email') return base.email || '';
    if (field === 'city') return (base.geo && base.geo.city) || '';
    return '';
  }
  /* инлайн-эдит: превращает .ef-v / .m-name в инпут, автосейв по blur/Enter */
  function bindInline(node, field, opts) {
    opts = opts || {};
    if (!node) return;
    var id = state.drawerId;
    node.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a, .ef-copy')) return;
      if (node.querySelector('.ed-input')) return;
      var cur = node.getAttribute('data-raw') || '';
      node.dataset.html = node.innerHTML;
      var inp = document.createElement('input');
      inp.className = 'ed-input' + (opts.big ? ' big' : '');
      inp.value = cur; inp.placeholder = opts.ph || '';
      node.innerHTML = ''; node.appendChild(inp); inp.focus(); inp.select();
      var saved = false;
      function commit() {
        if (saved) return; saved = true;
        var val = inp.value.trim();
        if (val !== cur) {
          var body = {}; body[field] = val;
          patch(id, body, null, function () {
            if (state.drawerId === id) renderDrawer(true);
          });
        } else { node.innerHTML = node.dataset.html; }
      }
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
        if (ev.key === 'Escape') { saved = true; node.innerHTML = node.dataset.html; }
      });
      inp.addEventListener('blur', commit);
    });
  }
  function initials(name) {
    if (!name) return 'ES';
    var p = String(name).trim().split(/\s+/);
    return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || (p[0] || '')[1] || '');
  }
  function notifOn() {
    return ('Notification' in window) && Notification.permission === 'granted' &&
      localStorage.getItem('eastside_crm_notif') === '1';
  }
  function animBars(host) {
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('[data-aw]'), function (b) {
      var w = b.getAttribute('data-aw');
      requestAnimationFrame(function () { requestAnimationFrame(function () { b.style.width = w; }); });
    });
  }

  /* ── кэш деталей ──────────────────────────────────────── */
  function cacheGet(id) {
    try {
      var raw = localStorage.getItem(DC_PREF + id);
      return raw ? (JSON.parse(raw).d || null) : null;
    } catch (e) { return null; }
  }
  function cacheSet(id, d) {
    try { localStorage.setItem(DC_PREF + id, JSON.stringify({ t: Date.now(), d: d })); trimCache(); } catch (e) {}
  }
  function trimCache() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(DC_PREF) === 0) keys.push(k);
    }
    if (keys.length <= 30) return;
    keys.map(function (k) {
      var t = 0;
      try { t = (JSON.parse(localStorage.getItem(k)) || {}).t || 0; } catch (e) {}
      return { k: k, t: t };
    }).sort(function (a, b) { return a.t - b.t; })
      .slice(0, keys.length - 30)
      .forEach(function (o) { localStorage.removeItem(o.k); });
  }

  /* ── api ──────────────────────────────────────────────── */
  function api(path, opts) {
    opts = opts || {};
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    return fetch(API + path + sep + 'k=' + encodeURIComponent(getKey()), opts).then(function (r) {
      /* 403 бывает двух видов, и путать их нельзя: «токен не годится» — это выход
         на экран входа, а «этой роли сюда нельзя» (detail «no access: ...») — просто
         отказ в действии. Раньше второй случай стирал ключ и выбрасывал человека из
         CRM посреди работы. */
      if (r.status === 403) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (String((j && j.detail) || '').indexOf('no access') === 0) throw new Error('403acl');
          localStorage.removeItem(KEY_LS); renderLogin('Сессия истекла — войди заново');
          throw new Error('403');
        });
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function fetchDetail(id, cb) {
    if (state.details[id]) { if (cb) cb(state.details[id]); return; }
    if (state.inflight[id]) { if (cb) state.inflight[id].push(cb); return; }
    state.inflight[id] = cb ? [cb] : [];
    api('/admin/api/leads/' + id).then(function (d) {
      state.details[id] = d;
      cacheSet(id, d);
      var cbs = state.inflight[id] || []; delete state.inflight[id];
      cbs.forEach(function (f) { f(d); });
    }).catch(function (e) {
      var cbs = state.inflight[id] || []; delete state.inflight[id];
      if (e.message !== '403') cbs.forEach(function (f) { f(null); });
    });
  }
  function warm(id) {
    if (state.details[id] || state.inflight[id]) return;
    var cached = cacheGet(id);
    if (cached) { state.details[id] = cached; return; }
    fetchDetail(id);
  }
  /* сбросить кэш детали и перезагрузить (после правки документов/оплат) */
  function refreshDetail(id, cb) {
    delete state.details[id];
    try { localStorage.removeItem(DC_PREF + id); } catch (e) {}
    fetchDetail(id, cb);
  }
  /* onErr(code) — когда вызвавшему есть что сказать про конкретный отказ (занятый
     логин, недостаточно прав). Без него ошибка гасится общим тостом, как раньше. */
  function apiSend(path, method, body, cb, onErr) {
    api(path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { if (cb) cb(r); }).catch(function (e) {
      if (onErr) return onErr(parseInt(String(e.message).replace(/\D+/g, ''), 10) || 0);
      if (e.message === '403acl') return showToast('Нет доступа — это может только владелец');
      if (e.message !== '403') showToast('Не сохранилось — проверь сеть');
    });
  }
  /* НОН-БЛОКИНГ: меняем локально и рисуем сразу, бэкенд синхроним в фоне.
     При ошибке — откат + тост. Никаких ожиданий ответа ради анимации. */
  var CRM_PATCH_FIELDS = ['status', 'note', 'tasks', 'comms', 'overrides'];
  function patch(id, body, stateEl, cb) {
    var lead = findLead(id), det = state.details[id];
    var prevLead = lead ? lead.crm : null;
    var prevDet = det ? det.crm : null;
    function merge(crm) {
      if (!crm) return crm;
      var n = Object.assign({}, crm);
      CRM_PATCH_FIELDS.forEach(function (k) { if (body[k] !== undefined) n[k] = body[k]; });
      return n;
    }
    // 1) применяем локально + мгновенно перерисовываем
    if (lead) lead.crm = merge(lead.crm);
    if (det) { det.crm = merge(det.crm); cacheSet(id, det); }
    renderSide();
    if (body.status || body.tasks || body.comms) {
      var sy = window.pageYOffset, mc = el('m-content'), msc = mc ? mc.scrollTop : 0;
      if (state.page !== 'dash') renderView();
      if (state.drawerId === id) renderDrawer(true);
      window.scrollTo(0, sy);
      var mc2 = el('m-content'); if (mc2) mc2.scrollTop = msc;  // не прыгаем внутри модалки
    }
    if (stateEl) stateEl.textContent = 'сохранено';
    // 2) фоновая синхронизация
    api('/admin/api/leads/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (res) {
      var l2 = findLead(id);
      if (l2) l2.crm = res.crm;
      if (state.details[id]) { state.details[id].crm = res.crm; cacheSet(id, state.details[id]); }
      if (stateEl) setTimeout(function () { if (stateEl) stateEl.textContent = ''; }, 1400);
      if (cb) cb(res.crm);
    }).catch(function (e) {
      if (e.message === '403') return;
      if (lead) lead.crm = prevLead;
      if (det) { det.crm = prevDet; cacheSet(id, det); }
      if (stateEl) stateEl.textContent = 'не сохранилось';
      showToast('Не сохранилось — проверь сеть');
      renderSide();
      if (state.page !== 'dash') renderView();
      if (state.drawerId === id) renderDrawer(true);
    });
  }

  /* ── производные ──────────────────────────────────────── */
  function inQueue(l) { return (!!l.booking || l.status === 'manual') && ACTIVE_STATUSES.indexOf(l.crm.status) !== -1; }
  function segBase(seg) {
    return state.leads.filter(function (l) {
      if (seg === 'queue') return inQueue(l);
      if (seg === 'clients') return !!l.paid;
      if (seg === 'rejected') return l.crm.status === 'rejected';
      return true;
    });
  }
  var PERIODS = { today: 1, week: 7, month: 30 };
  function inPeriod(l, period) {
    if (!period) return true;
    if (period === 'custom') {
      if (!l.created_at) return false;
      var t = new Date(l.created_at);
      if (state.dashFrom && t < new Date(state.dashFrom + 'T00:00:00')) return false;
      if (state.dashTo && t > new Date(state.dashTo + 'T23:59:59')) return false;
      return true;
    }
    var days = PERIODS[period] || 9999;
    var from = new Date(); from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (days - 1));
    return l.created_at && new Date(l.created_at) >= from;
  }
  /* быстрые срезы тулбара (quick chips) — предикаты поверх сегмента */
  var QUICK = {
    '':            { label: 'Все',              icon: 'rows' },
    hot:           { label: 'Горячие',          icon: 'flame', pred: function (l) { return l.booking && l.crm.status === 'new'; } },
    scheduled:     { label: 'Назначен созвон',  icon: 'cal',   pred: function (l) { return l.crm.status === 'call_scheduled'; } },
    nocontact:     { label: 'Без контакта',     icon: 'phone', pred: function (l) { return !((l.booking || {}).contact); } },
    tasks:         { label: 'С задачами',       icon: 'task',  pred: function (l) { return (l.crm.tasks || []).some(function (t) { return !t.done; }); } },
    attention:     { label: 'Внимание',         icon: 'flame', pred: function (l) { return leadRisks(l).length; } },
  };
  function quickPred() {
    var q = QUICK[state.quick];
    return (q && q.pred) ? q.pred : function () { return true; };
  }
  function segLeads(seg) {
    var qp = quickPred();
    var arr = segBase(seg).filter(function (l) {
      if (!state.showBlank && isBlankVisit(l)) return false;
      if (state.filters.funnel && l.status !== state.filters.funnel) return false;
      if (!inPeriod(l, state.filters.period)) return false;
      if (!qp(l)) return false;
      return true;
    });
    if (state.sort) {
      var s = state.sort;
      arr.sort(function (a, b) {
        var av, bv;
        if (s.col === 'score') { av = a.score == null ? -1 : a.score; bv = b.score == null ? -1 : b.score; }
        else if (s.col === 'name') {
          av = (a.name || 'яяя').toLowerCase(); bv = (b.name || 'яяя').toLowerCase();
          return av.localeCompare(bv, 'ru') * s.dir;
        }
        else if (s.col === 'crm') { av = CRM[a.crm.status].order; bv = CRM[b.crm.status].order; }
        else { av = new Date(a.created_at || 0).getTime(); bv = new Date(b.created_at || 0).getTime(); }
        return (av - bv) * s.dir;
      });
    } else if (seg === 'queue') {
      arr.sort(function (a, b) {
        var d = CRM[a.crm.status].order - CRM[b.crm.status].order;
        if (d) return d;
        return new Date(b.created_at) - new Date(a.created_at);
      });
    }
    if (state.q) {
      arr = arr.filter(function (l) {
        var dirs = Array.isArray(l.directions) ? l.directions.join(' ') : (l.directions || '');
        var hay = ((l.name || '') + ' ' + (l.email || '') + ' ' + ((l.booking || {}).contact || '') + ' ' +
          (l.crm.note || '') + ' ' + dirs + ' ' + (l.grade || '')).toLowerCase();
        return hay.indexOf(state.q) !== -1;
      });
    }
    return arr;
  }
  function counts() {
    /* «Пользователи» считаются по тому же правилу, что и список: свернутые пустые
       заходы в цифру на вкладке не входят, иначе счетчик спорил бы со строками. */
    var c = { queue: 0, all: 0, clients: 0, rejected: 0, hot: 0, week: 0, today: 0,
              anketa: 0, booked: 0, blank: 0 };
    var weekAgo = Date.now() - 7 * 86400000;
    state.leads.forEach(function (l) {
      if (isBlankVisit(l)) { c.blank++; if (!state.showBlank) return; }
      c.all++;
      if (inQueue(l)) c.queue++;
      if (l.booking && l.crm.status === 'new') c.hot++;
      if (!!l.paid) c.clients++;
      if (l.crm.status === 'rejected') c.rejected++;
      if (l.created_at && new Date(l.created_at) > weekAgo) c.week++;
      if (isToday(l.created_at)) c.today++;
      if (l.status !== 'visited') c.anketa++;
      if (l.booking) c.booked++;
    });
    return c;
  }
  /* period-aware счётчики для дашборда; period: '' | today | week | month */
  function dashCounts(period) {
    var base = period ? state.leads.filter(function (l) { return inPeriod(l, period); }) : state.leads;
    var c = { all: base.length, today: 0, week: 0, clients: 0, rejected: 0, hot: 0,
              queue: 0, anketa: 0, booked: 0 };
    var weekAgo = Date.now() - 7 * 86400000;
    base.forEach(function (l) {
      if (inQueue(l)) c.queue++;
      if (l.booking && l.crm.status === 'new') c.hot++;
      if (!!l.paid) c.clients++;
      if (l.crm.status === 'rejected') c.rejected++;
      if (l.created_at && new Date(l.created_at) > weekAgo) c.week++;
      if (isToday(l.created_at)) c.today++;
      if (l.status !== 'visited') c.anketa++;
      if (l.booking) c.booked++;
    });
    return c;
  }
  var DPERIOD_LABEL = { '': 'за всё время', today: 'сегодня', week: 'за 7 дней', month: 'за 30 дней' };
  function leadRisks(l) {
    var out = [];
    var st = l.crm.status;
    var ref = l.crm.updated_at || (l.booking && l.booking.at) || l.created_at;
    if (l.booking && st === 'new' && hoursSince(l.booking.at || l.created_at) > 24) {
      out.push({ sev: 2, label: 'заявка ждет связи ' + ago(l.booking.at || l.created_at) });
    }
    if (st === 'contacted' && hoursSince(ref) > 72) out.push({ sev: 1, label: 'связались, но нет следующего шага ' + ago(ref) });
    if (st === 'call_scheduled' && hoursSince(ref) > 72) out.push({ sev: 1, label: 'созвон назначен ' + ago(ref) + ' назад — нет результата' });
    if (st === 'offer_sent' && hoursSince(ref) > 120) out.push({ sev: 1, label: 'предложение без ответа ' + ago(ref) });
    (l.crm.tasks || []).forEach(function (t) {
      if (!t.done && t.due && t.due < todayISO(0)) out.push({ sev: 2, label: 'просрочена задача: ' + t.text });
    });
    return out;
  }
  function allRisks() {
    var out = [];
    state.leads.forEach(function (l) {
      leadRisks(l).forEach(function (r) { out.push({ lead: l, sev: r.sev, label: r.label }); });
    });
    out.sort(function (a, b) { return b.sev - a.sev; });
    return out;
  }
  function dueTasks() {
    var out = [], t = todayISO(0);
    state.leads.forEach(function (l) {
      (l.crm.tasks || []).forEach(function (task) {
        if (!task.done && task.due && task.due <= t) out.push({ lead: l, task: task });
      });
    });
    return out;
  }
  /* задачи для дашборда: просроченные / сегодня / ближайшие 7 дней */
  function groupTasks() {
    var t = todayISO(0), in7 = todayISO(7);
    var over = [], today = [], soon = [];
    state.leads.forEach(function (l) {
      (l.crm.tasks || []).forEach(function (task) {
        if (task.done || !task.due) return;
        if (task.due < t) over.push({ lead: l, task: task });
        else if (task.due === t) today.push({ lead: l, task: task });
        else if (task.due <= in7) soon.push({ lead: l, task: task });
      });
    });
    var byDue = function (a, b) { return a.task.due < b.task.due ? -1 : a.task.due > b.task.due ? 1 : 0; };
    over.sort(byDue); today.sort(byDue); soon.sort(byDue);
    return { over: over, today: today, soon: soon, total: over.length + today.length + soon.length };
  }
  function funnelData(period) {
    var base = state.leads.filter(function (l) { return inPeriod(l, period); });
    var steps = FSTEPS.map(function (s) { return { key: s.key, label: s.label, hint: s.hint, n: 0, dropped: [] }; });
    base.forEach(function (l) {
      var reachedPrev = true;
      for (var i = 0; i < FSTEPS.length; i++) {
        var ok = FSTEPS[i].test(l);
        if (ok) steps[i].n++;
        if (reachedPrev && !ok) steps[i].dropped.push(l);
        if (!ok) reachedPrev = false;
      }
    });
    return steps;
  }
  function worstStep(steps) {
    var worst = null;
    for (var i = 1; i < steps.length - 1; i++) {
      var prev = steps[i - 1].n;
      if (!prev) continue;
      var dropPct = steps[i].dropped.length / prev;
      if (steps[i].dropped.length >= 2 && (!worst || dropPct > worst.pct)) {
        worst = { i: i, pct: dropPct, step: steps[i] };
      }
    }
    return worst;
  }

  /* статус-пилюля (sev) */
  function sevPill(l) {
    if (l.booking && l.crm.status === 'new') {
      return '<span class="sev s-hot">ждет связи</span>';
    }
    return '<span class="sev s-' + l.crm.status + '">' + CRM[l.crm.status].label + '</span>';
  }

  /* ── статус-меню ──────────────────────────────────────── */
  var smenu = null;
  function closeSmenu() {
    if (smenu) { smenu.remove(); smenu = null; }
    Array.prototype.forEach.call(document.querySelectorAll('.cdd.open, .profile.open'), function (b) { b.classList.remove('open'); });
  }
  function openSmenu(lead, anchor) {
    closeSmenu();
    smenu = document.createElement('div');
    smenu.id = 'smenu'; smenu.className = 'smenu-status';
    smenu.innerHTML = Object.keys(CRM).map(function (k) {
      return '<button data-s="' + k + '" class="' + (lead.crm.status === k ? 'cur' : '') + '">' +
        '<span class="sev s-' + k + '">' + CRM[k].label + '</span>' +
        '<span class="chk">' + ic('check', 14) + '</span></button>';
    }).join('');
    document.body.appendChild(smenu);
    var r = anchor.getBoundingClientRect();
    smenu.style.top = Math.min(r.bottom + 6, window.innerHeight - smenu.offsetHeight - 8) + 'px';
    smenu.style.left = Math.min(r.left, window.innerWidth - smenu.offsetWidth - 8) + 'px';
    Array.prototype.forEach.call(smenu.children, function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var s = b.getAttribute('data-s');
        closeSmenu();
        if (s !== lead.crm.status) patch(lead.id, { status: s });
      });
    });
  }

  /* ── «Еще» в мобильном таббаре: разделы, которые не влезли ── */
  function openMoreMenu(anchor, items, badgeOf) {
    closeSmenu();
    smenu = document.createElement('div');
    smenu.id = 'smenu'; smenu.className = 'profmenu mtmore';
    smenu.innerHTML = items.map(function (it) {
      var bd = badgeOf(it);
      return '<button data-p="' + it.id + '"' + (it.id === state.page ? ' class="cur"' : '') + '>' +
        ic(it.icon, 16) + '<span>' + esc(it.label) + '</span>' +
        (bd ? '<span class="bdg num">' + bd + '</span>' : '') + '</button>';
    }).join('');
    document.body.appendChild(smenu);
    var r = anchor.getBoundingClientRect();
    // меню встает НАД таббаром: он прижат к низу экрана, снизу места нет
    smenu.style.top = Math.max(8, r.top - smenu.offsetHeight - 8) + 'px';
    smenu.style.right = '10px'; smenu.style.left = 'auto';
    smenu.style.minWidth = '210px';
    Array.prototype.forEach.call(smenu.children, function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation(); var p = b.getAttribute('data-p'); closeSmenu(); setPage(p);
      });
    });
  }

  /* ── кастомный дропдаун (вместо нативного select) ─────── */
  function chev() {
    return '<svg class="cdd-ch" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8l4.5 4.5L14.5 8"/></svg>';
  }
  function ddButton(id, label, active) {
    return '<button class="cdd' + (active ? ' active' : '') + '" id="' + id + '"><span>' + esc(label) + '</span>' + chev() + '</button>';
  }
  function openDropdown(anchor, options, current, onPick) {
    closeSmenu();
    smenu = document.createElement('div');
    smenu.id = 'smenu'; smenu.className = 'ddmenu';
    smenu.innerHTML = options.map(function (o) {
      return '<button data-v="' + esc(o.v) + '" class="' + (o.v === current ? 'cur' : '') + '">' +
        (o.dot ? '<span class="dt" style="background:' + o.dot + '"></span>' : '') + esc(o.label) +
        (o.v === current ? ic('check', 13) : '') + '</button>';
    }).join('');
    document.body.appendChild(smenu);
    var r = anchor.getBoundingClientRect();
    smenu.style.minWidth = Math.max(r.width, 184) + 'px';
    smenu.style.top = Math.min(r.bottom + 6, window.innerHeight - smenu.offsetHeight - 8) + 'px';
    smenu.style.left = Math.min(r.left, window.innerWidth - smenu.offsetWidth - 8) + 'px';
    anchor.classList.add('open');
    Array.prototype.forEach.call(smenu.children, function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation(); var v = b.getAttribute('data-v'); closeSmenu(); onPick(v);
      });
    });
  }

  /* ── панель инструментов «Клиенты»: поиск + фильтры + срезы + вид ── */
  function leadsToolbar() {
    var funnelLabel = state.filters.funnel ? FUNNEL[state.filters.funnel] : 'Этап: все';
    var periodLabels = { '': 'За все время', today: 'Сегодня', week: '7 дней', month: '30 дней' };

    var segArr = segBase(state.seg).filter(function (l) {
      if (!state.showBlank && isBlankVisit(l)) return false;
      if (state.filters.funnel && l.status !== state.filters.funnel) return false;
      return inPeriod(l, state.filters.period);
    });
    var total = segArr.length;
    var shown = segLeads(state.seg).length;

    var order = ['', 'hot', 'scheduled', 'nocontact', 'tasks', 'attention'];
    var chips = order.map(function (k) {
      var q = QUICK[k];
      var n = q.pred ? segArr.filter(q.pred).length : total;
      if (k && !n) return '';
      var on = (state.quick || '') === k;
      return '<button class="qchip' + (k === 'hot' ? ' hot' : '') + (on ? ' on' : '') + '" data-q="' + k + '">' +
        ic(q.icon, 13) + q.label + '<span class="qn num">' + n + '</span></button>';
    }).join('');

    var countTxt = (shown === total)
      ? '<b>' + total + '</b> ' + plural(total, 'клиент', 'клиента', 'клиентов')
      : '<b>' + shown + '</b> из ' + total;

    return '<div class="list-tools">' +
        '<div class="searchwrap' + (state.q ? ' has-val' : '') + '">' + ic('leads', 15) +
          '<input id="search" class="search" type="search" placeholder="' + (mqMobile.matches ? 'Поиск клиента' : 'Имя, контакт, заметка, направление — клавиша /') + '" autocomplete="off">' +
          '<button class="s-clear" id="s-clear" title="Очистить">' + ic('x', 12) + '</button></div>' +
        (state.seg === 'all' ? ddButton('f-funnel', funnelLabel, !!state.filters.funnel) : '') +
        ddButton('f-period', periodLabels[state.filters.period] || 'За все время', !!state.filters.period) +
        '<span class="list-count num" id="list-count">' + countTxt + '</span>' +
        '<div class="vseg">' +
          '<button data-v="table" class="' + (state.viewMode === 'table' ? 'on' : '') + '" title="Таблица">' + ic('rows', 14) + '</button>' +
          '<button data-v="kanban" class="' + (state.viewMode === 'kanban' ? 'on' : '') + '" title="Канбан">' + ic('kanban', 14) + '</button>' +
        '</div>' +
        '<button class="bp sm lead-add" id="lead-add" title="Завести клиента вручную">' + ic('plus', 14) + '<span>Добавить</span></button>' +
      '</div>' +
      '<div class="list-quick">' + chips + '</div>';
  }
  function attachToolbarHandlers() {
    var search = el('search'), wrap = search && search.closest('.searchwrap');
    if (search) {
      search.value = state.q;
      search.addEventListener('input', function () {
        state.q = this.value.trim().toLowerCase();
        if (wrap) wrap.classList.toggle('has-val', !!this.value);
        rerenderListBody(); updateListCount();
      });
    }
    var clr = el('s-clear');
    if (clr) clr.addEventListener('click', function () {
      state.q = '';
      if (search) { search.value = ''; search.focus(); }
      if (wrap) wrap.classList.remove('has-val');
      rerenderListBody(); updateListCount();
    });
    var addb = el('lead-add');
    if (addb) addb.addEventListener('click', openAddLead);
    var ff = el('f-funnel');
    if (ff) ff.addEventListener('click', function (e) {
      e.stopPropagation();
      if (ff.classList.contains('open')) { closeSmenu(); ff.classList.remove('open'); return; }
      openDropdown(ff, [{ v: '', label: 'Этап: все' }].concat(Object.keys(FUNNEL).map(function (k) { return { v: k, label: FUNNEL[k] }; })),
        state.filters.funnel || '', function (v) { state.filters.funnel = v; saveUi(); renderView(); });
    });
    var fp = el('f-period');
    if (fp) fp.addEventListener('click', function (e) {
      e.stopPropagation();
      if (fp.classList.contains('open')) { closeSmenu(); fp.classList.remove('open'); return; }
      openDropdown(fp, [{ v: '', label: 'За все время' }, { v: 'today', label: 'Сегодня' }, { v: 'week', label: '7 дней' }, { v: 'month', label: '30 дней' }],
        state.filters.period || '', function (v) { state.filters.period = v; saveUi(); renderView(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.list-quick .qchip'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-q');
        state.quick = (state.quick || '') === k ? '' : k;
        renderView();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.list-tools .vseg button'), function (b) {
      b.addEventListener('click', function () { state.viewMode = b.getAttribute('data-v'); saveUi(); renderView(); });
    });
  }
  /* обновить счётчик результатов без пересборки тулбара (чтобы не терять фокус поиска) */
  function updateListCount() {
    var node = el('list-count');
    if (!node) return;
    var segArr = segBase(state.seg).filter(function (l) {
      if (!state.showBlank && isBlankVisit(l)) return false;
      if (state.filters.funnel && l.status !== state.filters.funnel) return false;
      return inPeriod(l, state.filters.period);
    });
    var total = segArr.length, shown = segLeads(state.seg).length;
    node.innerHTML = (shown === total)
      ? '<b>' + total + '</b> ' + plural(total, 'клиент', 'клиента', 'клиентов')
      : '<b>' + shown + '</b> из ' + total;
  }
  /* лёгкая перерисовка только тела списка (для поиска — без пересборки тулбара/фокуса) */
  function rerenderListBody() { renderListBody(); }

  /* ── ДОБАВИТЬ КЛИЕНТА ВРУЧНУЮ (без анкеты) ── */
  function openAddLead() {
    if (typeof closeSmenu === 'function') closeSmenu();
    if (document.querySelector('.al-ov')) return;
    var chOpts = [['', 'Канал не указан'], ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'],
      ['vk', 'VK'], ['phone', 'Телефон'], ['site', 'Сайт'], ['referral', 'Рекомендация'], ['other', 'Другое']];
    var stOpts = ACTIVE_STATUSES.concat(['client', 'rejected']).map(function (s) { return [s, CRM[s].label]; });
    var opt = function (o, sel) { return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; };
    var ov = document.createElement('div');
    ov.className = 'al-ov';
    ov.innerHTML =
      '<div class="al-card" role="dialog" aria-modal="true">' +
        '<div class="al-head">' +
          '<div><div class="al-eyebrow">CRM</div><div class="al-title">Новый клиент</div></div>' +
          '<button class="al-x" id="al-x" title="Закрыть">' + ic('x', 16) + '</button>' +
        '</div>' +
        '<div class="al-sub">Заводите клиента вручную — без анкеты. Карточку можно дозаполнить позже.</div>' +
        '<div class="al-body">' +
          '<label class="al-f"><span class="al-l">Имя <i>*</i></span>' +
            '<input id="al-name" class="al-in" placeholder="Как зовут клиента" autocomplete="off" maxlength="80"></label>' +
          '<label class="al-f"><span class="al-l">Контакт</span>' +
            '<input id="al-contact" class="al-in" placeholder="Телефон, телеграм или почта" autocomplete="off" maxlength="120"></label>' +
          '<div class="al-row">' +
            '<label class="al-f"><span class="al-l">Канал</span><span class="al-selwrap">' +
              '<select id="al-channel" class="al-sel">' + chOpts.map(function (o) { return opt(o, ''); }).join('') + '</select></span></label>' +
            '<label class="al-f"><span class="al-l">Статус</span><span class="al-selwrap">' +
              '<select id="al-status" class="al-sel">' + stOpts.map(function (o) { return opt(o, 'new'); }).join('') + '</select></span></label>' +
          '</div>' +
          '<label class="al-f"><span class="al-l">Заметка</span>' +
            '<textarea id="al-note" class="al-in al-ta" placeholder="Контекст: откуда пришел, что хочет, договоренности" rows="2" maxlength="500"></textarea></label>' +
        '</div>' +
        '<div class="al-foot">' +
          '<button class="al-cancel" id="al-cancel">Отмена</button>' +
          '<button class="bp al-save" id="al-save">' + ic('plus', 14) + 'Добавить клиента</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    var closed = false;
    var close = function () {
      if (closed) return; closed = true;
      ov.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 180);
    };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    el('al-x').addEventListener('click', close);
    el('al-cancel').addEventListener('click', close);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    var nameI = el('al-name'); if (nameI) setTimeout(function () { nameI.focus(); }, 30);
    var save = el('al-save');
    var submit = function () {
      var name = (el('al-name').value || '').trim();
      if (!name) { el('al-name').classList.add('al-err'); el('al-name').focus(); return; }
      save.disabled = true; save.classList.add('loading');
      createLead({
        name: name,
        contact: (el('al-contact').value || '').trim(),
        channel: el('al-channel').value || '',
        status: el('al-status').value || 'new',
        note: (el('al-note').value || '').trim(),
      }, function (ok) {
        if (ok) close();
        else { save.disabled = false; save.classList.remove('loading'); }
      });
    };
    save.addEventListener('click', submit);
    if (nameI) nameI.addEventListener('input', function () { nameI.classList.remove('al-err'); });
    ov.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); }
    });
  }

  /* ── КУДА МНЕ ПИСАТЬ (личные уведомления сотрудника) ──
     Раньше уведомления команды уходили в один чат владельца, и выбора у человека не
     было вовсе. Теперь мессенджер выбирает он сам, а бэкенд раскладывает по людям.
     Двухшаговость тут не лишняя, а честная: выбрать канал мало — мессенджер не даст
     боту написать первым, пока человек не нажал «Начать» у себя. Поэтому статус
     подключения виден всегда, и пока его нет, мы прямо говорим, что тишина. */
  var NOTIFY_CH = [
    { id: 'tg', label: 'Telegram', icon: 'send', bot: 'бот EastSide' },
    { id: 'max', label: 'Макс', icon: 'max', bot: 'бот «Истсайд команда»' },
    { id: 'off', label: 'Не беспокоить', icon: 'bell', bot: '' },
  ];

  function openNotifyPrefs() {
    if (typeof closeSmenu === 'function') closeSmenu();
    if (document.querySelector('.al-ov')) return;
    var ov = document.createElement('div');
    ov.className = 'al-ov';
    ov.innerHTML =
      '<div class="al-card" role="dialog" aria-modal="true">' +
        '<div class="al-head">' +
          '<div><div class="al-eyebrow">Уведомления</div><div class="al-title">Куда вам писать</div></div>' +
          '<button class="al-x" id="al-x" title="Закрыть">' + ic('x', 16) + '</button>' +
        '</div>' +
        '<div class="al-sub">Заявки на разбор, отмены записи, передача клиента живому ' +
          'человеку и напоминания приходят в один мессенджер — выберите свой.</div>' +
        '<div class="al-body" id="np-body">' +
          '<div class="np-skel shim"></div><div class="np-skel shim"></div>' +
        '</div>' +
        '<div class="al-foot"><button class="al-cancel" id="al-cancel">Закрыть</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    var closed = false;
    var close = function () {
      if (closed) return; closed = true;
      ov.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 180);
    };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    el('al-x').addEventListener('click', close);
    el('al-cancel').addEventListener('click', close);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });

    var body = el('np-body');
    var render = function (st) {
      var ch = (st && st.channel) || 'off';
      var linked = (st && st.linked) || {};
      var links = (st && st.links) || {};
      var cur = NOTIFY_CH.filter(function (c) { return c.id === ch; })[0] || NOTIFY_CH[2];
      var isOn = ch !== 'off';
      var ready = isOn && !!linked[ch];
      var link = isOn ? links[ch] : null;

      var state1 = !isOn
        ? '<div class="np-state"><span class="sev n-off">Выключено</span>' +
            '<div class="np-hint">Уведомления команды вам не приходят. Выберите мессенджер, ' +
            'чтобы получать заявки и передачи клиентов.</div></div>'
        : ready
          ? '<div class="np-state"><span class="sev n-ok">' + ic('check', 12) + 'Подключено</span>' +
              '<div class="np-hint">Всё готово — уведомления идут в ' + esc(cur.label) + '.</div></div>'
          : '<div class="np-state"><span class="sev n-wait">Нужен один шаг</span>' +
              '<div class="np-hint">Откройте ' + esc(cur.bot) + ' и нажмите «Начать». ' +
              'Пока вы этого не сделали, мессенджер не пропустит сообщение — ' +
              'так устроены и Telegram, и Макс.</div>' +
              (link
                ? '<div class="np-act"><a class="bp np-open" href="' + esc(link) + '" target="_blank" rel="noopener">' +
                    ic('ext', 14) + 'Открыть ' + esc(cur.label) + '</a>' +
                    '<button class="al-cancel np-copy" data-l="' + esc(link) + '">' + ic('copy', 13) + 'Скопировать ссылку</button></div>'
                : '<div class="np-hint">Ссылка появится, когда админ подключит бота ' + esc(cur.label) + '.</div>') +
            '</div>';

      /* За какие темы вам приходят уведомления — только на просмотр: закрепляет их
         руководитель в разделе «Команда». Иначе тему можно было бы снять с себя молча. */
      var tps = (st && st.topics) || [];
      var topics = '<div class="np-topics">' + (tps.length
        ? 'Вам приходят клиенты по темам: <b>' + tps.map(function (t) { return esc(t.label); }).join(', ') + '</b>.'
        : 'За вами не закреплена ни одна тема — уведомления о клиентах идут другим.') +
        ' Меняет руководитель в разделе «Команда».</div>';

      body.innerHTML =
        '<div class="al-f"><span class="al-l">Мессенджер</span>' +
          '<div class="dperiod np-seg">' + NOTIFY_CH.map(function (c) {
            return '<button data-ch="' + c.id + '"' + (c.id === ch ? ' class="on"' : '') + '>' +
              ic(c.icon, 13) + esc(c.label) + '</button>';
          }).join('') + '</div></div>' + state1 + topics;

      Array.prototype.forEach.call(body.querySelectorAll('[data-ch]'), function (b) {
        b.addEventListener('click', function () {
          var next = b.getAttribute('data-ch');
          if (next === ch) return;
          body.classList.add('np-wait');
          api('/admin/api/me/notify', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: next }),
          }).then(function (r) {
            body.classList.remove('np-wait');
            render(r);
            var nx = NOTIFY_CH.filter(function (c) { return c.id === next; })[0];
            showToast(next === 'off' ? 'Уведомления выключены' : 'Мессенджер: ' + nx.label);
          }).catch(function () {
            body.classList.remove('np-wait');
            showToast('Не удалось сохранить — попробуйте ещё раз');
          });
        });
      });
      var cp = body.querySelector('.np-copy');
      if (cp) cp.addEventListener('click', function () {
        var v = cp.getAttribute('data-l');
        if (navigator.clipboard) navigator.clipboard.writeText(v);
        showToast('Ссылка скопирована');
      });
    };

    api('/admin/api/me/notify').then(render).catch(function () {
      body.innerHTML = '<div class="np-hint">Не удалось открыть настройки. ' +
        'Если вы вошли по общей ссылке, зайдите под своим логином — уведомления личные.</div>';
    });
  }

  function createLead(payload, cb) {
    api('/admin/api/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      var id = res && res.id;
      showToast('Клиент добавлен: ' + payload.name);
      state.page = 'leads';
      if (state.seg === 'archive' || state.seg === 'rejected') state.seg = 'queue';
      state.q = ''; state.quick = '';
      loadLeads(true, function () { if (id) openDrawer(id, [id]); });
      if (cb) cb(true, id);
    }).catch(function (e) {
      if (e && e.message === '403') { if (cb) cb(false); return; }
      showToast('Не удалось добавить — проверьте сеть');
      if (cb) cb(false);
    });
  }

  /* ══ БАГ-ТРЕКЕР КОМАНДЫ ══════════════════════════════════════════════════
     Футер сайдбара → «Сообщить о баге». Одна панель: форма сабмита + общий
     список со сменой статуса. Бэкенд — /admin/api/bugs (миграция 041). */
  var BUG_KIND = {
    platform: { label: 'Платформа', icon: 'dash' },
    bot:      { label: 'Бот',       icon: 'bot' },
  };
  var BUG_SEV = {
    low:    { label: 'низкий',  dot: 'var(--ink-3)' },
    normal: { label: 'обычный', dot: 'var(--blue)' },
    high:   { label: 'срочный', dot: 'var(--red)' },
  };
  var BUG_ST = {
    new:     { label: 'новый',    tone: 'blue' },
    doing:   { label: 'в работе', tone: 'amber' },
    resolved:{ label: 'решен',    tone: 'green' },
    wontfix: { label: 'не баг',   tone: 'mute' },
  };
  var BUG_ST_ORDER = ['new', 'doing', 'resolved', 'wontfix'];
  var bugState = { open: false, view: 'report', kind: 'platform', sev: 'normal',
    filter: 'open', items: null, loading: false, count: null };

  function pageLabel() {
    for (var i = 0; i < NAV_ALL.length; i++) if (NAV_ALL[i].id === state.page) return NAV_ALL[i].label;
    return 'CRM';
  }

  /* тихий счётчик открытых багов на кнопке футера */
  function refreshBugCount() {
    api('/admin/api/bugs?status=new').then(function (r) {
      var open = (r && r.counts && r.counts.open) != null ? r.counts.open : ((r && r.items) ? r.items.length : 0);
      bugState.count = open;
      var b = el('side-bug-n');
      if (b) { b.textContent = open ? open : ''; b.style.display = open ? '' : 'none'; }
    }).catch(function () {});
  }

  function openBugPanel(view) {
    if (document.querySelector('.bug-ov')) return;
    bugState.open = true;
    bugState.view = view || 'report';
    bugState.items = null;
    var ov = document.createElement('div');
    ov.className = 'al-ov bug-ov';
    ov.innerHTML =
      '<div class="al-card bug-card" role="dialog" aria-modal="true">' +
        '<div class="bug-head">' +
          '<div class="bug-htxt"><div class="bug-title">Баги платформы и бота</div>' +
            '<div class="bug-sub">Заметили сбой — опишите. Команда видит список и берет в работу.</div></div>' +
          '<button class="al-x" id="bug-x" title="Закрыть">' + ic('x', 16) + '</button>' +
        '</div>' +
        '<div class="bug-tabs" id="bug-tabs"></div>' +
        '<div class="bug-body" id="bug-body"></div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    var closed = false;
    var close = function () {
      if (closed) return; closed = true; bugState.open = false;
      ov.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 180);
    };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    el('bug-x').addEventListener('click', close);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    bugState._close = close;
    paintBugTabs();
    paintBugBody();
    if (bugState.view === 'list') loadBugs();
  }

  function paintBugTabs() {
    var t = el('bug-tabs'); if (!t) return;
    var n = bugState.count;
    t.innerHTML =
      '<button class="bug-tab' + (bugState.view === 'report' ? ' on' : '') + '" data-v="report">' + ic('plus', 14) + 'Сообщить</button>' +
      '<button class="bug-tab' + (bugState.view === 'list' ? ' on' : '') + '" data-v="list">' + ic('rows', 14) + 'Все баги' +
        (n ? '<span class="bug-tab-n num">' + n + '</span>' : '') + '</button>';
    Array.prototype.forEach.call(t.children, function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-v');
        if (bugState.view === v) return;
        bugState.view = v; paintBugTabs(); paintBugBody();
        if (v === 'list') loadBugs();
      });
    });
  }

  function paintBugBody() {
    var host = el('bug-body'); if (!host) return;
    if (bugState.view === 'report') { host.innerHTML = bugReportHtml(); wireBugReport(host); return; }
    host.innerHTML = bugListHtml();
    wireBugList(host);
  }

  function bugReportHtml() {
    var kinds = Object.keys(BUG_KIND).map(function (kk) {
      return '<button class="bug-seg' + (bugState.kind === kk ? ' on' : '') + '" data-k="' + kk + '">' +
        ic(BUG_KIND[kk].icon, 15) + BUG_KIND[kk].label + '</button>';
    }).join('');
    var sevs = Object.keys(BUG_SEV).map(function (sk) {
      return '<button class="bug-sev' + (bugState.sev === sk ? ' on' : '') + '" data-s="' + sk + '">' +
        '<span class="bug-dot" style="background:' + BUG_SEV[sk].dot + '"></span>' + BUG_SEV[sk].label + '</button>';
    }).join('');
    return '<div class="bug-form">' +
      '<div class="bug-fld"><div class="bug-lab">Где баг</div><div class="bug-segs">' + kinds + '</div></div>' +
      '<div class="bug-fld"><div class="bug-lab">Что случилось</div>' +
        '<textarea id="bug-text" class="bug-ta" rows="4" maxlength="4000" ' +
          'placeholder="Что вы делали, что пошло не так, что ожидали увидеть. Чем конкретнее — тем быстрее починим."></textarea></div>' +
      '<div class="bug-row2">' +
        '<div class="bug-fld"><div class="bug-lab">Приоритет</div><div class="bug-segs">' + sevs + '</div></div>' +
        '<div class="bug-fld"><div class="bug-lab">Раздел</div>' +
          '<input id="bug-page" class="bug-in" maxlength="120" value="' + esc(pageLabel()) + '"></div>' +
      '</div>' +
      '<div class="bug-foot"><button class="bp bug-send" id="bug-send">' + ic('send', 14) + 'Отправить баг</button></div>' +
    '</div>';
  }

  function wireBugReport(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.bug-seg'), function (b) {
      b.addEventListener('click', function () { bugState.kind = b.getAttribute('data-k'); paintBugBody(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.bug-sev'), function (b) {
      b.addEventListener('click', function () { bugState.sev = b.getAttribute('data-s'); paintBugBody(); });
    });
    var ta = host.querySelector('#bug-text'); if (ta) setTimeout(function () { ta.focus(); }, 40);
    var send = host.querySelector('#bug-send');
    var submit = function () {
      var body = (ta.value || '').trim();
      if (!body) { ta.classList.add('bug-err'); ta.focus(); return; }
      send.disabled = true; send.classList.add('loading');
      api('/admin/api/bugs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: bugState.kind, severity: bugState.sev, body: body,
          page: (host.querySelector('#bug-page').value || '').trim() }),
      }).then(function () {
        showToast('Спасибо — баг записан, команда увидит');
        bugState.sev = 'normal'; bugState.items = null;
        bugState.view = 'list'; paintBugTabs(); paintBugBody(); loadBugs(); refreshBugCount();
      }).catch(function (e) {
        send.disabled = false; send.classList.remove('loading');
        if (e.message !== '403') showToast('Не отправилось — проверьте сеть');
      });
    };
    if (send) send.addEventListener('click', submit);
    if (ta) ta.addEventListener('input', function () { ta.classList.remove('bug-err'); });
  }

  function loadBugs() {
    bugState.loading = true;
    if (bugState.view === 'list') paintBugBody();
    api('/admin/api/bugs').then(function (r) {
      bugState.loading = false;
      bugState.items = (r && r.items) || [];
      if (r && r.counts) { bugState.count = r.counts.open != null ? r.counts.open : bugState.count; paintBugTabs(); }
      if (bugState.view === 'list') paintBugBody();
      var b = el('side-bug-n');
      if (b && bugState.count != null) { b.textContent = bugState.count ? bugState.count : ''; b.style.display = bugState.count ? '' : 'none'; }
    }).catch(function (e) {
      bugState.loading = false; bugState.items = 'err';
      if (bugState.view === 'list' && e.message !== '403') paintBugBody();
    });
  }

  function bugListHtml() {
    if (bugState.loading && bugState.items == null) {
      return '<div class="bug-list">' + '<div class="bug-sk"></div><div class="bug-sk"></div><div class="bug-sk"></div>'.replace(/bug-sk/g, 'bug-sk') + '</div>';
    }
    if (bugState.items === 'err') return '<div class="bug-empty">Не удалось загрузить список. Обновите позже.</div>';
    var all = bugState.items || [];
    var isOpen = function (b) { return b.status === 'new' || b.status === 'doing'; };
    var counts = { open: 0, resolved: 0 };
    all.forEach(function (b) { if (isOpen(b)) counts.open++; else counts.resolved++; });
    var filt = all.filter(function (b) {
      if (bugState.filter === 'open') return isOpen(b);
      if (bugState.filter === 'closed') return !isOpen(b);
      return true;
    });
    var chips = [['open', 'В работе', counts.open], ['closed', 'Закрытые', counts.resolved], ['all', 'Все', all.length]]
      .map(function (c) {
        return '<button class="bug-fchip' + (bugState.filter === c[0] ? ' on' : '') + '" data-f="' + c[0] + '">' +
          c[1] + '<span class="bug-fn num">' + c[2] + '</span></button>';
      }).join('');
    var rows = filt.length ? filt.map(bugRowHtml).join('')
      : '<div class="bug-empty">' + (bugState.filter === 'open' ? 'Открытых багов нет — чисто.' : 'Здесь пусто.') + '</div>';
    return '<div class="bug-filters">' + chips + '</div><div class="bug-list">' + rows + '</div>';
  }

  function bugRowHtml(b) {
    var k = BUG_KIND[b.kind] || BUG_KIND.platform;
    var sev = BUG_SEV[b.severity] || BUG_SEV.normal;
    var meta = [b.reporter || 'аноним', fmtWhen(b.created_at), b.page].filter(Boolean).join(' · ');
    var st = BUG_ST_ORDER.map(function (sk) {
      return '<button class="bug-st bug-st--' + BUG_ST[sk].tone + (b.status === sk ? ' on' : '') + '" ' +
        'data-id="' + b.id + '" data-st="' + sk + '">' + BUG_ST[sk].label + '</button>';
    }).join('');
    var closed = b.status === 'resolved' || b.status === 'wontfix';
    return '<div class="bug-item' + (closed ? ' closed' : '') + '">' +
      '<div class="bug-itop">' +
        '<span class="bug-kind"><span class="bug-dot" style="background:' + sev.dot + '" title="' + esc(sev.label) + '"></span>' +
          ic(k.icon, 13) + k.label + '</span>' +
        '<span class="bug-when num">' + fmtWhen(b.created_at) + '</span>' +
      '</div>' +
      '<div class="bug-text">' + esc(b.body) + '</div>' +
      '<div class="bug-meta">' + esc(meta) + (b.resolver && closed ? ' · закрыл ' + esc(b.resolver) : '') + '</div>' +
      '<div class="bug-sts">' + st + '</div>' +
    '</div>';
  }

  function wireBugList(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.bug-fchip'), function (b) {
      b.addEventListener('click', function () { bugState.filter = b.getAttribute('data-f'); paintBugBody(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.bug-st'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id'), st = b.getAttribute('data-st');
        var item = (bugState.items || []).filter(function (x) { return x.id === id; })[0];
        if (!item || item.status === st) return;
        var prev = item.status; item.status = st;
        paintBugBody(); refreshBugCount();
        api('/admin/api/bugs/' + id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: st }),
        }).then(function () { loadBugs(); }).catch(function (e) {
          item.status = prev; paintBugBody();
          if (e.message !== '403') showToast('Не сохранилось — проверьте сеть');
        });
      });
    });
  }

  /* ── login ────────────────────────────────────────────── */
  function renderLogin(err) {
    document.body.classList.remove('dock-open');
    root.innerHTML =
      '<div id="gate"><div class="gate-split">' +
        '<div class="gate-brand">' +
          '<div class="logo light"><div class="mk">И</div><div class="nm">ИстСайд<small>CRM команды</small></div></div>' +
          '<div class="gb-mid">' +
            '<div class="gb-h">Вся воронка EastSide<br>в одном окне</div>' +
            '<div class="gb-s">Заявки, диалоги с ботом, путь людей по платформе и деньги — на одном экране.</div>' +
          '</div>' +
          '<div class="gb-foot">' + ic('spark', 12) + 'поступление в вузы Китая — от диагностики до визы</div>' +
        '</div>' +
        '<div class="gate-card">' +
          '<h1>Вход в CRM</h1>' +
          '<p>Сессия сохранится на этом устройстве.</p>' +
          '<input id="lg-login" type="text" placeholder="Логин или почта" autocomplete="username">' +
          '<div class="lg-passwrap">' +
            '<input id="lg-pass" type="password" placeholder="Пароль" autocomplete="current-password">' +
            '<button class="lg-eye" id="lg-eye" type="button" tabindex="-1">показать</button>' +
          '</div>' +
          '<button class="bp" id="lg-go">Войти</button>' +
          '<div class="gate-err" id="lg-err">' + esc(err || '') + '</div>' +
          '<button class="gate-link" id="lg-forgot" type="button">Забыли пароль?</button>' +
        '</div>' +
      '</div></div>';
    if (err) el('lg-err').style.display = 'block';
    var li = el('lg-login'), pi = el('lg-pass');
    var eye = el('lg-eye');
    if (eye) eye.addEventListener('click', function () {
      var show = pi.type === 'password';
      pi.type = show ? 'text' : 'password';
      eye.textContent = show ? 'скрыть' : 'показать';
      pi.focus();
    });
    li.focus();
    function fail(msg) { var e = el('lg-err'); e.textContent = msg; e.style.display = 'block'; }
    function go() {
      var login = li.value.trim(), pass = pi.value;
      if (!login || !pass) { fail('Введи логин и пароль'); return; }
      el('lg-go').textContent = 'Входим…';
      fetch(API + '/admin/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login, password: pass }),
      }).then(function (r) {
        if (r.status === 401) { fail('Неверный логин или пароль'); el('lg-go').textContent = 'Войти'; return null; }
        if (!r.ok) { fail('Не получилось войти, проверь сеть'); el('lg-go').textContent = 'Войти'; return null; }
        return r.json();
      }).then(function (j) {
        if (!j) return;
        localStorage.setItem(KEY_LS, j.token);
        state.role = j.role; state.userName = j.name || '';
        boot();
      }).catch(function () { fail('Сеть недоступна'); el('lg-go').textContent = 'Войти'; });
    }
    el('lg-go').addEventListener('click', go);
    pi.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    li.addEventListener('keydown', function (e) { if (e.key === 'Enter') pi.focus(); });
    el('lg-forgot').addEventListener('click', function () { renderReset(); });
  }

  /* ── восстановление пароля ────────────────────────────── */
  /* Два шага в одной карточке: почта → код из письма и новый пароль. Отдельного
     экрана «введите код» не делаем — человек и так держит письмо открытым, лишний
     переход только добавляет шанс уйти не туда. */
  function renderReset(ctx) {
    ctx = ctx || {};
    document.body.classList.remove('dock-open');
    var sent = !!ctx.challenge;
    root.innerHTML =
      '<div id="gate"><div class="gate-split">' +
        '<div class="gate-brand">' +
          '<div class="logo light"><div class="mk">И</div><div class="nm">ИстСайд<small>CRM команды</small></div></div>' +
          '<div class="gb-mid">' +
            '<div class="gb-h">Вся воронка EastSide<br>в одном окне</div>' +
            '<div class="gb-s">Заявки, диалоги с ботом, путь людей по платформе и деньги — на одном экране.</div>' +
          '</div>' +
          '<div class="gb-foot">' + ic('spark', 12) + 'поступление в вузы Китая — от диагностики до визы</div>' +
        '</div>' +
        '<div class="gate-card">' +
          (sent
            ? '<h1>Новый пароль</h1>' +
              '<p>Код отправили на ' + esc(ctx.email) + '. Он действует ' + (ctx.ttlMin || 15) + ' минут.</p>' +
              '<input id="rs-code" type="text" inputmode="numeric" maxlength="6" placeholder="Код из письма" autocomplete="one-time-code">' +
              '<div class="lg-passwrap">' +
                '<input id="rs-pass" type="password" placeholder="Новый пароль" autocomplete="new-password">' +
                '<button class="lg-eye" id="rs-eye" type="button" tabindex="-1">показать</button>' +
              '</div>' +
              '<button class="bp" id="rs-go">Сохранить и войти</button>'
            : '<h1>Восстановление пароля</h1>' +
              '<p>Пришлем код на почту, привязанную к аккаунту.</p>' +
              '<input id="rs-email" type="email" placeholder="Почта" autocomplete="email">' +
              '<button class="bp" id="rs-go">Отправить код</button>') +
          '<div class="gate-err" id="rs-err"></div>' +
          '<button class="gate-link" id="rs-back" type="button">Вернуться ко входу</button>' +
        '</div>' +
      '</div></div>';

    var btn = el('rs-go');
    function fail(msg) { var e = el('rs-err'); e.textContent = msg; e.style.display = 'block'; }
    el('rs-back').addEventListener('click', function () { renderLogin(); });

    if (!sent) {
      var ei = el('rs-email');
      ei.focus();
      ei.addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(); });
      btn.addEventListener('click', ask);
      return;
    }

    var ci = el('rs-code'), pi = el('rs-pass'), eye = el('rs-eye');
    ci.focus();
    eye.addEventListener('click', function () {
      var show = pi.type === 'password';
      pi.type = show ? 'text' : 'password';
      eye.textContent = show ? 'скрыть' : 'показать';
      pi.focus();
    });
    ci.addEventListener('keydown', function (e) { if (e.key === 'Enter') pi.focus(); });
    pi.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    btn.addEventListener('click', save);

    function ask() {
      var email = el('rs-email').value.trim();
      if (!email || email.indexOf('@') < 0) { fail('Введи почту целиком, вместе с @'); return; }
      btn.textContent = 'Отправляем…'; btn.disabled = true;
      fetch(API + '/admin/api/password/reset/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      }).then(function (r) {
        if (r.status === 429) { fail('Код уже отправляли. Проверь почту или подожди минуту'); return null; }
        if (r.status === 503) { fail('Письмо сейчас не уходит. Напиши в чат — разберемся'); return null; }
        if (!r.ok) { fail('Не получилось. Проверь сеть'); return null; }
        return r.json();
      }).then(function (j) {
        btn.textContent = 'Отправить код'; btn.disabled = false;
        if (!j) return;
        renderReset({ challenge: j.challenge_id, email: email,
                      ttlMin: Math.max(1, Math.round((j.expires_in || 900) / 60)) });
      }).catch(function () {
        btn.textContent = 'Отправить код'; btn.disabled = false;
        fail('Сеть недоступна');
      });
    }

    function save() {
      var code = ci.value.trim(), pass = pi.value;
      if (!/^\d{6}$/.test(code)) { fail('Код — шесть цифр из письма'); return; }
      if (pass.length < 6) { fail('Пароль покороче шести символов не подойдет'); return; }
      btn.textContent = 'Сохраняем…'; btn.disabled = true;
      fetch(API + '/admin/api/password/reset/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: ctx.challenge, code: code, password: pass }),
      }).then(function (r) {
        if (r.status === 400) { fail('Код не подошел. Проверь цифры из письма'); return null; }
        if (r.status === 410) { fail('Код устарел. Запроси новый'); return null; }
        if (r.status === 429) { fail('Слишком много попыток. Запроси новый код'); return null; }
        if (r.status === 422) { fail('Пароль слишком короткий — минимум шесть символов'); return null; }
        if (!r.ok) { fail('Не получилось. Проверь сеть'); return null; }
        return r.json();
      }).then(function (j) {
        btn.textContent = 'Сохранить и войти'; btn.disabled = false;
        if (!j) return;
        localStorage.setItem(KEY_LS, j.token);
        state.role = j.role; state.userName = j.name || '';
        boot();
      }).catch(function () {
        btn.textContent = 'Сохранить и войти'; btn.disabled = false;
        fail('Сеть недоступна');
      });
    }
  }

  /* ── shell ────────────────────────────────────────────── */
  function greeting() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Доброе утро';
    if (h >= 12 && h < 18) return 'Добрый день';
    return 'Добрый вечер';
  }
  function renderShell() {
    root.innerHTML =
      '<div class="app">' +
        '<aside class="side">' +
          '<div class="logo"><div class="mk">И</div><div class="nm">ИстСайд<small>CRM команды</small></div></div>' +
          '<div class="spaces" id="spaces"></div>' +
          '<div class="side-sub" id="welc-sub"></div>' +
          '<nav id="side-nav"></nav>' +
          '<button class="navi mt" id="logout">' + ic('exit') + 'Выйти</button>' +
          '<div class="side-foot">' +
            '<div class="promo" id="promo"></div>' +
            '<button class="side-bug" id="side-bug" title="Нашли баг платформы или бота — расскажите">' +
              ic('alert', 15) + '<span>Сообщить о баге</span>' +
              '<span class="side-bug-n num" id="side-bug-n"></span></button>' +
          '</div>' +
        '</aside>' +
        '<main class="main">' +
          '<div class="topbar"><div id="tb-left"></div>' +
            '<div class="tbr">' +
              '<button class="profile" id="profile"><div class="av">' + esc(initials(state.userName)) + '</div>' +
                '<div class="pinfo"><div class="pn">' + esc(state.userName || 'EastSide') + '</div>' +
                '<div class="pe">' + esc(roleInfo().label) + '</div></div>' +
                '<span class="pchev">' + chev() + '</span></button>' +
            '</div>' +
          '</div>' +
          '<div class="content"><div class="chead" id="chead"></div><div id="view"></div></div>' +
        '</main>' +
      '</div>' +
      '<div class="mbg" id="mbg"></div>' +
      '<div class="modal" id="modal"></div>' +
      '<nav class="mtabs" id="mtabs"></nav>';

    el('logout').addEventListener('click', logout);
    var bugBtn = el('side-bug');
    if (bugBtn) bugBtn.addEventListener('click', function () { openBugPanel(); });
    refreshBugCount();
    // меню профиля: кто ты + обновить + сменить аккаунт
    var prof = el('profile');
    if (prof) prof.addEventListener('click', function (e) {
      e.stopPropagation();
      if (prof.classList.contains('open')) { closeSmenu(); return; }
      closeSmenu();
      smenu = document.createElement('div');
      smenu.id = 'smenu'; smenu.className = 'profmenu';
      smenu.innerHTML =
        '<div class="pm-head"><div class="av">' + esc(initials(state.userName)) + '</div>' +
          '<div><div class="pm-n">' + esc(state.userName || 'EastSide') + '</div>' +
          '<div class="pm-r">' + esc(roleInfo().label) + ' · ' + esc(roleInfo().short) + '</div></div></div>' +
        '<button data-a="notify">' + ic('bell', 16) + 'Уведомления</button>' +
        '<button data-a="refresh">' + ic('refresh', 16) + 'Обновить данные</button>' +
        '<button data-a="logout">' + ic('exit', 16) + 'Сменить аккаунт</button>';
      document.body.appendChild(smenu);
      var r = prof.getBoundingClientRect();
      smenu.style.minWidth = Math.max(r.width, 220) + 'px';
      smenu.style.top = (r.bottom + 8) + 'px';
      smenu.style.left = Math.min(r.left, window.innerWidth - smenu.offsetWidth - 10) + 'px';
      prof.classList.add('open');
      Array.prototype.forEach.call(smenu.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation(); var a = b.getAttribute('data-a'); closeSmenu(); prof.classList.remove('open');
          if (a === 'notify') openNotifyPrefs();
          else if (a === 'refresh') { loadLeads(false); showToast('Данные обновлены'); }
          else logout();
        });
      });
    });
    // затемнение общее для карточки клиента и карточки исполнителя — закрываем ту,
    // что сейчас открыта (одновременно они не открываются)
    el('mbg').addEventListener('click', function () { if (CZ.openId) closeCz(); else closeDrawer(); });
    document.addEventListener('click', function (e) {
      if (smenu && !smenu.contains(e.target)) closeSmenu();
    });
    document.addEventListener('keydown', function (e) {
      var a = document.activeElement;
      var typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
      if (e.key === 'Escape') {
        if (typing && a.id === 'search') { a.value = ''; state.q = ''; a.blur(); renderView(); return; }
        if (CZ.openId) { closeCz(); return; }
        if (state.drawerId) closeDrawer();
        return;
      }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); var s = el('search'); if (s) s.focus(); return; }
      if (state.drawerId && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) { e.preventDefault(); drawerStep(1); }
      if (state.drawerId && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) { e.preventDefault(); drawerStep(-1); }
    });
    mqMobile.addEventListener
      ? mqMobile.addEventListener('change', function () { renderAll(); })
      : mqMobile.addListener(function () { renderAll(); });
    renderAll();
    /* Свои задания теперь в отдельном пространстве, и человек, работающий с клиентами,
       их меню не видит. Значит счетчик надо знать СРАЗУ, а не при заходе в кабинет:
       иначе новое задание и акт на подпись ждали бы, пока он туда случайно заглянет. */
    if (can('mywork')) mwLoadCounts();
  }

  function renderAll() { renderSide(); renderTopbar(); renderHead(); renderView(); }

  /* ── РОЛИ И ДОСТУП ──────────────────────────────────────────────────────────
     Возможности (caps) = что роль видит/делает. Роль = набор caps. Чтобы добавить
     новый блок: (1) заведи cap в CAP_ALL, (2) добавь его нужным ролям ниже,
     (3) добавь nav-айтем с этим cap. Кто видит — определяется только caps. */
  // 'contractors' — раздел «Исполнители» (самозанятые): ИНН, реквизиты, суммы выплат.
  // Отдельный cap намеренно: это не те же данные, что клиентские, и видеть их должна
  // не вся команда. Зеркало на бэке — routers/admin.py ROLE_CAPS.
  // 'finmodel' — ведомость: зарплаты, дивиденды, остатки фондов. Это не тот же уровень
  // секретности, что клиентские платежи (cap 'finance'), поэтому cap свой.
  // 'mywork' — «Моя работа»: свои задания сотрудника-самозанятого. Роли его не дают
  // вовсе, он приходит с сервера по факту связи учетки с карточкой исполнителя.
  // В модуле самозанятых две стороны, и они взаимоисключающие: связанному человеку
  // сервер выдает 'mywork' и снимает 'contractors' — задания раздает один, выполняет
  // другой, и чужие ИНН с суммами выплат исполнителю не показываются.
  var CAP_ALL = ['dash', 'inbox', 'clients', 'path', 'finance', 'analytics', 'products', 'students', 'templates', 'grants', 'marketing', 'partners', 'team', 'contractors', 'finmodel'];
  var ROLES = {
    super_admin:   { label: 'Super Admin',           short: 'полный доступ',        caps: CAP_ALL.slice() },
    head:          { label: 'Руководитель',          short: 'вся компания',         caps: ['dash', 'inbox', 'clients', 'path', 'finance', 'analytics', 'products', 'students', 'templates', 'grants', 'marketing', 'partners', 'team', 'contractors', 'finmodel'] },
    product_lead:  { label: 'Руководитель продукта', short: 'продукт и аналитика',  caps: ['dash', 'clients', 'path', 'analytics', 'products', 'students', 'templates'] },
    sales_lead:    { label: 'Руководитель продаж',   short: 'продажи и деньги',     caps: ['dash', 'inbox', 'clients', 'path', 'finance', 'contractors'] },
    sales_manager: { label: 'Менеджер продаж',       short: 'заявки и диалоги',     caps: ['dash', 'inbox', 'clients'] },
    admin:         { label: 'Администратор',          short: 'операционка',          caps: ['dash', 'inbox', 'clients', 'students', 'templates', 'grants', 'products'] },
    senior_tutor:  { label: 'Старший тьютор',        short: 'обучение',             caps: ['dash', 'clients', 'students', 'templates'] },
    /* У преподавателя и тьютора нет «Дашборда»: там воронка продаж, деньги и счетчики
       заявок — чужая для них работа. Им нужен один экран: свои ученики. */
    tutor:         { label: 'Тьютор',                 short: 'свои ученики',         caps: ['students'] },
    teacher:       { label: 'Преподаватель',          short: 'свои ученики',         caps: ['students'] },
    marketer:      { label: 'Маркетолог',             short: 'трафик и аналитика',   caps: ['dash', 'path', 'analytics', 'marketing'] },
    partner:       { label: 'Партнёр',                short: 'свои лиды',            caps: ['dash', 'partners'] },
    contractor:    { label: 'Подрядчик',              short: 'задачи',               caps: ['dash'] },
    diagnostician: { label: 'Диагност',               short: 'диагностика',          caps: ['dash', 'clients', 'analytics'] },
    curator:       { label: 'Куратор',                short: 'ведёт клиентов',       caps: ['dash', 'inbox', 'clients', 'students', 'templates'] },
    grant_admin:   { label: 'Администратор гранта',   short: 'гранты',               caps: ['dash', 'grants', 'clients'] },
    // legacy-роли (старые аккаунты + admin_key) — маппятся на доступ
    owner:         { label: 'Владелец',               short: 'полный доступ',        caps: CAP_ALL.slice() },
    manager:       { label: 'Менеджер',               short: 'заявки и диалоги',     caps: ['dash', 'inbox', 'clients'] },
  };
  function roleInfo() { return ROLES[state.role] || ROLES.manager; }
  /* Право «mywork» не ролевое, а личное: оно есть у того, чья учетка связана со своей
     карточкой исполнителя. Роль тут ни при чем — преподаватель и руководитель получают
     его одинаково, если сами работают у нас как самозанятые. Правду говорит сервер
     (caps в ответе /admin/api/me), фронт только показывает пункт. */
  function can(cap) {
    // Ответил сервер — доступ считаем ТОЛЬКО по нему. Ролевая карта ниже нужна лишь
    // как запасной вариант: сложить два набора нельзя, иначе новая роль на бэкенде
    // молча получает разделы соседней роли, ручки отвечают 403, и человек упирается
    // в экран с ошибкой вместо своей работы.
    if (state.caps && state.caps.length) return state.caps.indexOf(cap) !== -1;
    return roleInfo().caps.indexOf(cap) !== -1;
  }

  /* сайдбар: нав + промо. Каждый пункт привязан к cap. */
  var NAV_ALL = [
    { id: 'dash', label: 'Дашборд', icon: 'dash', cap: 'dash' },
    { id: 'inbox', label: 'Диалоги', icon: 'dialogs', cap: 'inbox' },
    { id: 'leads', label: 'Люди', icon: 'leads', cap: 'clients' },
    { id: 'templates', label: 'Шаблоны', icon: 'box', cap: 'templates' },
    { id: 'path', label: 'Путь', icon: 'path', cap: 'path' },
    { id: 'finance', label: 'Финансы', icon: 'coins', cap: 'finance' },
    { id: 'products', label: 'Продукты', icon: 'box', cap: 'products' },
    { id: 'grants', label: 'Гранты', icon: 'award', cap: 'grants' },
    { id: 'marketing', label: 'Маркетинг', icon: 'mega', cap: 'marketing' },
    { id: 'partners', label: 'Партнёры', icon: 'handshake', cap: 'partners' },
    /* Кабинет исполнителя внутри CRM: у Консоли это отдельные пункты меню, и у нас
       тоже — «Задания» и «Акты» это разные сущности с разной логикой, вкладками их
       мешать нельзя (решение владельца от 2026-08-11). Живут они СВОИМ пространством
       (решение владельца от 2026-08-12): у того, кто ведет и клиентов, и свои задания,
       чужая работа и своя собственная лежали в одном меню вперемешку, и кабинет там
       терялся. У кого есть только кабинет, переключателя не видно вовсе — для него
       это по-прежнему единственное меню. */
    { id: 'mywork', label: 'Главная', icon: 'dash', cap: 'mywork', space: 'mw' },
    { id: 'mwnotif', label: 'Уведомления', icon: 'bell', cap: 'mywork', space: 'mw' },
    { id: 'mwtasks', label: 'Задания', icon: 'task', cap: 'mywork', space: 'mw' },
    { id: 'mwplan', label: 'Мой план', icon: 'cal', cap: 'mywork', space: 'mw' },
    { id: 'mwacts', label: 'Акты', icon: 'doc', cap: 'mywork', space: 'mw' },
    { id: 'contractors', label: 'Исполнители', icon: 'badge', cap: 'contractors', space: 'cz' },
    { id: 'cztasks', label: 'Задания', icon: 'task', cap: 'contractors', space: 'cz' },
    { id: 'czplans', label: 'Планы работ', icon: 'cal', cap: 'contractors', space: 'cz' },
    { id: 'czpay', label: 'Выплаты', icon: 'coins', cap: 'contractors', space: 'cz' },
    { id: 'czdocs', label: 'Документы', icon: 'doc', cap: 'contractors', space: 'cz' },
    { id: 'czservices', label: 'Услуги', icon: 'box', cap: 'contractors', space: 'cz' },
    { id: 'finsheet', label: 'Ведомость', icon: 'coins', cap: 'finmodel', space: 'fin' },
    { id: 'finpnl', label: 'P&L', icon: 'chart', cap: 'finmodel', space: 'fin' },
    { id: 'finops', label: 'Операции', icon: 'rows', cap: 'finmodel', space: 'fin' },
    { id: 'finref', label: 'Сервисы и долги', icon: 'clock', cap: 'finmodel', space: 'fin' },
    { id: 'analytics', label: 'Аналитика бота', icon: 'chart', cap: 'analytics' },
    { id: 'team', label: 'Команда', icon: 'team', cap: 'team' },
  ];

  /* ── Два рабочих пространства в одной CRM ─────────────────────────────────
     Работа с клиентами и работа с самозанятыми — разные задачи разных людей, и
     модуль самозанятых по плану вырастет еще на шесть разделов (задания, акты,
     выплаты, чеки, риски, отчеты). В одном меню это двадцать пунктов вперемешку,
     где обычная CRM тонет. Поэтому левая колонка переключается целиком.

     Отдельным продуктом со своим входом это не делаем: второй логин тем же людям,
     права в двух местах неминуемо разъедутся, а модулю нужны данные CRM.

     Текущее пространство НЕ храним отдельно — выводим из открытой страницы. Так
     ссылка на раздел всегда открывает его в правильном окружении, а состояние не
     может разъехаться с тем, что на экране. */
  var SPACES = [
    { id: 'crm', label: 'Клиенты' },
    { id: 'cz', label: 'Самозанятые' },
    { id: 'fin', label: 'Ведомость' },
    // Своя работа — последней: сначала то, что человек делает для компании, потом то,
    // что компания должна ему.
    { id: 'mw', label: 'Моя работа' },
  ];
  function navSpace(it) { return it.space || 'crm'; }
  // Иконка пространства на телефоне: вкладка перехода подписана словом, но узнают ее
  // по значку — одинаковые значки у разных пространств сводят его на нет.
  var SPACE_ICON = { crm: 'leads', cz: 'badge', fin: 'coins', mw: 'task' };
  function spaceOf(page) {
    for (var i = 0; i < NAV_ALL.length; i++) if (NAV_ALL[i].id === page) return navSpace(NAV_ALL[i]);
    return 'crm';
  }
  function curSpace() { return spaceOf(state.page); }
  /* «Задания» и «Планы работ» — два раздела (решение владельца от 2026-08-07): план и
     задание разные сущности, и на экране это должно быть видно так же, как в данных.
     Связь между ними показана перекрестными ссылками в карточках, а не общим экраном. */
  function czTasksOn() { return state.page === 'cztasks'; }
  function czPlansOn() { return state.page === 'czplans'; }
  function navItems(space) {
    var s = space || curSpace();
    return NAV_ALL.filter(function (it) { return can(it.cap) && navSpace(it) === s; });
  }
  /* Ждут ли человека его собственные задания и акты. Считает сервер (те же счетчики,
     что и внутри кабинета), экран только показывает точку на кнопке пространства. */
  function spaceAttention() { return mwBadge('mwtasks') + mwBadge('mwacts') + mwBadge('mwnotif') > 0; }
  /* Переключатель показываем, только если человеку доступно больше одного
     пространства: у кого нет доступа к самозанятым, CRM не меняется вообще. */
  function openSpaces() {
    return SPACES.filter(function (s) { return navItems(s.id).length; });
  }
  /* Роль без единого доступного раздела (преподаватель, у которого нет ни клиентов, ни
     связи с карточкой исполнителя) не должна падать на дашборд компании: ручки все равно
     ответят 403, а человек увидит экран с ошибками вместо объяснения. */
  function noSections() { return !NAV_ALL.some(function (it) { return can(it.cap); }); }
  function pageCap(page) { for (var i = 0; i < NAV_ALL.length; i++) if (NAV_ALL[i].id === page) return NAV_ALL[i].cap; return 'dash'; }
  function firstAllowedPage(space) {
    var n = navItems(space);
    // пространство пустое для этой роли — уводим в любой доступный раздел, а не в никуда
    if (!n.length) n = NAV_ALL.filter(function (it) { return can(it.cap); });
    return n.length ? n[0].id : 'dash';
  }
  function renderSide() {
    var c = counts();
    var space = curSpace();
    var NAV = navItems(space);
    var sw = el('spaces');
    if (sw) {
      var open = openSpaces();
      if (open.length < 2) { sw.style.display = 'none'; sw.innerHTML = ''; }
      else {
        sw.style.display = '';
        sw.innerHTML = open.map(function (s) {
          // Точка на кнопке чужого пространства: пока человек ведет клиентов, ему
          // прилетело задание или акт на подпись — узнать об этом он должен отсюда,
          // не заходя внутрь. Своя работа единственная, где ждут ЛИЧНО его.
          var dot = (s.id === 'mw' && s.id !== space && spaceAttention()) ? '<i class="sp-dot"></i>' : '';
          return '<button class="' + (s.id === space ? 'on' : '') + '" data-sp="' + s.id + '">' +
            esc(s.label) + dot + '</button>';
        }).join('');
        Array.prototype.forEach.call(sw.children, function (b) {
          b.addEventListener('click', function () { setSpace(b.getAttribute('data-sp')); });
        });
      }
    }
    var nav = el('side-nav');
    if (nav) {
      var ho = inboxAttention();
      nav.innerHTML = NAV.map(function (it) {
        var extra = '';
        if (it.id === 'leads' && c.hot) extra = '<span class="bdg num">' + c.hot + '</span>';
        else if (it.id === 'leads') extra = '<span class="cnt num">' + c.all + '</span>';
        else if (it.id === 'inbox' && ho) extra = '<span class="bdg num" title="ждут ответа">' + ho + '</span>';
        else if (mwBadge(it.id)) extra = '<span class="bdg num">' + mwBadge(it.id) + '</span>';
        return '<button class="navi' + (state.page === it.id ? ' on' : '') + '" data-p="' + it.id + '">' +
          ic(it.icon) + it.label + extra + '</button>';
      }).join('');
      Array.prototype.forEach.call(nav.children, function (b) {
        b.addEventListener('click', function () { setPage(b.getAttribute('data-p')); });
      });
    }
    var ws = el('welc-sub');
    if (ws) {
      // подпись под логотипом — про то пространство, в котором сейчас работают
      var czn = (CZ.list || []).length;
      var mwn = mwBadge('mwtasks') + mwBadge('mwacts');
      ws.textContent = space === 'mw'
        // В своем кабинете счетчик лидов не при чем: тут человека касается только то,
        // что ждет лично его.
        ? (mwn ? mwn + ' ' + plural(mwn, 'дело', 'дела', 'дел') + ' для вас'
               : 'ваши задания и акты')
        : space === 'cz'
        ? (CZ.list === null ? 'исполнители' : czn + ' ' + plural(czn, 'исполнитель', 'исполнителя', 'исполнителей'))
        // Преподаватель лидов не грузит вовсе — счетчик у него всегда показывал
        // «0 лидов · обновлено —». Вместо мертвой цифры пишем, кто он в системе.
        : can('clients')
          ? c.all + ' ' + plural(c.all, 'лид', 'лида', 'лидов') + ' · обновлено ' +
            (state.updatedAt ? pad(state.updatedAt.getHours()) + ':' + pad(state.updatedAt.getMinutes()) : '—')
          : roleInfo().label;
    }
    var promo = el('promo');
    if (promo) {
      // промо про воронку платформы живет только в клиентском пространстве: к работе с
      // исполнителями, к ведомости и к своим заданиям оно отношения не имеет
      if (space !== 'crm' || !can('path') || !can('clients')) { promo.style.display = 'none'; }
      else {
        promo.style.display = '';
        var worst = worstStep(funnelData(''));
        promo.innerHTML =
          '<div class="pt">' + (worst ? 'Дыра в воронке' : 'Воронка платформы') + '</div>' +
          '<div class="pp">' + (worst
            ? 'На шаге «' + esc(worst.step.label) + '» уходит ' + Math.round(worst.pct * 100) + '% дошедших. Список людей с контактами — внутри.'
            : 'Смотри путь людей по шагам платформы — от входа до клиента.') + '</div>' +
          '<div class="pb">Открыть «Путь»' + ic('go', 13) + '</div>';
        promo.onclick = function () { setPage('path'); };
      }
    }
    var mt = el('mtabs');
    if (mt) {
      var hoM = inboxAttention();
      var mBadge = function (it) {
        return (it.id === 'leads' && c.hot) ? c.hot
          : (it.id === 'inbox' && hoM) ? hoM : mwBadge(it.id);
      };
      // На телефоне левой колонки нет, поэтому переход в другое пространство живет
      // отдельной вкладкой в начале ленты — иначе с телефона туда не попасть.
      var jumps = openSpaces().filter(function (s) { return s.id !== space; });
      var jump = jumps.map(function (s) {
        var d = (s.id === 'mw' && spaceAttention()) ? '<i class="sp-dot"></i>' : '';
        return '<button class="mtab mtab-sp" data-sp="' + s.id + '">' +
          ic(SPACE_ICON[s.id] || 'leads') + '<span>' + esc(s.label) + '</span>' + d + '</button>';
      }).join('');
      // На телефон помещаются четыре подписи. Остальные разделы (у super_admin их
      // тринадцать) уходят под «Еще»: горизонтальная прокрутка таббара прячет пункты
      // без единого намека, что они есть. Вкладки пространств занимают то же место,
      // поэтому считаем их вместе — иначе у владельца лента снова уезжает за край.
      var fits = Math.max(2, 4 - jumps.length), mHead = NAV, mTail = [];
      if (NAV.length > fits + 1) { mHead = NAV.slice(0, fits); mTail = NAV.slice(fits); }
      var tailOn = mTail.some(function (it) { return it.id === state.page; });
      var tailBadge = mTail.reduce(function (s, it) { return s + mBadge(it); }, 0);
      mt.innerHTML = jump + mHead.map(function (it) {
        var bd = mBadge(it);
        return '<button class="mtab' + (state.page === it.id ? ' on' : '') + '" data-p="' + it.id + '">' +
          ic(it.icon) + '<span>' + it.label + '</span>' +
          (bd ? '<span class="bdg num">' + bd + '</span>' : '') + '</button>';
      }).join('') + (mTail.length
        ? '<button class="mtab' + (tailOn ? ' on' : '') + '" data-more="1">' +
            ic('more') + '<span>' + (tailOn ? esc(pageLabel()) : 'Еще') + '</span>' +
            (tailBadge ? '<span class="bdg num">' + tailBadge + '</span>' : '') + '</button>'
        : '');
      Array.prototype.forEach.call(mt.children, function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var sp = b.getAttribute('data-sp');
          if (sp) setSpace(sp);
          else if (b.getAttribute('data-more')) openMoreMenu(b, mTail, mBadge);
          else setPage(b.getAttribute('data-p'));
        });
      });
      // Лента длиннее экрана — подводим открытый раздел в центр сами. scrollIntoView
      // тут нельзя: лента прибита к низу, и браузер заодно дергает всю страницу.
      var onTab = mt.querySelector('.mtab.on');
      if (onTab) mt.scrollLeft = Math.max(0, onTab.offsetLeft - (mt.clientWidth - onTab.offsetWidth) / 2);
    }
    document.title = (c.hot ? '(' + c.hot + ') ' : '') + 'ИстСайд · CRM';
  }

  /* Переключение пространства = переход на первый его раздел. Отдельного состояния
     нет намеренно: пространство всегда выводится из открытой страницы. */
  function setSpace(id) {
    if (curSpace() === id) return;
    setPage(firstAllowedPage(id));
  }

  function setPage(p) {
    if (state.page === p) return;
    if (CZ.openId) closeCz();   // карточка исполнителя не переезжает в другой раздел
    state.page = p;
    state.sort = null;
    saveUi();
    renderAll();
    if (p === 'finance') fetchFinance(false, function () { if (state.page === 'finance') { renderHead(); renderView(); } });
    window.scrollTo(0, 0);
    var m = document.querySelector('.main'); if (m) m.scrollTop = 0;
  }

  /* topbar: контекстные табы */
  function renderTopbar() {
    var tb = el('tb-left');
    if (!tb) return;
    var c = counts();
    if (noSections()) { tb.innerHTML = ''; return; }
    if (state.page === 'leads') {
      tb.innerHTML = '<nav class="tabs">' + Object.keys(SEGS).map(function (s) {
        var n = s === 'queue' ? c.queue : s === 'all' ? c.all : s === 'clients' ? c.clients : s === 'rejected' ? c.rejected : 0;
        return '<a class="tab' + (state.seg === s ? ' on' : '') + '" data-seg="' + s + '">' +
          SEGS[s].label + (n ? '<span class="n num">' + n + '</span>' : '') + '</a>';
      }).join('') + '</nav>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () {
          var prev = state.seg;
          state.seg = t.getAttribute('data-seg');
          state.sort = null;
          saveUi();
          // архив тянет ОТДЕЛЬНЫЙ набор (скрытые) — при входе/выходе перезагружаем список
          if (state.seg === 'archive' || prev === 'archive') loadLeads(false);
          else { renderTopbar(); renderHead(); renderView(); }
        });
      });
    } else if (state.page === 'path' && can('clients')) {
      var opts = [['', 'За все время'], ['month', '30 дней'], ['week', '7 дней']];
      tb.innerHTML = '<nav class="tabs">' + opts.map(function (o) {
        return '<a class="tab' + (state.pathPeriod === o[0] ? ' on' : '') + '" data-per="' + o[0] + '">' + o[1] + '</a>';
      }).join('') + '</nav>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () {
          state.pathPeriod = t.getAttribute('data-per');
          renderTopbar(); renderView(); renderSide();
        });
      });
    } else if (state.page === 'finance') {
      var fopts = [['', 'За все время'], ['year', '12 месяцев'], ['month', '30 дней']];
      tb.innerHTML = '<nav class="tabs">' + fopts.map(function (o) {
        return '<a class="tab' + (state.finPeriod === o[0] ? ' on' : '') + '" data-fper="' + o[0] + '">' + o[1] + '</a>';
      }).join('') + '</nav>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () {
          state.finPeriod = t.getAttribute('data-fper');
          fetchFinance(true, function () { if (state.page === 'finance') renderView(); });
          renderTopbar(); renderHead(); renderView();
        });
      });
    } else if (state.page === 'finpnl') {
      // У P&L свой переключатель: он смотрится не за ведомость, а нарастающим итогом.
      tb.innerHTML = '<nav class="tabs">' + FIN_SCOPES.map(function (o) {
        return '<a class="tab' + (FIN.scope === o[0] ? ' on' : '') + '" data-fsc="' + o[0] + '">' + o[1] + '</a>';
      }).join('') + '</nav>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () {
          FIN.scope = t.getAttribute('data-fsc'); FIN.pnl = null;
          renderTopbar(); renderView();
        });
      });
    } else if (state.page === 'finsheet' || state.page === 'finops') {
      // Период — это и есть контекст ведомости: без него цифры внизу ничего не значат.
      var pers2 = (FIN.periods || []).slice(0, 8);
      tb.innerHTML = pers2.length
        ? '<nav class="tabs">' + pers2.map(function (p) {
            return '<a class="tab' + (FIN.id === p.id ? ' on' : '') + '" data-fper="' + p.id + '">' +
              esc(p.name) + (p.open ? '<span class="n num">открыт</span>' : '') + '</a>';
          }).join('') + '</nav>'
        : '<div class="freshchip"><span class="fok">' + ic('coins', 11) + '</span>ведомость</div>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () { finSetPeriod(t.getAttribute('data-fper')); });
      });
    } else if (state.page === 'inbox') {
      var bsrc = state.inboxMode === 'threads' ? 'обсуждения по задачам'
        : (state.bot.source === 'api' ? 'диалоги из бота · live' : 'омниканальный инбокс');
      tb.innerHTML = '<div class="freshchip"><span class="fok">' + ic('chat', 11) + '</span>' + bsrc + '</div>';
    } else if (state.page === 'analytics') {
      tb.innerHTML = '<div class="freshchip"><span class="fok">' + ic('bolt', 11) + '</span>аналитика бота</div>';
    } else if (state.page === 'dash' && can('clients')) {
      var pers = [['', 'Всё время'], ['today', 'Сегодня'], ['week', '7 дней'], ['month', '30 дней']];
      var customLbl = state.dashPeriod === 'custom'
        ? (state.dashFrom || '…') + ' — ' + (state.dashTo || '…')
        : 'Период…';
      tb.innerHTML = '<div class="dperiod" id="d-period">' + pers.map(function (o) {
        return '<button data-per="' + o[0] + '" class="' + (state.dashPeriod === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') +
        '<button data-per="custom" class="dp-custom' + (state.dashPeriod === 'custom' ? ' on' : '') + '">' + ic('cal', 12) + esc(customLbl) + '</button>' +
      '</div>';
      Array.prototype.forEach.call(tb.querySelectorAll('#d-period button'), function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('data-per') === 'custom') { openDashRange(b); return; }
          state.dashPeriod = b.getAttribute('data-per');
          saveUi(); renderTopbar(); renderView();
        });
      });
    } else {
      var meta = navMeta(state.page);
      tb.innerHTML = meta ? '<div class="freshchip"><span class="fok">' + ic(meta.icon, 11) + '</span>' + esc(meta.label) + '</div>' : '';
    }
  }

  /* кастомный диапазон дат на дашборде */
  function openDashRange(anchor) {
    closeSmenu();
    smenu = document.createElement('div');
    smenu.id = 'smenu'; smenu.className = 'profmenu dp-pop';
    smenu.innerHTML =
      '<div class="dp-ttl">Свой период</div>' +
      '<div class="dp-row"><label>С</label><input type="date" id="dp-from" value="' + (state.dashFrom || '') + '"></div>' +
      '<div class="dp-row"><label>По</label><input type="date" id="dp-to" value="' + (state.dashTo || '') + '"></div>' +
      '<div class="dp-acts"><button class="bp sm" id="dp-apply" style="flex:1;justify-content:center">Применить</button>' +
      '<button class="dp-reset" id="dp-reset">Сбросить</button></div>';
    document.body.appendChild(smenu);
    var r = anchor.getBoundingClientRect();
    smenu.style.minWidth = '244px';
    smenu.style.top = (r.bottom + 8) + 'px';
    smenu.style.left = Math.min(r.left, window.innerWidth - 264) + 'px';
    el('dp-apply').addEventListener('click', function () {
      var f = el('dp-from').value, t = el('dp-to').value;
      if (!f && !t) { closeSmenu(); return; }
      state.dashFrom = f; state.dashTo = t; state.dashPeriod = 'custom';
      closeSmenu(); saveUi(); renderTopbar(); renderView();
    });
    el('dp-reset').addEventListener('click', function () {
      state.dashFrom = ''; state.dashTo = ''; state.dashPeriod = '';
      closeSmenu(); saveUi(); renderTopbar(); renderView();
    });
  }

  /* ── шапка страницы ───────────────────────────────────── */
  function renderHead() {
    var ch = el('chead');
    if (!ch) return;
    var c = counts();
    var html = '';
    if (noSections()) {
      // Разделов нет — шапка дашборда была бы подписью к пустому месту.
      ch.innerHTML = '<div><h2>' + greeting() + (state.userName ? ', ' + esc(state.userName) : '') + '</h2></div>';
      return;
    }
    if (state.page === 'dash' && !can('clients')) {
      // Роль без клиентов лидов не грузит: любая фраза про заявки была бы враньем.
      html = '<div><h2>' + greeting() + (state.userName ? ', ' + esc(state.userName) : '') + '</h2></div>';
    } else if (state.page === 'dash') {
      var risks = allRisks();
      var worst = worstStep(funnelData(''));
      var phrase;
      if (c.hot) phrase = '<b>' + c.hot + ' ' + plural(c.hot, 'заявка ждет', 'заявки ждут', 'заявок ждут') + ' связи.</b> Начни с них — список ниже.';
      else if (risks.length) phrase = 'Горячих заявок нет, но есть <b>' + risks.length + ' ' + plural(risks.length, 'риск', 'риска', 'рисков') + '</b> по лидам в работе.';
      else if (worst) phrase = 'Все заявки разобраны. Самая большая дыра воронки — <b>«' + esc(worst.step.label) + '»</b>: уходит ' + Math.round(worst.pct * 100) + '%.';
      else phrase = 'Все спокойно: заявки разобраны, рисков нет.';
      html = '<div><h2>' + greeting() + (state.userName ? ', ' + esc(state.userName) : '') + '</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('spark', 13) + '</span><span>' + phrase + '</span></div></div>';
    }
    if (state.page === 'leads') {
      html = '<div><h2>Люди</h2>' +
        '<div class="verdict" style="margin-top:8px"><span>' + esc(SEGS[state.seg].hint) + '</span></div></div>';
    }
    if (state.page === 'path' && !can('clients')) {
      html = '<div><h2>Путь по платформе</h2></div>';
    } else if (state.page === 'path') {
      var steps = funnelData(state.pathPeriod);
      var w2 = worstStep(steps);
      var conv = steps[0].n ? Math.round(steps[steps.length - 1].n / steps[0].n * 1000) / 10 : 0;
      html = '<div><h2>Путь по платформе</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('spark', 13) + '</span><span>' +
        'Сквозная конверсия вход → клиент: <b>' + conv + '%</b>.' +
        (w2 ? ' Самый большой провал — <b>«' + esc(w2.step.label) + '»</b>: минус ' + Math.round(w2.pct * 100) + '% дошедших. Кликни по шагу — увидишь, кто ушел.' : '') +
        '</span></div></div>';
    }
    if (state.page === 'inbox') {
      html = '';  // инбокс на всю высоту, без шапки
    }
    if (state.page === 'analytics') {
      html = '<div><h2>Аналитика бота</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('bolt', 13) + '</span><span>' +
        'Скорость ответа, каналы, конверсии и расход AI — живые данные из бота. Расход AI — оценка.' +
        '</span></div></div>';
    }
    if (state.page === 'finance') {
      var f = state.finance;
      var phrase2;
      if (!f) phrase2 = 'Считаю деньги…';
      else {
        phrase2 = 'Оплачено всего: <b>' + finMoney(f.paid_total) + ' ₽</b>' +
          (f.pending_total ? ' · ждем еще <b>' + finMoney(f.pending_total) + ' ₽</b>' : '') +
          (f.pay_conv && f.pay_conv.booked ? ' · из заявок в оплату дошло <b>' + f.pay_conv.pct + '%</b>' : '') + '.';
      }
      html = '<div><h2>Финансы</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('spark', 13) + '</span><span>' + phrase2 + '</span></div></div>';
    }
    if (state.page === 'contractors') {
      var s = CZ.stats;
      var phrase3;
      if (!s) phrase3 = 'Загружаю исполнителей…';
      else if (!s.total) phrase3 = 'Исполнителей пока нет. Заведите первого — дальше на него можно будет ставить задания.';
      else if (s.problem) phrase3 = '<b>' + s.problem + ' ' + plural(s.problem, 'исполнителю', 'исполнителям', 'исполнителям') + '</b> платить сейчас нельзя. Начните с них.';
      else if (s.new) phrase3 = 'Проблем нет, но <b>' + s.new + ' ' + plural(s.new, 'человек', 'человека', 'человек') + '</b> не довели до конца — не хватает данных или подписи.';
      else phrase3 = 'Все исполнители готовы к работе: статус в налоговой подтвержден, документы подписаны, реквизиты есть.';
      html = '<div><h2>Исполнители</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('shield', 13) + '</span><span>' + phrase3 + '</span></div></div>';
    }
    if (mwOn()) {
      /* Вердикт отвечает на единственный вопрос человека: что от меня ждут сейчас.
         Сначала подпись акта — без нее нам нельзя платить, и это его же деньги.
         Заголовок свой у каждого раздела, вердикт общий: он про всю его работу,
         а не про открытый экран. */
      var mc = MW.counts;
      var toSign = mc ? (mc.acts_to_sign || 0) : 0;
      var offered = mc ? Math.max(0, (mc.todo || 0) - toSign) : 0;
      var phrase8;
      if (MW.err) phrase8 = esc(MW.err);
      else if (!mc) phrase8 = 'Загружаю вашу работу…';
      else if (toSign) phrase8 = '<b>' + toSign + ' ' + plural(toSign, 'акт ждет', 'акта ждут', 'актов ждут') +
        ' вашей подписи.</b> Пока подписи нет, выплату провести нельзя.';
      else if (offered) phrase8 = '<b>' + offered + ' ' + plural(offered, 'новое задание', 'новых задания', 'новых заданий') +
        '</b> ждет вашего решения — принять или отказаться.';
      else if (mc.active) phrase8 = 'В работе <b>' + mc.active + ' ' +
        plural(mc.active, 'задание', 'задания', 'заданий') + '</b>. Результат прикладывайте файлом в карточке.';
      else if (mc.review) phrase8 = 'Все сдано: <b>' + mc.review + ' ' +
        plural(mc.review, 'задание', 'задания', 'заданий') + '</b> у менеджера на проверке.';
      else phrase8 = 'Новых заданий нет. Здесь ваша работа как самозанятого: задания, план и акты.';
      html = '<div><h2>' + esc(MW_TITLES[state.page] || 'Моя работа') + '</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('task', 13) + '</span><span>' + phrase8 + '</span></div></div>';
    }
    if (czTasksOn()) {
      var cs = CT.stats;
      var phrase4;
      // Вердикт отвечает на вопрос оператора «за что мне сейчас браться», а не
      // пересказывает числа: горячее тут — сданная работа, которую никто не принял.
      var wait = cs && cs.by_status ? (cs.by_status.done || 0) : 0;
      var ready = cs && cs.by_status ? (cs.by_status.approved || 0) : 0;
      if (!cs) phrase4 = 'Загружаю задания…';
      else if (!cs.count && CT.tab === 'all' && !CT.q) phrase4 = 'Заданий пока нет. Задание — это работа с результатом и суммой: из принятых заданий собирается акт, по акту идет выплата.';
      else if (wait) phrase4 = '<b>' + wait + ' ' + plural(wait, 'задание ждет', 'задания ждут', 'заданий ждут') + '</b> проверки — примите результат или верните на доработку.';
      else if (ready) phrase4 = 'Проверять нечего. <b>' + ready + ' ' + plural(ready, 'задание готово', 'задания готовы', 'заданий готовы') + '</b> к акту.';
      else phrase4 = 'В работе <b>' + cs.count + ' ' + plural(cs.count, 'задание', 'задания', 'заданий') + '</b> на <b>' + ctMoney(cs.amount) + ' ₽</b>.';
      html = '<div><h2>Задания</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('task', 13) + '</span><span>' + phrase4 + '</span></div></div>';
    }
    if (czPlansOn()) {
      // Вердикт отвечает на вопрос «где дыра»: пустой период у исполнителя важнее, чем
      // проценты выполнения. И сразу напоминает границу — план это не деньги.
      var ps = PL.data ? plStats() : null;
      var phrase6;
      var noplan = ps && ps.empty
        ? ' У <b>' + ps.empty + ' ' + plural(ps.empty, 'человека', 'человек', 'человек') +
          '</b> плана на этот период нет.' : '';
      if (!ps) phrase6 = 'Загружаю планы…';
      else if (!ps.people) phrase6 = 'Исполнителей пока нет — планировать некому.';
      else if (!ps.items) phrase6 = 'На этот период ничего не запланировано. План — это то, чем человек занят; ' +
        'деньги идут отдельно, за задания.';
      else phrase6 = 'Сделано <b>' + ps.done + ' из ' + ps.items + '</b> ' +
        plural(ps.items, 'пункта', 'пунктов', 'пунктов') +
        (ps.tasks ? ', в задания превращено <b>' + ps.tasks + '</b>' : '') + '.' + noplan;
      html = '<div><h2>Планы работ</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('cal', 13) + '</span><span>' + phrase6 + '</span></div></div>';
    }
    if (state.page === 'czpay') {
      /* Вердикт отвечает на вопрос, с которым сюда заходят: сколько денег готово уйти
         сегодня. Застрявшее называем отдельно — это не «к оплате», это работа для
         оператора, а не для банка. */
      var pr = PY.reg;
      var stuck = pr ? pyRows('waiting').length : 0;
      var phrase8;
      if (!pr) phrase8 = 'Считаю реестр…';
      else if (PY.err) phrase8 = esc(PY.err);
      else if (!pr.ready_count) phrase8 = 'К выплате сейчас ничего нет. Задание попадает в реестр, ' +
        'когда работа принята и акт подписан обеими сторонами.' +
        (stuck ? ' Ждут документов: <b>' + stuck + '</b>.' : '');
      else phrase8 = 'Готово к выплате <b>' + pr.ready_count + ' ' +
        plural(pr.ready_count, 'задание', 'задания', 'заданий') + '</b> на <b>' +
        ctMoney(pr.ready_amount) + ' ₽</b>.' +
        (stuck ? ' Еще <b>' + stuck + '</b> ждут документов.' : '');
      html = '<div><h2>Выплаты</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('coins', 13) + '</span><span>' + phrase8 + '</span></div></div>';
    }
    if (state.page === 'czdocs') {
      /* Вердикт отвечает на вопрос, ради которого сюда заходят: что висит без подписи.
         Неподписанный акт — это незакрытый расход и невозможная выплата. */
      var dcs = DC.items;
      var wait = dcs ? dcs.filter(function (d) {
        return d.kind === 'act' && (d.status === 'wait_both' || d.status === 'wait_co' ||
                                    d.status === 'wait_ct');
      }).length : 0;
      var phrase7;
      if (!dcs) phrase7 = 'Загружаю документы…';
      else if (!dcs.length) phrase7 = 'Документов пока нет. Акт появится здесь сам, как только вы сформируете его по принятому заданию.';
      else if (wait) phrase7 = 'Без подписи: <b>' + wait + ' ' +
        plural(wait, 'акт', 'акта', 'актов') +
        '</b>. Пока обе подписи не стоят, выплату провести нельзя.';
      else phrase7 = 'Все акты подписаны с обеих сторон.';
      html = '<div><h2>Документы</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('doc', 13) + '</span><span>' + phrase7 + '</span></div></div>';
    }
    if (state.page === 'czservices') {
      // Каталог — прайс, а не заказ: вердикт напоминает, что цена задания живет в самом
      // задании, иначе правка каталога кажется правкой уже согласованных сумм.
      var sv = CT.cat;
      var on = sv ? sv.filter(function (x) { return x.active; }).length : 0;
      var phrase5;
      if (!sv) phrase5 = 'Загружаю каталог…';
      else if (!sv.length) phrase5 = 'Каталог пуст. Заведите услуги с ценой за единицу — дальше задание собирается в один клик.';
      else phrase5 = '<b>' + on + ' ' + plural(on, 'услуга', 'услуги', 'услуг') +
        '</b> в работе. Цена отсюда подставляется в новое задание; у выданных заданий она не меняется.';
      html = '<div><h2>Каталог услуг</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('box', 13) + '</span><span>' + phrase5 + '</span></div></div>';
    }
    if (curSpace() === 'fin') {
      // Вердикт ведомости отвечает на один вопрос: хватает ли денег, чтобы закрыть
      // период. Именно от него зависит, тянуть период дальше или платить.
      var per = finPeriod();
      var sh = FIN.sheet && FIN.sheet !== 'none' ? FIN.sheet : null;
      var titles = { finsheet: 'Ведомость', finpnl: 'Прибыль и убытки',
                     finops: 'Карта операций', finref: 'Сервисы и долги' };
      var ph;
      if (FIN.err) ph = esc(FIN.err);
      // «Сервисы и долги» живут вне периода — им ждать список ведомостей незачем.
      else if (state.page === 'finref') ph = 'Регулярные списания и обязательства. Остаток долга едет в следующий период, пока не погашен.';
      else if (!per) ph = 'Загружаю ведомость…';
      else if (state.page === 'finsheet' && sh) {
        ph = 'Период <b>' + esc(per.name) + '</b>, ' + (per.open ? 'открыт' : 'закрыт') +
          '. К распределению <b>' + finRub(sh.cascade.dividends) + '</b>, на расчетном счете <b>' +
          finRub(sh.metrics ? sh.metrics.on_vtb : 0) + '</b>.' +
          ((sh.warnings || []).length ? ' Перед закрытием проверьте остатки — список справа.' : '');
      } else if (state.page === 'finpnl') {
        ph = 'Только факт, нарастающим итогом. План в этот отчет не попадает никогда.';
      } else if (state.page === 'finops') {
        ph = 'Все, что внесено в ведомость <b>' + esc(per.name) + '</b>: доходы, расходы и переводы между счетами.';
      } else {
        ph = 'Регулярные списания и обязательства. Остаток долга едет в следующий период, пока не погашен.';
      }
      html = '<div><h2>' + (titles[state.page] || 'Ведомость') + '</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('coins', 13) + '</span><span>' + ph + '</span></div></div>';
    }
    ch.innerHTML = html;
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  /* ── view ─────────────────────────────────────────────── */
  var STUB_PAGES = { grants: 1, partners: 1 };
  function renderView() {
    var view = el('view');
    if (!view) return;
    if (noSections()) {
      view.innerHTML = '<div class="card"><div class="empty">Разделов для вашей учетки пока нет. ' +
        'Напишите руководителю — доступ выдают в разделе «Команда».</div></div>';
      return;
    }
    // гард доступа: нет cap у текущей страницы → на первую доступную роли
    if (!can(pageCap(state.page))) state.page = firstAllowedPage();
    // «Обсуждения» больше не отдельная страница — это вкладка внутри «Диалогов»
    if (state.page === 'threads') { state.page = 'inbox'; state.inboxMode = 'threads'; }
    if (state.inboxMode === 'threads' && !can('clients')) state.inboxMode = 'bot';
    document.body.classList.toggle('inbox-mode', state.page === 'inbox');
    if (!state.loaded) {
      if (state.page === 'dash') view.innerHTML = dashSkeleton();
      else if (state.page === 'leads') return renderLeads(view); // тулбар + скелетон строк
      else view.innerHTML = '<div class="loadwrap"><div class="loaddot"></div><div class="loaddot"></div><div class="loaddot"></div></div>';
      return;
    }
    // «Диалоги» = одна поверхность с тумблером: переписки бота ↔ обсуждения по задачам
    if (state.page === 'inbox') return state.inboxMode === 'threads' ? renderThreads(view) : renderInbox(view);
    if (state.page === 'dash') renderDash(view);
    else if (state.page === 'path') renderPath(view);
    else if (state.page === 'finance') renderFinance(view);
    else if (state.page === 'analytics') renderBotAnalytics(view);
    else if (state.page === 'team') renderTeam(view);
    else if (state.page === 'templates') renderTemplates(view);
    else if (state.page === 'marketing') renderMarketing(view);
    else if (state.page === 'products') renderProducts(view);
    else if (mwOn()) { mwLoadCounts(); mwView(view); }
    else if (state.page === 'contractors') renderContractors(view);
    else if (state.page === 'cztasks') renderCzTasks(view);
    else if (state.page === 'czplans') renderCzPlans(view);
    else if (state.page === 'czpay') renderCzPay(view);
    else if (state.page === 'czdocs') renderCzDocs(view);
    else if (state.page === 'czservices') renderCzServices(view);
    else if (state.page === 'finsheet') renderFinSheet(view);
    else if (state.page === 'finpnl') renderFinPnl(view);
    else if (state.page === 'finops') renderFinOps(view);
    else if (state.page === 'finref') renderFinRefs(view);
    else if (STUB_PAGES[state.page]) renderStub(view);
    else renderLeads(view);
    pageAnim(view);
  }
  /* ── заглушки будущих разделов (роль их видит, но фич ещё нет) ── */
  var STUB_TEXT = {
    products:  'Каталог услуг — что продаём, цены, привязка к оплатам клиентов и финансам.',
    grants:    'Гранты CSC и провинциальные: заявки, статусы, дедлайны, пакет документов по каждому ученику.',
    marketing: 'Источники трафика, кампании, стоимость лида и ROI по каналам.',
    partners:  'Кабинет партнёров: их приведённые лиды, статистика и выплаты.',
  };
  function navMeta(id) { for (var i = 0; i < NAV_ALL.length; i++) if (NAV_ALL[i].id === id) return NAV_ALL[i]; return null; }
  /* Дашборд и «Путь» целиком собраны из карточек клиентов. Роль без доступа к
     клиентам (маркетолог, партнер, подрядчик) их не загружает — и без этой заглушки
     видела бы честные нули, будто в компании нет ни одной заявки. Говорим прямо. */
  function noClientsStub(view, page) {
    view.innerHTML = '<div class="stub">' +
      '<div class="stub-ic">' + ic(page === 'path' ? 'path' : 'dash', 30) + '</div>' +
      '<div class="stub-t">' + (page === 'path' ? 'Путь по платформе' : 'Воронка по клиентам') + '</div>' +
      '<div class="stub-s">Считается по карточкам клиентов, а твоей роли они закрыты — поэтому цифр тут нет. ' +
      'Нужен доступ, скажи руководителю.</div></div>';
  }

  function renderStub(view) {
    var m = navMeta(state.page) || { label: 'Раздел', icon: 'box' };
    view.innerHTML = '<div class="stub">' +
      '<div class="stub-ic">' + ic(m.icon, 30) + '</div>' +
      '<div class="stub-t">' + esc(m.label) + '</div>' +
      '<div class="stub-s">' + esc(STUB_TEXT[state.page] || 'Раздел в разработке.') + '</div>' +
      '<div class="stub-tag">' + ic('spark', 12) + 'В разработке</div></div>';
  }
  /* ── ИСПОЛНИТЕЛИ-САМОЗАНЯТЫЕ (модуль самозанятых, этап 1) ───────────────────
     Справочник людей, которым мы платим как самозанятым, и их готовность к работе.
     Главное здесь — не контакты, а ответ на один вопрос: можно ли этому человеку
     ставить задание и платить. Выплата тому, у кого слетел статус плательщика НПД,
     превращается в выплату обычному физлицу — с НДФЛ, взносами и штрафом сверху.
     Поэтому статус берется из налоговой (проверка каждое утро и по кнопке), а не со
     слов человека, и «готов работать» складывается из статуса + документов +
     реквизитов. Правило считает бэкенд (routers/contractors.py: readiness), здесь
     только показываем: на этапе 6 то же правило будет блокировать выплату, и двух
     копий логики быть не должно.
     ТЗ и план этапов — _specs/samozanyatye/. */
  var CZ_STATE = {
    ok:      { label: 'Готов работать', cls: 'cz-ok' },
    problem: { label: 'Есть проблемы',  cls: 'cz-bad' },
    new:     { label: 'Не завершил',    cls: 'cz-new' },
    invited: { label: 'Приглашен',      cls: 'cz-wait' },
    blocked: { label: 'Заблокирован',   cls: 'cz-off' },
  };
  var CZ_DOCS = [
    ['contract', 'Договор оказания услуг'],
    ['pdn', 'Согласие на обработку персональных данных'],
    /* Соглашение об электронной подписи человек принимает в анкете, до договора:
       правила подписи кодом должны быть согласованы заранее, иначе подписать ими сам
       договор — слабая позиция в споре. Отметкой оператора не ставится и не снимается. */
    ['esign', 'Соглашение об электронной подписи'],
    ['nda', 'Соглашение о неразглашении'],
  ];
  /* Что человек принимает сам в анкете: у записи есть редакция текста, время и адрес —
     это доказательство, а не переключатель. Зеркало SELF_SIGNED_KINDS на бэке. */
  var CZ_SELF_DOCS = ['pdn', 'esign'];
  var CZ_DOC_ST = [['none', 'Не отправлен'], ['sent', 'Отправлен'], ['signed', 'Подписан']];
  var CZ_SOURCE = { invite: 'Приглашение', import: 'Импорт', migration: 'Миграция', manual: 'Заведен вручную' };
  /* Свежевыпущенные ссылки на анкету. Полный адрес приходит от сервера РОВНО один раз:
     в базе от него только хэш, подсмотреть его потом нельзя. Держим до перезагрузки
     страницы, чтобы оператор мог скопировать ссылку не только в момент выпуска. */
  var CZ_LINKS = {};
  /* То же самое для ссылок на кабинет (этап 3): она одноразовая и связывает телеграм
     человека с его карточкой, поэтому тоже показывается один раз. */
  var CZ_CAB = {};
  var CZ = { list: null, stats: null, err: '', q: '', filter: 'all', archived: false,
             openId: null, detail: {}, dirty: {}, busy: false, demo: false,
             // work[id] — что у человека сейчас: план на текущую неделю и активные
             // задания. Держим отдельно от карточки: это меняется чаще, чем ИНН
             work: {} };

  /* Запрос с человеческим текстом ошибки. Бэкенд отвечает {"detail": "..."} — там
     фраза для оператора («Этот ИНН уже заведен: Иванов»), а не код; показываем ее. */
  function czSend(path, method, body) {
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    return fetch(API + path + sep + 'k=' + encodeURIComponent(getKey()), {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        throw new Error((j && typeof j.detail === 'string' && j.detail) ||
          'Не удалось сохранить — попробуйте еще раз');
      });
    });
  }
  function czLoad(cb) {
    api('/admin/api/contractors' + (CZ.archived ? '?archived=1' : '')).then(function (r) {
      CZ.list = r.contractors || []; CZ.stats = r.stats || null; CZ.err = '';
      CZ.demo = !!r.demo_allowed;
      if (state.page === 'contractors') renderAll();
      if (cb) cb(true);
    }).catch(function (e) {
      if (e.message === '403') return;
      CZ.list = CZ.list || []; CZ.stats = CZ.stats || null;
      CZ.err = 'Не удалось загрузить исполнителей. Проверьте связь и обновите страницу.';
      if (state.page === 'contractors') renderAll();
      if (cb) cb(false);
    });
  }
  function czFind(id) {
    var l = CZ.list || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  /* Обновленную карточку кладем и в список, и в кэш открытой карточки — экран не
     должен показывать два разных состояния одного человека. */
  function czPut(c) {
    if (!c) return;
    CZ.detail[c.id] = CZ.detail[c.id] || {};
    CZ.detail[c.id].contractor = c;
    var l = CZ.list || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === c.id) { l[i] = c; return; }
  }

  function czRows() {
    var q = CZ.q.trim().toLowerCase();
    return (CZ.list || []).filter(function (c) {
      if (CZ.filter === 'ready' && c.state !== 'ok') return false;
      if (CZ.filter === 'prob' && c.state !== 'problem' && c.state !== 'blocked') return false;
      if (CZ.filter === 'new' && c.state !== 'new') return false;
      if (CZ.filter === 'inv' && c.state !== 'invited') return false;
      if (!q) return true;
      // телефон ищем и без разделителей: в CRM он записан с пробелами, в голове — цифрами
      var hay = [c.full_name, c.email, c.inn, c.phone, String(c.phone || '').replace(/[^\d+]/g, '')];
      return hay.some(function (v) { return String(v || '').toLowerCase().indexOf(q) !== -1; });
    });
  }

  function renderContractors(view) {
    if (CZ.list === null) { view.innerHTML = dashSkeleton(); czLoad(); return; }
    var s = CZ.stats || { total: 0, ready: 0, problem: 0, new: 0 };
    var rows = czRows();

    /* Статполосы здесь нет намеренно: те же три числа уже стоят в вердикте под
       заголовком и в фильтрах-чипах, а якорь экрана — список имен, ради которого его
       и открывают. Так же сделано на «Людях». */
    var quick =[['all', 'Все', s.total], ['ready', 'Готовы', s.ready],
                 ['prob', 'Нельзя платить', s.problem], ['new', 'Не завершили', s.new],
                 ['inv', 'Ждем анкету', s.invited || 0]]
      .map(function (f) {
        return '<button class="qchip' + (CZ.filter === f[0] ? ' on' : '') + '" data-cf="' + f[0] + '">' +
          f[1] + ' <span class="qn">' + f[2] + '</span></button>';
      }).join('');

    var body = CZ.err
      ? '<div class="empty">' + esc(CZ.err) + '</div>'
      : (!rows.length
        ? '<div class="empty">' + (CZ.q
            ? 'По запросу «' + esc(CZ.q) + '» никого не нашли. Проверьте написание или очистите поиск.'
            : (CZ.archived ? 'В архиве пусто.' : 'Здесь пока никого. Пригласите первого исполнителя — свои данные он заполнит сам, а вы увидите, можно ли ставить ему задания.')) + '</div>'
        : rows.map(czRow).join(''));

    view.innerHTML =
      '<div class="card listcard">' +
        '<div class="list-tools">' +
          '<div class="searchwrap' + (CZ.q ? ' has-val' : '') + '">' + ic('search', 16) +
            '<input class="search" id="cz-q" placeholder="Поиск по имени, телефону, почте или ИНН" value="' + esc(CZ.q) + '">' +
            (CZ.q ? '<button class="s-clear" id="cz-qx">' + ic('x', 13) + '</button>' : '') +
          '</div>' +
          '<button class="cdd' + (CZ.archived ? ' active' : '') + '" id="cz-arch">' +
            (CZ.archived ? 'Архив' : 'В работе') + '</button>' +
          '<span class="list-count"><b>' + rows.length + '</b> из ' + (CZ.list || []).length + '</span>' +
          /* Демо-карточка — способ пройти всю цепочку до выплаты, не трогая живых
             людей: у выдуманного ИНН налоговая статус не подтвердит. В бою ручки нет,
             поэтому и кнопки там нет. */
          (CZ.demo ? '<button class="cdd" id="cz-demo-new">Демо-исполнитель</button>' : '') +
          '<button class="bp sm cz-add" id="cz-add">' + ic('send', 14) + 'Пригласить исполнителя</button>' +
        '</div>' +
        '<div class="list-quick">' + quick + '</div>' +
        '<div class="trow cz-grid thead">' +
          '<span class="th">Исполнитель</span><span class="th">ИНН</span>' +
          '<span class="th">Готовность</span><span class="th">Что мешает работать</span>' +
          '<span class="th r">Документы</span><span class="th"></span>' +
        '</div>' + body +
      '</div>';

    var qi = el('cz-q');
    if (qi) {
      qi.addEventListener('input', function () { CZ.q = qi.value; czRepaintList(); });
      qi.addEventListener('keydown', function (e) { if (e.key === 'Escape') { CZ.q = ''; renderView(); } });
    }
    var qx = el('cz-qx');
    if (qx) qx.addEventListener('click', function () { CZ.q = ''; renderView(); });
    var arch = el('cz-arch');
    if (arch) arch.addEventListener('click', function () {
      CZ.archived = !CZ.archived; CZ.list = null; renderView();
    });
    el('cz-add').addEventListener('click', openInviteCz);
    var dn = el('cz-demo-new');
    if (dn) dn.addEventListener('click', function () {
      czSend('/admin/api/contractors/demo', 'POST')
        .then(function (r) {
          czLoad(function () { openCz(r.contractor.id); });
          showToast('Демо-исполнитель готов — данные выдуманные');
        })
        .catch(function (e) { showToast(e.message); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-cf]'), function (b) {
      b.addEventListener('click', function () { CZ.filter = b.getAttribute('data-cf'); renderView(); });
    });
    czBindRows(view);
    pageAnim(view);
  }
  /* Перерисовка только строк: поиск не должен ронять фокус из инпута */
  function czRepaintList() {
    var host = el('view');
    if (!host) return;
    var card = host.querySelector('.listcard');
    if (!card) return;
    var rows = czRows();
    Array.prototype.forEach.call(card.querySelectorAll('.trow:not(.thead)'), function (n) { n.remove(); });
    var emptyOld = card.querySelector('.empty');
    if (emptyOld) emptyOld.remove();
    card.insertAdjacentHTML('beforeend', rows.length ? rows.map(czRow).join('')
      : '<div class="empty">По запросу «' + esc(CZ.q) + '» никого не нашли. Проверьте написание или очистите поиск.</div>');
    var cnt = card.querySelector('.list-count');
    if (cnt) cnt.innerHTML = '<b>' + rows.length + '</b> из ' + (CZ.list || []).length;
    czBindRows(card);
  }
  function czBindRows(host) {
    Array.prototype.forEach.call(host.querySelectorAll('[data-cz]'), function (r) {
      r.addEventListener('click', function () { openCz(r.getAttribute('data-cz')); });
    });
  }
  // Телефон в списке приводим к одному виду: часть номеров заведена руками с
  // пробелами, часть пришла из анкеты сплошными цифрами — вперемешку столбец
  // выглядит как две разные системы.
  function czPhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return '+7 ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9);
    }
    return raw || '';
  }

  function czRow(c) {
    var st = CZ_STATE[c.state] || CZ_STATE.new;
    // В списке показываем подписанные документы, а не доход: выплаты пойдут через
    // платформу только с этапа 6, до тех пор столбец был бы из одних нулей. Счетчик
    // дохода и шкала к лимиту 2,4 млн живут в карточке.
    var docs = c.docs || [];
    var signed = docs.filter(function (x) { return x.status === 'signed'; }).length;
    // Показываем первую помеху и счетчик остальных: одна строка не должна создавать
    // впечатление, что до работы человеку остался один шаг, если их три.
    var more = c.problems && c.problems.length > 1
      ? '<span class="cz-more">и еще ' + (c.problems.length - 1) + '</span>' : '';
    // «Ждем анкету» — не проблема, а ожидание: красным его красить нельзя, иначе
    // приглашенный человек выглядит как сорванная выплата
    var pcls = c.state === 'ok' ? '' : c.state === 'invited' ? ' wait' : ' on';
    var problem = c.problems && c.problems.length
      ? '<span class="cz-prob' + pcls + '">' + esc(c.problems[0]) + more + '</span>'
      : '<span class="cz-fine">ничего, можно ставить задания</span>';
    return '<div class="trow cz-grid' + (c.state === 'problem' || c.state === 'blocked' ? ' r-crit' : '') + '" data-cz="' + esc(c.id) + '">' +
      '<div class="t-cell"><div class="t-ttl">' + esc(c.full_name) + '</div>' +
        '<div class="t-sub">' + esc(czPhone(c.phone) || c.email || 'контакты не указаны') + '</div>' +
        // на узком экране колонка «что мешает» не помещается — та же строка уезжает
        // под имя, иначе на телефоне остаются одни многоточия
        '<div class="t-sub cz-mobprob' + pcls + '">' +
          (c.problems && c.problems.length ? esc(c.problems[0]) + more : 'можно ставить задания') + '</div></div>' +
      '<div class="cz-inn num">' + esc(c.inn || '—') + '</div>' +
      '<div><span class="sev ' + st.cls + '">' + st.label + '</span></div>' +
      '<div class="cz-cell">' + problem + '</div>' +
      '<div class="cz-docs' + (signed === docs.length && docs.length ? ' full' : '') + '">' +
        '<span class="num">' + signed + '</span> из ' + (docs.length || 3) + '</div>' +
      '<div class="t-go">' + ic('go', 13) + '</div></div>';
  }

  /* ── карточка исполнителя ─────────────────────────────────────────────────
     Одна прокручиваемая карточка, без вкладок: данных немного, а листать вкладки
     ради трех полей — лишняя работа руками. Правки копятся в CZ.dirty и уходят
     одним PATCH по кнопке: молча сохранять реквизиты и ИНН нельзя. */
  function openCz(id) {
    CZ.openId = id;
    CZ.dirty = {};
    el('mbg').classList.add('open');
    el('modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCzCard();
    if (!CZ.detail[id]) {
      api('/admin/api/contractors/' + id).then(function (r) {
        CZ.detail[id] = r;
        if (CZ.openId === id) renderCzCard();
      }).catch(function () {
        if (CZ.openId === id) { closeCz(); showToast('Не удалось открыть карточку'); }
      });
    }
    czWorkLoad(id);
  }
  /* Что у человека сейчас: план на текущую неделю и задания в работе. Два запроса, а не
     одно поле в карточке, — потому что это две разные сущности и живут они по своим
     правилам (план без денег, задание с деньгами). Не загрузилось — блок молчит, а не
     врет пустотой: карточка нужна и без него. */
  function czWorkLoad(id) {
    var w = { plan: null, tasks: null, err: false };
    CZ.work[id] = CZ.work[id] || w;
    w = CZ.work[id];
    var done = function () { if (CZ.openId === id) renderCzCard(); };
    api('/admin/api/contractor-plans?period=week&contractor_id=' + encodeURIComponent(id))
      .then(function (r) { w.plan = (r.plans && r.plans[0]) || false; done(); })
      .catch(function () { w.err = true; done(); });
    api('/admin/api/contractor-tasks?tab=active&contractor_id=' + encodeURIComponent(id))
      .then(function (r) { w.tasks = r.tasks || []; done(); })
      .catch(function () { w.err = true; done(); });
  }
  function closeCz() {
    CZ.openId = null; CZ.dirty = {};
    el('mbg').classList.remove('open');
    el('modal').classList.remove('open');
    document.body.style.overflow = '';
  }
  var CZ_MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  /* ГГГГ-ММ-ДД → «2 апреля 2026»: в поле ввода дата остается машинной, а глазами
     человек читает обычную. */
  function czDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return iso || '—';
    return Number(m[3]) + ' ' + CZ_MON[Number(m[2]) - 1] + ' ' + m[1];
  }
  function czRow2(k, v) {
    return '<div class="r"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>';
  }
  /* Паспорт одной строкой: номер моноширинным, дата словами. Отдельными строками
     «серия», «номер», «дата» карточка превратилась бы в анкету, а читают их вместе. */
  function czPassport(c) {
    if (!c.passport_no) return '—';
    return '<span class="num">' + esc(c.passport_no) + '</span>' +
      (c.passport_issued_at ? ' · выдан ' + esc(czDate(c.passport_issued_at)) : '');
  }
  /* Поля карточки — на общем рецепте формы (.al-f/.al-l/.al-in), том же, что в форме
     заведения: третьего рецепта инпута в системе быть не должно. */
  function czField(f, label, val, ph, type) {
    return '<label class="al-f"><span class="al-l">' + esc(label) + '</span>' +
      '<input class="al-in" type="' + (type || 'text') + '" data-f="' + f + '" ' +
      'value="' + esc(val == null ? '' : val) + '" ' +
      'placeholder="' + esc(ph || '') + '" autocomplete="off"></label>';
  }
  /* История смены счета. Первая запись из анкеты — это не «смена», ее не показываем:
     блок должен отвечать на вопрос «счет меняли?», а не повторять то, что уже видно
     строкой выше. С этапа 6 по этим цифрам пойдут деньги, и на вопрос «кто поменял»
     ответ должен быть в системе, а не в переписке. */
  function czPayHist(list) {
    var ch = (list || []).filter(function (p) { return p.source === 'change'; });
    if (!ch.length) return '';
    return '<div class="cz-pay-h"><div class="cz-pay-t">Счет меняли</div>' +
      ch.slice(0, 5).map(function (p) {
        return '<div class="cz-pay-r"><span class="num">' +
          (p.prev_tail ? '····' + esc(p.prev_tail) + ' → ' : '') +
          '····' + esc(p.account_tail || '') + '</span>' +
          '<span class="cz-pay-d">' + fmtWhen(p.created_at) + ' · сам исполнитель' +
          (p.bank ? ' · ' + esc(p.bank) : '') + '</span></div>';
      }).join('') + '</div>';
  }

  function renderCzCard() {
    var modal = el('modal');
    var id = CZ.openId;
    if (!modal || !id) return;
    var d = CZ.detail[id];
    var c = (d && d.contractor) || czFind(id);
    if (!c) {
      modal.innerHTML = '<div class="m-navfloat"><button class="m-arrow" id="cz-x">' + ic('x', 14) + '</button></div>' +
        '<div class="m-load">Открываем карточку…</div>';
      el('cz-x').addEventListener('click', closeCz);
      return;
    }
    var st = CZ_STATE[c.state] || CZ_STATE.new;
    var checks = (d && d.checks) || [];
    var pays = (d && d.pay_changes) || [];
    var cab = (d && d.cabinet) || null;
    var docs = {};
    (c.docs || []).forEach(function (x) { docs[x.kind] = x; });

    /* 1. Готовность — главный ответ экрана: можно ли ставить задание и платить */
    var readiness = '<div class="cz-ready ' + st.cls + '">' +
      '<div class="cz-ready-t">' + st.label + '</div>' +
      (c.problems && c.problems.length
        ? '<ul class="cz-plist">' + c.problems.map(function (p) {
            return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
        : '<div class="cz-ready-s">Статус в налоговой подтвержден, документы подписаны, реквизиты есть — можно ставить задания.</div>') +
      '</div>';

    /* 2. Ссылка на анкету. Для приглашенного это единственное действие оператора,
       поэтому у него блок стоит сразу под вердиктом; у заполнившего — в конце, рядом
       с данными, которые по этой ссылке и приехали. Полный адрес показывается ровно
       один раз (в базе только хэш) — об этом честно написано в блоке. */
    var inv = c.invite;
    var link = CZ_LINKS[id];
    var invAlive = inv && inv.state === 'active';
    // Живая ссылка бывает двух видов, и ждем мы по ним разного: анкету целиком или
    // только новый счет. Одна формулировка на оба случая врала бы в одном из них.
    var payWait = invAlive && inv.kind === 'payment';
    var invSays = payWait
      ? 'Ждем новые реквизиты. Ссылка действует до ' + czDate(inv.expires_at) + '. ' +
        (inv.opened_at ? 'Ссылку открывали ' + fmtWhen(inv.opened_at) + '.'
                       : 'Ссылку еще ни разу не открывали — возможно, стоит напомнить.') +
        ' До этого выплаты идут на прежний счет.'
      : c.submitted_at
      ? 'Анкету заполнили ' + fmtWhen(c.submitted_at) + ', ссылка погашена. ' +
        'Нужно исправить данные — выпустите новую: править ИНН и реквизиты за человека мы не можем.'
      : invAlive
        ? 'Ждем анкету. Ссылка действует до ' + czDate(inv.expires_at) + '. ' +
          (inv.opened_at ? 'Ссылку открывали ' + fmtWhen(inv.opened_at) + '.'
                         : 'Ссылку еще ни разу не открывали — возможно, стоит напомнить.')
        : 'Действующей ссылки нет' +
          (inv && inv.state === 'expired' ? ': истек срок' :
           inv && inv.state === 'revoked' ? ': вы ее отозвали' : '') +
          '. Выпустите новую — придет на смену старой.';
    var invite = '<div class="m-sec"><div class="m-sec-h">' +
        (payWait ? 'Ссылка на смену реквизитов' : 'Ссылка на анкету') +
        '<button class="hr" id="cz-reinv" data-kind="' + (payWait ? 'pay' : 'full') + '">' +
          (invAlive ? 'Выпустить заново' : 'Выпустить ссылку') + '</button>' +
        (invAlive ? '<button class="hr mute" id="cz-revoke">Отозвать</button>' : '') +
      '</div>' +
      '<div class="cz-inv"><div class="cz-inv-s">' + esc(invSays) + '</div>' +
      (link
        ? '<div class="cz-inv-l"><span class="cz-inv-u">' + esc(link) + '</span>' +
            '<button class="hr" id="cz-copy">' + ic('copy', 13) + 'Скопировать</button></div>' +
          '<div class="cz-inv-h">Отправьте человеку любым способом — в телеграм, ватсап или смс. ' +
            'Адрес показывается один раз: закроете карточку — придется выпускать заново.</div>'
        : '') +
      '</div></div>';

    /* 2а. Кабинет исполнителя. Отвечает на один вопрос оператора: ждать действий от
       человека или по-прежнему отмечать его шаги за него. Пока анкеты нет — блока нет:
       кабинет открывать некому. Ссылка одноразовая и связывает телеграм с карточкой,
       поэтому показывается один раз, как и приглашение. */
    var cabLink = CZ_CAB[id];
    var cabinet = !c.submitted_at ? '' :
      '<div class="m-sec"><div class="m-sec-h">Кабинет исполнителя' +
        /* Демо-карточку можно открыть сразу: у выдуманного человека нет ни телеграма,
           ни почты, письмо с кодом ушло бы в никуда. За живого исполнителя так зайти
           нельзя — сервер отвечает отказом, он входит сам. */
        (c.source === 'demo'
          ? '<button class="hr" id="cz-demo">Открыть кабинет</button>' : '') +
        '<button class="hr" id="cz-cab">' +
          (cab && cab.tg_bound ? 'Ссылка на кабинет заново' : 'Ссылка на кабинет') +
        '</button></div>' +
      '<div class="cz-inv"><div class="cz-inv-s">' +
        (!cab
          ? 'Смотрим…'
          : cab.tg_bound
            ? 'Телеграм привязан, человек заходит кнопкой в боте' +
              (cab.last_seen_at ? '. Был в кабинете ' + fmtWhen(cab.last_seen_at) + '.'
                                : '. В кабинет пока не заходил.')
            : cab.last_seen_at
              ? 'Заходит по коду на почту, телеграм не привязан. Был ' +
                fmtWhen(cab.last_seen_at) + '.'
              : 'Кабинетом еще не пользовался — отправьте ссылку, и его шаги будет ' +
                'ставить он сам, а не мы за него.') +
        (cab && cab.link_alive_until && !cabLink
          ? ' Действующая ссылка есть, до ' + czDate(cab.link_alive_until) + '.' : '') +
      '</div>' +
      (cabLink
        ? '<div class="cz-inv-l"><span class="cz-inv-u">' + esc(cabLink.url) + '</span>' +
            '<button class="hr" id="cz-cabcopy">' + ic('copy', 13) + 'Скопировать</button></div>' +
          '<div class="cz-inv-h">' +
            (cabLink.tg_url ? 'Для телеграма: ' + esc(cabLink.tg_url) + '. ' : '') +
            'Ссылка одноразовая: она не открывает доступ сама по себе, а связывает ' +
            'телеграм того, кто ее откроет, с этой карточкой. Дальше он заходит без нее.' +
          '</div>'
        : '') +
      '</div></div>';

    /* 2б. Учетка в CRM. Преподаватели и кураторы — наши сотрудники и одновременно
       самозанятые: связав карточку с их логином, мы открываем им раздел «Моя работа»
       вместо второго входа. Связь одна к одному — иначе под подписью в акте не понять,
       кто из двоих нажал. Подрядчику со стороны учетку не заводим вовсе: в CRM лиды,
       детские анкеты и деньги, ему хватает внешнего кабинета. */
    var lu = d && d.linked_user;
    var team = (d && d.team) || [];
    var teamOpts = '<option value="">— выберите сотрудника —</option>' +
      team.map(function (u) {
        return '<option value="' + esc(u.login) + '">' + esc(u.name || u.login) +
          ' · ' + esc(u.login) + '</option>';
      }).join('');
    var linkSec = '<div class="m-sec"><div class="m-sec-h">Учетка в CRM' +
        (lu ? '<button class="hr mute" id="cz-unlink">Отвязать</button>' : '') +
      '</div>' +
      (lu
        ? '<div class="cz-inv"><div class="cz-inv-s"><b>' + esc(lu.name || lu.login) + '</b> · ' +
            esc(lu.login) + '</div>' +
          '<div class="cz-inv-h">У человека в CRM открыт раздел «Моя работа»: свои задания, ' +
            'план и акты. Отдельный кабинет по ссылке ему не нужен.</div></div>'
        : '<div class="cz-inv"><div class="cz-inv-s">Не связана. Если это наш сотрудник ' +
            'с логином в CRM, свяжите — и свои задания он будет вести здесь, без второго входа.</div>' +
          '<div class="cz-link-row"><span class="al-selwrap"><select id="cz-user" class="al-sel">' +
            teamOpts + '</select></span>' +
            '<button class="bp sm ghost" id="cz-link">Связать</button></div></div>') +
    '</div>';

    /* 3. Налоговый статус — откуда цифра и когда смотрели */
    var checked = c.npd_checked_at ? fmtWhen(c.npd_checked_at) : 'ни разу';
    var npdChip = c.npd_status === 'active' ? '<span class="sev cz-ok">Плательщик НПД</span>'
      : c.npd_status === 'inactive' ? '<span class="sev cz-bad">Статуса нет</span>'
      : '<span class="sev cz-new">Не проверяли</span>';
    /* История — отдельная секция, а не подзаголовок внутри статуса: капс-микролейбл в
       системе один уровень иерархии, второй такой же внутри секции читается как соседняя. */
    var history = '<div class="m-sec"><div class="m-sec-h">История проверок</div>' + (checks.length
      ? '<div class="cz-hist">' + checks.slice(0, 6).map(function (ch) {
          var cls = ch.status === 'active' ? 'ok' : ch.status === 'inactive' ? 'bad' : 'mute';
          return '<div class="cz-h ' + cls + '"><span class="cz-h-t">' + esc(ch.message || '') + '</span>' +
            '<span class="cz-h-d">' + fmtWhen(ch.created_at) +
            // откуда пришла проверка: сам человек в анкете, утренний обход или кнопка
            (ch.source === 'auto' ? ' · автоматически'
              : ch.source === 'invite' ? ' · из анкеты' : ' · вручную') + '</span></div>';
        }).join('') + '</div>'
      : '<div class="field-empty">Проверок еще не было.</div>') + '</div>';

    /* Счетчик дохода к лимиту самозанятого. Выплаты пойдут через платформу на этапе 6 —
       до первой из них секции просто нет: заголовок с пустотой под ним не сообщает
       ничего, а место в карточке занимает. */
    var lim = c.income_limit || 2400000;
    var money = (c.income_year || 0) > 0
      ? '<div class="m-sec"><div class="m-sec-h">Доход через нас за год</div>' +
          '<div class="cz-year">' +
          '<div class="cz-year-v num">' + fmtMoney(c.income_year) + ' ₽</div>' +
          '<div class="strack wide"><i style="width:' +
            Math.min(100, Math.round(c.income_year / lim * 100)) + '%"></i></div>' +
          '<div class="cz-year-s">из ' + fmtMoney(lim) + ' ₽ — лимит самозанятого на год. ' +
            'Считаем только то, что выплатили через платформу.</div></div></div>'
      : '';

    /* Что у человека сейчас. Обе стороны рядом и по-прежнему раздельно: слева от глаз
       оператора план (чем занят), справа задания (за что платим). Приглашенному, который
       еще не заполнил анкету, блок не показываем — работы у него быть не может. */
    // null — «еще грузим», false/[] — «пусто». Первый рендер идет до запроса, и без
    // явного null пустой объект читался бы как «данных нет».
    var work = CZ.work[id] || { plan: null, tasks: null };
    var wplan = work.plan, wtasks = work.tasks;
    var planBlock = '';
    // Работа есть — показываем всегда, даже если карточка не дозаполнена: скрыть
    // существующие задания и план значит соврать. Прячем блок только у того, кому мы
    // еще ничего не поручали и кто не заполнял анкету.
    var hasWork = (wplan && wplan.items && wplan.items.length) || (wtasks && wtasks.length);
    if (c.submitted_at || hasWork) {
      var pit = wplan && wplan.items ? wplan.items : [];
      planBlock =
        '<div class="m-sec"><div class="m-sec-h">План на эту неделю' +
          '<button class="hr" id="cz-goplans">Открыть планы</button></div>' +
          (wplan === null
            ? '<div class="field-empty">Загружаем…</div>'
            : !pit.length
              ? '<div class="field-empty">На эту неделю плана нет. План — это то, чем человек занят; ' +
                'деньги идут отдельно, за задания.</div>'
              : '<div class="cz-work">' + pit.map(function (it) {
                  return '<div class="cz-w' + (it.done ? ' done' : '') + '">' +
                    '<span class="cz-w-t">' + esc(it.title) + '</span>' +
                    (it.task_id ? '<span class="cz-w-n">№' + it.task_number + '</span>'
                                : (it.due ? '<span class="cz-w-d">' + esc(czDate(it.due)) + '</span>' : '')) +
                  '</div>';
                }).join('') + '</div>') +
        '</div>' +
        '<div class="m-sec"><div class="m-sec-h">Задания в работе</div>' +
          (wtasks === null
            ? '<div class="field-empty">Загружаем…</div>'
            : !wtasks.length
              ? '<div class="field-empty">Активных заданий нет.</div>'
              : '<div class="cz-work">' + wtasks.map(function (t) {
                  return '<div class="cz-w link" data-goct="' + t.id + '">' +
                    '<span class="cz-w-n">№' + t.number + '</span>' +
                    '<span class="cz-w-t">' + esc(t.title) + '</span>' +
                    '<span class="ct-chip ' + (CT_ST[t.status] || 'ct-draft') + '">' +
                      esc(t.status_title) + '</span>' +
                    '<span class="cz-w-s num">' + ctMoney(t.amount) + ' ₽</span>' +
                  '</div>';
                }).join('') + '</div>') +
        '</div>';
    }

    var docRows = CZ_DOCS.map(function (dk) {
      var d0 = docs[dk[0]] || {};
      var cur = d0.status || 'none';
      /* Принятое в анкете переключателем не снимается: у записи есть версия текста,
         время и адрес — это и есть доказательство. Кнопка «не отправлен» стерла бы его
         молча, поэтому здесь стоит отметка, а не сегмент. */
      var byPerson = CZ_SELF_DOCS.indexOf(dk[0]) !== -1 && d0.version;
      return '<div class="cz-doc"><span class="cz-doc-n">' + esc(dk[1]) + '</span>' +
        (byPerson
          ? '<span class="cz-doc-fixed"><span class="sev cz-ok">Принято в анкете</span>' +
            (d0.signed_at ? '<span class="cz-doc-when">' + fmtWhen(d0.signed_at) + '</span>' : '') +
            '</span>'
          /* сегмент — общий системный рецепт .pay-seg: та же логика «три состояния,
             последнее хорошее», активное красится через data-v */
          : '<span class="pay-seg">' + CZ_DOC_ST.map(function (o) {
              return '<button class="' + (cur === o[0] ? 'on' : '') + '" data-v="' + o[0] + '"' +
                ' data-doc="' + dk[0] + '" data-st="' + o[0] + '">' + o[1] + '</button>';
            }).join('') + '</span>') + '</div>';
    }).join('');

    modal.classList.remove('pchat-open');
    modal.innerHTML =
      '<div class="m-head">' +
        '<div class="m-navfloat"><button class="m-arrow" id="cz-x">' + ic('x', 14) + '</button></div>' +
        '<div class="m-ava">' + esc(initials(c.full_name)) + '</div>' +
        '<div class="m-id"><div class="m-name-row"><div class="m-name cz-name">' + esc(c.full_name) + '</div></div>' +
          /* Подстрочник шапки говорит то, что уместно сейчас: у приглашенного нет ни
             ИНН, ни проверок, и строка «ИНН не указан · проверен: ни разу» читалась бы
             упреком человеку, который еще даже не открывал анкету. */
          '<div class="m-sub"><span class="sev ' + st.cls + '">' + st.label + '</span>' +
            (c.inn
              ? '<span class="dot-sep"></span><span>ИНН ' + esc(c.inn) + '</span>' +
                '<span class="dot-sep"></span><span>проверен в налоговой: ' + esc(checked) + '</span>'
              : '<span class="dot-sep"></span><span>' +
                (c.state === 'invited' ? 'ссылка на анкету отправлена' : 'ИНН не указан') + '</span>') +
          '</div></div>' +
      '</div>' +
      '<div class="m-body"><div class="m-content" id="cz-content">' +
        readiness +
        (c.submitted_at ? '' : invite) +
        (c.inn
          ? '<div class="m-sec"><div class="m-sec-h">Статус в налоговой' +
              '<button class="hr" id="cz-check">Проверить сейчас</button></div>' +
              '<div class="ab">' + czRow2('Сейчас', npdChip) +
                czRow2('Тип занятости', c.employment === 'other' ? 'Другой' : 'Самозанятый') +
                czRow2('Подключен', c.connected_at ? esc(czDate(c.connected_at)) : '—') +
                czRow2('Источник', esc(CZ_SOURCE[c.source] || c.source || '—')) + '</div>' +
            '</div>' + history
          : '') +
        planBlock +
        money +
        /* Контакты ведем мы, ИНН и гражданство — нет: их человек указал в анкете.
           Поэтому одни поля вводимые, другие показаны строками. Разная форма здесь
           не украшение, а сообщение «это не твое поле». */
        '<div class="m-sec"><div class="m-sec-h">Основное</div><div class="cz-form">' +
          czField('full_name', 'ФИО', c.full_name, 'Как в паспорте') +
          czField('job', 'Должность', c.job, 'Ассистент, СММ, Видео, Кураторство') +
          czField('phone', 'Телефон', c.phone, '+7 900 000-00-00') +
          czField('email', 'Почта', c.email, 'name@mail.ru') +
          czField('connected_at', 'Дата подключения', c.connected_at, '', 'date') +
        '</div>' +
          /* Должность — не ярлык для списка: от нее зависит перечень услуг в
             Приложении № 1 к договору этого человека (у ассистента и монтажера они
             разные). Пишем словами каталога услуг, чтобы не завести второй справочник
             тех же четырех слов. */
          '<div class="cz-src">Должность выбирает перечень услуг в Приложении № 1 к его ' +
            'договору. Пишите так же, как названа категория в разделе «Услуги».</div>' +
        '</div>' +
        '<div class="m-sec"><div class="m-sec-h">Данные исполнителя' +
            // Счет меняется в жизни чаще всего (сменил банк), и менять его должен сам
            // человек. Кнопка стоит здесь, рядом с реквизитами, а не в общем блоке
            // ссылок: оператор ищет ее там, где увидел устаревший счет.
            (c.submitted_at && !payWait
              ? '<button class="hr" id="cz-payinv">Запросить новые реквизиты</button>' : '') +
          '</div>' +
          (c.submitted_at
            ? '<div class="ab">' + czRow2('ИНН', '<span class="num">' + esc(c.inn || '—') + '</span>') +
                czRow2('Гражданство', esc(c.citizenship || '—')) +
                czRow2('Паспорт', czPassport(c)) +
                czRow2('Кем выдан', esc(c.passport_issued_by || '—') +
                  (c.passport_dept ? ' · код ' + esc(c.passport_dept) : '')) +
                czRow2('Адрес регистрации', esc(c.reg_address || '—')) +
                czRow2('Счет', '<span class="num">' + esc(c.pay_account || '—') + '</span>') +
                czRow2('БИК', '<span class="num">' + esc(c.pay_bic || '—') + '</span>') +
                czRow2('Банк', esc(c.pay_bank || '—')) +
                (c.pay_corr ? czRow2('Корр. счет', '<span class="num">' + esc(c.pay_corr) + '</span>') : '') +
                czRow2('Получатель', esc(c.pay_receiver || c.full_name)) + '</div>' +
              '<div class="cz-src">Заполнил сам исполнитель ' + fmtWhen(c.submitted_at) +
                '. Мы эти поля не правим: ИНН и счет — его данные и его ответственность.</div>' +
              czPayHist(pays)
            : '<div class="field-empty">Человек еще не заполнил анкету — ИНН и реквизитов у нас нет. ' +
              'Вписать их за него мы не можем: согласие на обработку данных дает он сам.</div>') +
        '</div>' +
        (c.submitted_at ? invite : '') +
        linkSec +
        cabinet +
        '<div class="m-sec"><div class="m-sec-h">Документы</div>' + docRows + '</div>' +
        '<div class="m-sec"><div class="m-sec-h">Заметка</div>' +
          '<textarea class="al-in al-ta" data-f="note" rows="3" placeholder="Что важно помнить об этом человеке">' + esc(c.note || '') + '</textarea>' +
        '</div>' +
      '</div></div>' +
      '<div class="m-foot cz-foot">' +
        (c.blocked
          ? '<button class="m-archive" id="cz-unblock">' + ic('check', 14) + 'Снять блокировку</button>'
          : '<button class="m-archive" id="cz-block">' + ic('alert', 14) + 'Заблокировать</button>') +
        (c.archived
          ? '<button class="m-archive" id="cz-restore">' + ic('refresh', 14) + 'Вернуть из архива</button>'
          : '<button class="m-archive" id="cz-arch2">' + ic('x', 14) + 'В архив</button>') +
        '<button class="bp cz-save" id="cz-save" disabled>Сохранить</button>' +
      '</div>';

    el('cz-x').addEventListener('click', closeCz);
    var chk = el('cz-check');
    if (chk) chk.addEventListener('click', czCheckNow);
    el('cz-save').addEventListener('click', czSave);
    el('cz-reinv').addEventListener('click', function (ev) {
      if (ev.currentTarget.getAttribute('data-kind') === 'pay') return czPayInvite(id);
      if (c.submitted_at && !window.confirm(
        'Выпустить новую ссылку? Человек заполнит анкету заново, прежние ИНН и реквизиты ' +
        'останутся до тех пор, пока он не пришлет новые.')) return;
      czReinvite(id);
    });
    var pi = el('cz-payinv');
    if (pi) pi.addEventListener('click', function () { czPayInvite(id); });
    var gp = el('cz-goplans');
    if (gp) gp.addEventListener('click', function () {
      closeCz(); setPage('czplans');
    });
    // из карточки человека — в само задание: модалка та же, меняется содержимое
    Array.prototype.forEach.call(modal.querySelectorAll('[data-goct]'), function (r) {
      r.addEventListener('click', function () {
        var tid = r.getAttribute('data-goct');
        closeCz(); openCt(tid);
      });
    });
    var rv = el('cz-revoke');
    if (rv) rv.addEventListener('click', function () {
      if (window.confirm('Погасить ссылку? Человек больше не сможет открыть анкету, пока вы не выпустите новую.')) czRevoke(id);
    });
    var cp = el('cz-copy');
    if (cp) cp.addEventListener('click', function () { copyText(link, cp); });
    var cb = el('cz-cab');
    if (cb) cb.addEventListener('click', function () { czCabinetLink(id); });
    var cbd = document.getElementById('cz-demo');
    if (cbd) cbd.addEventListener('click', function () { czDemoCabinet(id); });
    var cbc = el('cz-cabcopy');
    if (cbc) cbc.addEventListener('click', function () {
      copyText((CZ_CAB[id] && (CZ_CAB[id].tg_url || CZ_CAB[id].url)) || '', cbc);
    });
    var lk = el('cz-link');
    if (lk) lk.addEventListener('click', function () {
      var login = el('cz-user').value;
      if (!login) return showToast('Выберите сотрудника');
      czLinkUser(id, login);
    });
    var ulk = el('cz-unlink');
    if (ulk) ulk.addEventListener('click', function () {
      if (window.confirm('Отвязать учетку? Раздел «Моя работа» у человека пропадет, ' +
                         'а задания и акты останутся на месте.')) czLinkUser(id, null);
    });
    Array.prototype.forEach.call(modal.querySelectorAll('[data-f]'), function (inp) {
      inp.addEventListener('input', function () {
        var f = inp.getAttribute('data-f');
        var was = c[f] == null ? '' : String(c[f]);
        if (inp.value === was) delete CZ.dirty[f]; else CZ.dirty[f] = inp.value;
        var save = el('cz-save');
        if (save) save.disabled = !Object.keys(CZ.dirty).length;
      });
    });
    Array.prototype.forEach.call(modal.querySelectorAll('[data-doc]'), function (b) {
      b.addEventListener('click', function () {
        czSetDoc(id, b.getAttribute('data-doc'), b.getAttribute('data-st'));
      });
    });
    var bl = el('cz-block');
    if (bl) bl.addEventListener('click', function () {
      var why = window.prompt('Почему блокируем? Причину увидит тот, кто будет ее снимать.');
      if (why && why.trim()) czPatch(id, { blocked: true, blocked_reason: why.trim() });
    });
    var ub = el('cz-unblock');
    if (ub) ub.addEventListener('click', function () { czPatch(id, { blocked: false, blocked_reason: '' }); });
    var ar = el('cz-arch2');
    if (ar) ar.addEventListener('click', function () {
      if (window.confirm('Убрать исполнителя в архив? Данные и история останутся, вернуть можно в любой момент.')) czArchive(id, true);
    });
    var rs = el('cz-restore');
    if (rs) rs.addEventListener('click', function () { czArchive(id, false); });
  }
  function czAfter(res, msg) {
    var c = res && res.contractor;
    if (!c) return;
    czPut(c);
    CZ.dirty = {};
    renderCzCard();
    if (msg) showToast(msg);
    czLoad();
  }
  function czSave() {
    var id = CZ.openId;
    var save = el('cz-save');
    if (!id || !Object.keys(CZ.dirty).length) return;
    var body = {};
    Object.keys(CZ.dirty).forEach(function (f) {
      var v = String(CZ.dirty[f]).trim();
      body[f] = v === '' ? null : v;
    });
    if (save) { save.disabled = true; save.classList.add('loading'); }
    czSend('/admin/api/contractors/' + id, 'PATCH', body)
      .then(function (r) { czAfter(r, 'Сохранено'); })
      .catch(function (e) {
        if (save) { save.disabled = false; save.classList.remove('loading'); }
        showToast(e.message);
      });
  }
  /* Ссылку выпускаем и гасим только через сервер: он же и решает, что теперь считать
     действующим приглашением. Полный адрес приходит один раз — кладем его в CZ_LINKS,
     чтобы кнопка «Скопировать» работала, пока оператор не ушел со страницы. */
  function czReinvite(id) {
    czSend('/admin/api/contractors/' + id + '/invite', 'POST')
      .then(function (r) {
        if (r.invite && r.invite.url) CZ_LINKS[id] = r.invite.url;
        czAfter(r, 'Новая ссылка готова — скопируйте и отправьте');
      })
      .catch(function (e) { showToast(e.message); });
  }
  /* Смена счета — короткая ссылка вместо повторной анкеты. Сами реквизиты оператор не
     вводит и здесь: подмена счета — самый частый способ увода выплат, и «мне написали
     новый счет в чате» не должно становиться основанием платить в другое место. */
  function czPayInvite(id) {
    if (!window.confirm('Выпустить ссылку на смену реквизитов? ' +
      'Пока новый счет не пришлют, выплаты идут на прежний.')) return;
    czSend('/admin/api/contractors/' + id + '/pay-invite', 'POST')
      .then(function (r) {
        if (r.invite && r.invite.url) CZ_LINKS[id] = r.invite.url;
        czAfter(r, 'Ссылка готова — отправьте ее человеку');
      })
      .catch(function (e) { showToast(e.message); });
  }
  /* Ссылка на кабинет живет по тем же правилам, что и приглашение: сервер выдает полный
     адрес ровно один раз (в базе только хэш), поэтому держим его в памяти вкладки. */
  function czCabinetLink(id) {
    czSend('/admin/api/contractors/' + id + '/cabinet-link', 'POST')
      .then(function (r) {
        CZ_CAB[id] = r;
        // Ответ здесь — сама ссылка, а не карточка: перечитываем карточку сами, чтобы
        // подпись «действующая ссылка есть» не разъехалась с реальностью.
        api('/admin/api/contractors/' + id).then(function (full) {
          CZ.detail[id] = full;
          if (CZ.openId === id) renderCzCard();
        }).catch(function () { if (CZ.openId === id) renderCzCard(); });
        showToast('Ссылка на кабинет готова — отправьте человеку');
      })
      .catch(function (e) { showToast(e.message); });
  }
  /* Связать карточку исполнителя с учеткой сотрудника (раздел «Моя работа») или снять
     связь. Занятую карточку сервер вторым логином не отдаст, а прежнюю связь снимет
     сам — поэтому карточку после ответа перечитываем целиком, а не правим на экране. */
  function czLinkUser(id, login) {
    czSend('/admin/api/contractors/' + id + '/link-user', 'POST', { login: login })
      .then(function () {
        return api('/admin/api/contractors/' + id).then(function (full) {
          CZ.detail[id] = full;
          if (CZ.openId === id) renderCzCard();
        });
      })
      .then(function () {
        showToast(login ? 'Связали — у человека появился раздел «Моя работа»'
                        : 'Связь снята');
      })
      .catch(function (e) { showToast(e.message); });
  }
  /* Демо-вход в кабинет: сервер сам проверяет, что карточка демо-шная и что это не
     прод. Открываем новой вкладкой — оператор остается в CRM. */
  function czDemoCabinet(id) {
    czSend('/admin/api/contractors/' + id + '/demo-cabinet', 'POST')
      .then(function (r) {
        window.open(API + (r.path || '/cz') + '#t=' + r.token, '_blank', 'noopener');
      })
      .catch(function (e) { showToast(e.message); });
  }
  function czRevoke(id) {
    czSend('/admin/api/contractors/' + id + '/invite/revoke', 'POST')
      .then(function (r) { delete CZ_LINKS[id]; czAfter(r, 'Ссылка погашена'); })
      .catch(function (e) { showToast(e.message); });
  }
  function czPatch(id, body) {
    czSend('/admin/api/contractors/' + id, 'PATCH', body)
      .then(function (r) { czAfter(r, 'Сохранено'); })
      .catch(function (e) { showToast(e.message); });
  }
  function czArchive(id, on) {
    czSend('/admin/api/contractors/' + id + '/archive', 'POST', { archived: on })
      .then(function (r) {
        czPut(r.contractor);
        closeCz();
        CZ.list = null;
        showToast(on ? 'Исполнитель в архиве' : 'Исполнитель вернулся в работу');
        renderView();
      })
      .catch(function (e) { showToast(e.message); });
  }
  function czSetDoc(id, kind, st) {
    czSend('/admin/api/contractors/' + id + '/docs/' + kind, 'PATCH', { status: st })
      .then(function (r) { czAfter(r); })
      .catch(function (e) { showToast(e.message); });
  }
  function czCheckNow() {
    var id = CZ.openId;
    var btn = el('cz-check');
    if (!id || CZ.busy) return;
    CZ.busy = true;
    if (btn) btn.textContent = 'Спрашиваем налоговую…';
    czSend('/admin/api/contractors/' + id + '/npd-check', 'POST')
      .then(function (r) {
        CZ.busy = false;
        // историю перечитываем целиком: в ней появилась новая строка
        api('/admin/api/contractors/' + id).then(function (full) {
          CZ.detail[id] = full;
          czPut(full.contractor);
          renderCzCard();
          czLoad();
          // при отказе показываем ответ налоговой дословно: «не ответила» и
          // «ограничила частоту запросов» требуют разных действий от человека
          showToast(r.check && r.check.status === 'error'
            ? (r.check.message || 'Налоговая не ответила — попробуйте позже')
            : (r.contractor.npd_status === 'active' ? 'Статус подтвержден' : 'Статуса самозанятого нет'));
        });
      })
      .catch(function (e) {
        CZ.busy = false;
        if (btn) btn.textContent = 'Проверить сейчас';
        showToast(e.message);
      });
  }

  /* ── пригласить исполнителя ───────────────────────────────────────────────
     Заведения руками нет: ИНН, реквизиты и согласие на обработку данных за человека
     не заполняют. Оператор дает то, что знает сам, — имя и контакт, — и получает
     одноразовую ссылку на анкету. Полный адрес сервер показывает ровно один раз,
     поэтому вторым шагом диалога стоит не «готово», а сама ссылка с кнопкой копии. */
  function openInviteCz() {
    if (document.querySelector('.al-ov')) return;
    var ov2 = document.createElement('div');
    ov2.className = 'al-ov';
    ov2.innerHTML =
      '<div class="al-card" role="dialog" aria-modal="true">' +
        '<div class="al-head">' +
          '<div><div class="al-eyebrow">Самозанятые</div><div class="al-title">Пригласить исполнителя</div></div>' +
          '<button class="al-x" id="cza-x" title="Закрыть">' + ic('x', 16) + '</button>' +
        '</div>' +
        '<div class="al-sub">Вы даете имя и контакт — остальное человек заполнит сам по ссылке: ИНН, реквизиты и согласие на обработку данных. Вписывать это за него мы не имеем права.</div>' +
        '<div class="al-body">' +
          '<label class="al-f"><span class="al-l">ФИО <i>*</i></span>' +
            '<input id="cza-name" class="al-in" placeholder="Как обращаетесь к человеку" autocomplete="off" maxlength="120"></label>' +
          '<div class="al-row">' +
            '<label class="al-f"><span class="al-l">Телефон</span>' +
              '<input id="cza-phone" class="al-in" placeholder="+7 900 000-00-00" autocomplete="off" maxlength="30"></label>' +
            '<label class="al-f"><span class="al-l">Почта</span>' +
              '<input id="cza-mail" class="al-in" placeholder="name@mail.ru" autocomplete="off" maxlength="120"></label>' +
          '</div>' +
          '<label class="al-f"><span class="al-l">Заметка</span>' +
            '<textarea id="cza-note" class="al-in al-ta" rows="2" maxlength="500" placeholder="Что делает, откуда пришел, договоренности"></textarea></label>' +
        '</div>' +
        '<div class="al-foot">' +
          '<button class="al-cancel" id="cza-cancel">Отмена</button>' +
          '<button class="bp al-save" id="cza-save">' + ic('send', 14) + 'Выпустить ссылку</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov2);
    requestAnimationFrame(function () { ov2.classList.add('show'); });
    var closed = false;
    var close = function () {
      if (closed) return; closed = true;
      ov2.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (ov2.parentNode) ov2.parentNode.removeChild(ov2); }, 180);
    };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);
    el('cza-x').addEventListener('click', close);
    el('cza-cancel').addEventListener('click', close);
    ov2.addEventListener('mousedown', function (e) { if (e.target === ov2) close(); });
    var nameI = el('cza-name');
    setTimeout(function () { nameI.focus(); }, 30);
    var save = el('cza-save');
    var submit = function () {
      var name = (nameI.value || '').trim();
      if (!name) { nameI.classList.add('al-err'); nameI.focus(); return; }
      save.disabled = true; save.classList.add('loading');
      czSend('/admin/api/contractors/invite', 'POST', {
        full_name: name,
        phone: (el('cza-phone').value || '').trim() || null,
        email: (el('cza-mail').value || '').trim() || null,
        note: (el('cza-note').value || '').trim() || null,
      }).then(function (r) {
        var cid = r.contractor.id;
        CZ.list = null;
        CZ.detail[cid] = { contractor: r.contractor, checks: [] };
        if (r.invite && r.invite.url) CZ_LINKS[cid] = r.invite.url;
        showLink(cid, name, (r.invite && r.invite.url) || '');
        czLoad();
      }).catch(function (e) {
        save.disabled = false; save.classList.remove('loading');
        showToast(e.message);
      });
    };
    /* Второй шаг того же диалога: ссылка крупно и кнопка копии. Закрывать окно сразу
       нельзя — адрес больше нигде не появится, и оператор останется без него. */
    function showLink(cid, who, url) {
      ov2.querySelector('.al-card').innerHTML =
        '<div class="al-head">' +
          /* имя не склоняем — в заголовке «Ссылка для Иванова Мария» звучало бы косо;
             имя стоит отдельной строкой, где падеж не нужен */
          '<div><div class="al-eyebrow">Самозанятые · ' + esc(who) + '</div>' +
            '<div class="al-title">Ссылка готова</div></div>' +
          '<button class="al-x" id="czl-x" title="Закрыть">' + ic('x', 16) + '</button>' +
        '</div>' +
        '<div class="al-sub">Отправьте ее человеку — в телеграм, ватсап или смс. Он заполнит анкету сам, и карточка обновится. Ссылка одноразовая и действует неделю.</div>' +
        '<div class="al-body"><div class="cz-inv-l big"><span class="cz-inv-u">' + esc(url) + '</span></div>' +
          '<div class="cz-inv-h">Адрес показывается один раз: мы храним от него только отпечаток, подсмотреть потом нельзя. Потеряли — выпустите новую ссылку в карточке.</div>' +
        '</div>' +
        '<div class="al-foot">' +
          '<button class="al-cancel" id="czl-open">Открыть карточку</button>' +
          '<button class="bp al-save" id="czl-copy">' + ic('copy', 14) + 'Скопировать ссылку</button>' +
        '</div>';
      el('czl-x').addEventListener('click', close);
      el('czl-copy').addEventListener('click', function () { copyText(url, el('czl-copy')); });
      el('czl-open').addEventListener('click', function () { close(); openCz(cid); });
    }
    save.addEventListener('click', submit);
    nameI.addEventListener('input', function () { nameI.classList.remove('al-err'); });
    ov2.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); }
    });
  }

  /* ── ЗАДАНИЯ ИСПОЛНИТЕЛЯМ (модуль самозанятых, этап 2) ─────────────────────
     Задание — единица работы, за которую платят: что сделать, какой результат, срок,
     сумма. Из принятых заданий соберется акт, по акту пойдет выплата. Планы работ
     (дневные, недельные, месячные) — другая сущность: у их пунктов нет стоимости, в
     акт они не попадают. Смешать их нельзя не из аккуратности: ежедневные поручения
     в акте читаются как трудовая функция, и это прямой путь к переквалификации.

     Что здесь НЕ решается на экране: цепочка статусов, право менять сумму и заморозка
     после акта. Все это считает сервер (routers/contractor_tasks.py), а экран только
     показывает разрешенные действия — те же правила на этапах 5 и 6 будут решать,
     можно ли собрать акт и можно ли платить. */
  var CT = { list: null, stats: null, err: '', q: '', tab: 'all', openId: null,
             detail: {}, services: null, busy: false,
             // cat — весь каталог для экрана «Услуги» (вместе с выключенными),
             // services — только активные, для выбора при создании задания
             cat: null, catErr: '' };
  var CT_ST = {
    draft: 'ct-draft', offered: 'ct-wait', accepted: 'ct-go', in_progress: 'ct-go',
    done: 'ct-check', approved: 'ct-ok', act_made: 'ct-ok', act_signed: 'ct-ok',
    paid: 'ct-paid', declined: 'ct-off', cancelled: 'ct-off', archived: 'ct-off',
  };
  var CT_TABS = [['all', 'Все'], ['active', 'В работе'], ['draft', 'Черновики'],
                 ['approved', 'Приняты'], ['paid', 'Оплачены'], ['closed', 'Закрыты']];

  function ctMoney(v) {
    var n = Math.round(Number(v || 0));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  // Количество для человека: 2, а не 2.0; половинки остаются половинками
  function ctNum(v) {
    var n = Number(v || 0);
    return n % 1 === 0 ? String(n) : String(n).replace('.', ',');
  }
  function ctLoad(cb) {
    var p = '/admin/api/contractor-tasks?tab=' + encodeURIComponent(CT.tab) +
      (CT.q ? '&q=' + encodeURIComponent(CT.q) : '');
    api(p).then(function (r) {
      CT.list = r.tasks || []; CT.stats = r.stats || null; CT.err = '';
      if (state.page === 'cztasks') renderAll();
      if (cb) cb(true);
    }).catch(function (e) {
      if (e.message === '403') return;
      CT.list = CT.list || [];
      CT.err = 'Не удалось загрузить задания. Проверьте связь и обновите страницу.';
      if (state.page === 'cztasks') renderAll();
      if (cb) cb(false);
    });
  }
  /* Каталог типовых работ — то, что в договоре названо «каталогом типовых заданий и их
     стоимости» (Приложение № 1, п. 3). Дает условия по умолчанию при создании; цена
     после этого живет в самом задании и от правки каталога не меняется. */
  function ctServices(cb) {
    if (CT.services) return cb(CT.services);
    api('/admin/api/contractor-services').then(function (r) {
      CT.services = r.services || []; cb(CT.services);
    }).catch(function () { CT.services = []; cb(CT.services); });
  }
  function ctFind(id) {
    var l = CT.list || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function ctPut(t) {
    if (!t) return;
    CT.detail[t.id] = t;
    var l = CT.list || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === t.id) { l[i] = t; return; }
  }
  function ctPeriod(t) {
    if (!t.date_start && !t.date_end) return '—';
    if (t.date_start && t.date_end) return czDate(t.date_start) + ' — ' + czDate(t.date_end);
    return t.date_end ? 'до ' + czDate(t.date_end) : 'с ' + czDate(t.date_start);
  }
  function ctRow(t) {
    var p = t.contractor || {};
    return '<div class="trow ct-grid" data-ct="' + t.id + '">' +
      '<span class="ct-main"><span class="ct-no">№' + t.number + '</span>' +
        '<b>' + esc(t.title) + '</b>' +
        (t.project ? '<span class="ct-proj">' + esc(t.project) + '</span>' : '') + '</span>' +
      '<span class="ct-who">' + esc(p.full_name || '—') + '</span>' +
      '<span class="ct-when">' + esc(ctPeriod(t)) + '</span>' +
      '<span class="ct-sum"><b>' + ctMoney(t.amount) + ' ₽</b>' +
        (t.corrected ? '<span class="ct-corr">сумма уточнена</span>' : '') + '</span>' +
      '<span class="ct-state"><span class="ct-chip ' + (CT_ST[t.status] || 'ct-draft') + '">' +
        esc(t.status_title) + '</span>' +
        (t.next_hint ? '<span class="ct-next">' + esc(t.next_hint) + '</span>' : '') + '</span>' +
      '</div>';
  }
  function renderCzTasks(view) {
    if (CT.list === null) { view.innerHTML = dashSkeleton(); ctLoad(); return; }
    var st = CT.stats || { count: 0, amount: 0, by_tab: {} };
    var tabs = CT_TABS.map(function (t) {
      var n = (st.by_tab || {})[t[0]];
      return '<button class="qchip' + (CT.tab === t[0] ? ' on' : '') + '" data-ctab="' + t[0] + '">' +
        t[1] + (n === undefined ? '' : ' <span class="qn">' + n + '</span>') + '</button>';
    }).join('');
    var rows = CT.list;
    var body = CT.err
      ? '<div class="empty">' + esc(CT.err) + '</div>'
      : (!rows.length
        ? '<div class="empty">' + (CT.q
            ? 'По запросу «' + esc(CT.q) + '» заданий не нашли.'
            : 'Заданий пока нет. Создайте первое — из принятых заданий потом собирается акт, а по акту идет выплата.') + '</div>'
        : rows.map(ctRow).join(''));

    view.innerHTML =
      '<div class="card listcard">' +
        '<div class="list-tools">' +
          '<div class="searchwrap' + (CT.q ? ' has-val' : '') + '">' + ic('search', 16) +
            '<input class="search" id="ct-q" placeholder="Поиск по номеру, названию, исполнителю или ИНН" value="' + esc(CT.q) + '">' +
            (CT.q ? '<button class="s-clear" id="ct-qx">' + ic('x', 13) + '</button>' : '') +
          '</div>' +
          '<span class="list-count"><b>' + st.count + '</b> ' +
            plural(st.count, 'задание', 'задания', 'заданий') +
            ' на <b>' + ctMoney(st.amount) + ' ₽</b></span>' +
          '<button class="bp sm cz-add" id="ct-add">' + ic('plus', 14) + 'Новое задание</button>' +
        '</div>' +
        '<div class="list-quick">' + tabs + '</div>' +
        '<div class="trow ct-grid thead">' +
          '<span class="th">Задание</span><span class="th">Исполнитель</span>' +
          '<span class="th">Период</span><span class="th">Сумма</span>' +
          '<span class="th">Состояние</span>' +
        '</div>' + body +
      '</div>';

    var qi = el('ct-q');
    if (qi) {
      qi.addEventListener('input', function () {
        CT.q = qi.value;
        clearTimeout(CT._t);
        CT._t = setTimeout(function () { ctLoad(); }, 250);
      });
      qi.addEventListener('keydown', function (e) { if (e.key === 'Escape') { CT.q = ''; ctLoad(); } });
    }
    var qx = el('ct-qx');
    if (qx) qx.addEventListener('click', function () { CT.q = ''; ctLoad(); });
    el('ct-add').addEventListener('click', openCtNew);
    Array.prototype.forEach.call(view.querySelectorAll('[data-ctab]'), function (b) {
      b.addEventListener('click', function () {
        CT.tab = b.getAttribute('data-ctab'); CT.list = null; renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-ct]'), function (r) {
      r.addEventListener('click', function () { openCt(r.getAttribute('data-ct')); });
    });
    pageAnim(view);
  }

  /* ── карточка задания ─────────────────────────────────────────────────────
     Один экран отвечает на три вопроса: что за работа, на каком она шаге и что
     оператору делать дальше. Кнопки действий приходят с сервера (`next`) — экран не
     решает сам, что разрешено, иначе правила разъедутся с теми, что стоят на акте. */
  function openCt(id) {
    CT.openId = id;
    el('mbg').classList.add('open');
    el('modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCtCard();
    api('/admin/api/contractor-tasks/' + id).then(function (r) {
      ctPut(r);
      if (CT.openId === id) renderCtCard();
    }).catch(function () {
      if (CT.openId === id) { closeCt(); showToast('Не удалось открыть задание'); }
    });
  }
  function closeCt() {
    CT.openId = null;
    el('mbg').classList.remove('open');
    el('modal').classList.remove('open');
    document.body.style.overflow = '';
  }
  function ctAct(id, to, reason) {
    if (CT.busy) return;
    CT.busy = true;
    czSend('/admin/api/contractor-tasks/' + id + '/status', 'POST', { to: to, reason: reason })
      .then(function (t) {
        ctPut(t); renderCtCard();
        // карточку задания открывают и из планов — тогда обновлять надо тот список,
        // который человек видит за модалкой
        if (czPlansOn()) plLoad(); else ctLoad();
      })
      .catch(function (e) { showToast(e.message); })
      .then(function () { CT.busy = false; });
  }
  /* Названия действий, кто их хозяин и какое главное — приходят с сервера в `actions`:
     решение «принять задание или отказаться» принадлежит исполнителю, «принять
     результат», «подписать», «оплатить» — нам. Экран это только рисует. */
  // Действия, которые нельзя делать не подумав: они требуют причины или закрывают путь.
  var CT_ASK = { cancelled: 'Почему отменяем задание?', declined: 'Почему исполнитель отказался?' };
  function renderCtCard() {
    var modal = el('modal');
    var id = CT.openId;
    if (!modal || !id) return;
    var t = CT.detail[id] || ctFind(id);
    if (!t) {
      modal.innerHTML = '<div class="m-navfloat"><button class="m-arrow" id="ct-x">' + ic('x', 14) + '</button></div>' +
        '<div class="m-load">Открываем задание…</div>';
      el('ct-x').addEventListener('click', closeCt);
      return;
    }
    var p = t.contractor || {};
    var all = t.actions || [];
    /* Действия про сам документ (аннулировать акт) уходят в блок «Акт»: кнопка должна
       стоять при том, на что она действует, иначе «Аннулировать акт» висит отдельно от
       акта и читается как отмена задания. */
    var actBack = t.act ? all.filter(function (a) { return a.to === 'approved'; })[0] : null;
    var mine = all.filter(function (a) {
      return a.actor !== 'contractor' && !(actBack && a.to === 'approved');
    });
    var his = all.filter(function (a) { return a.actor === 'contractor'; });
    var btn = function (a) {
      return '<button class="bp sm' + (a.primary ? '' : ' ghost') + '" data-cta="' + a.to + '">' +
        esc(a.label) + '</button>';
    };
    /* Шаги исполнителя стоят отдельно и подписаны: это ЕГО решения. Свои шаги он
       делает в кабинете сам; если нажимаем мы, в историю это идет как отметка со слов.
       Смешать их с нашими кнопками нельзя — иначе «принял задание» выглядит как наше
       действие. Подпись под актом отметкой не заменяется вообще (см. блок «Акт»). */
    var acts = (mine.length ? '<div class="ct-acts">' + mine.map(btn).join('') + '</div>' : '') +
      (his.length
        ? '<div class="ct-acts ct-his"><div class="ct-his-h">Решение исполнителя. Обычно он нажимает сам в кабинете; наша отметка так и записывается — со слов</div>' +
          his.map(btn).join('') + '</div>'
        : '');

    /* «5 пост» звучит коряво, а склонять произвольную единицу («ролик», «час»,
       «обращение») нечем — пишем нейтрально: 5 × 900 ₽ за пост. */
    var calc = ctNum(t.qty) + ' × ' + ctMoney(t.unit_price) + ' ₽ за ' + esc(t.unit);
    var money =
      '<div class="ct-money">' +
        '<div class="ct-amt"><span class="ct-amt-k">К оплате по заданию</span>' +
          '<b>' + ctMoney(t.amount) + ' ₽</b></div>' +
        '<div class="ct-calc">' + calc +
          (t.corrected ? ' · по плану было ' + ctMoney(t.amount_plan) + ' ₽' : '') + '</div>' +
        (t.corrected
          ? '<div class="ct-why">Сумма уточнена: ' + esc(t.correction || '') + '</div>'
          : '') +
        (t.frozen
          ? '<div class="ct-frozen">Задание оплачено — сумма больше не меняется.</div>'
          : '<button class="bp sm ghost" id="ct-fix">Уточнить объем и сумму</button>' +
            (t.act
              ? '<div class="ct-frozen">Если изменить сумму, акт аннулируется: он составлен на прежнюю.</div>'
              : '')) +
      '</div>';

    /* Акт. Документ, а не отметка: у него свой номер, дата и снимок условий, и
       подписей на нем две. Нашу ставит кнопка здесь, подпись исполнителя — только он
       сам в кабинете кодом на почту (договор, п. 8.5.2), отметить ее за него нельзя. */
    var A = t.act;
    var actBlock = '';
    if (A) {
      var docUrl = API + '/admin/api/contractor-acts/' + encodeURIComponent(A.id) +
        '/doc?k=' + encodeURIComponent(getKey());
      var sg = function (who, when, note, wait) {
        return '<div class="ct-sg1"><span class="ct-sg-k">' + who + '</span>' +
          (when ? '<b>Подписан ' + esc(czDate(when)) + '</b>' +
                  (note ? '<span class="ct-sg-n">' + esc(note) + '</span>' : '')
                : '<span class="ct-sg-no">' + wait + '</span>') + '</div>';
      };
      actBlock =
        '<div class="m-sec"><div class="m-sec-h">Акт</div>' +
          '<div class="ct-act">' +
            '<div class="ct-act-h"><b>Акт № ' + A.number + '</b>' +
              '<span class="ct-chip ' + (ACT_ST[A.status] || 'ct-wait') + '">' +
                esc(A.status_title) + '</span></div>' +
            '<div class="ct-act-m">от ' + esc(czDate(A.act_date)) + ' · <b>' +
              ctMoney(A.amount) + ' ₽</b></div>' +
            '<div class="ct-sg">' +
              sg('Заказчик', A.signed_co_at, A.signed_co_by, 'Не подписан') +
              sg('Исполнитель', A.signed_ct_at, 'простой электронной подписью',
                 'Ждем подпись в кабинете') +
            '</div>' +
            '<div class="ct-acts">' +
              '<a class="bp sm ghost" href="' + docUrl + '" target="_blank" rel="noopener">' +
                'Открыть документ</a>' +
              (A.signed_co_at ? '' :
                '<button class="bp sm" id="ct-sign">Подписать со стороны компании</button>') +
              (actBack ? '<button class="bp sm ghost" data-cta="approved">' +
                esc(actBack.label) + '</button>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
    }

    /* Выплата. «Оплачено» без ответа на вопрос «когда и по какой платежке» — половина
       сведений: спрашивают об этом ровно тогда, когда деньги ищут в банковской выписке. */
    var P = t.payout;
    var payBlock = P
      ? '<div class="m-sec"><div class="m-sec-h">Выплата</div>' +
          '<div class="ct-act">' +
            '<div class="ct-act-h"><b>Выплата № ' + P.number + '</b>' +
              '<span class="ct-chip ct-paid">Проведена</span></div>' +
            '<div class="ct-act-m">' + esc(czDate(P.paid_at)) + ' · <b>' +
              ctMoney(P.amount) + ' ₽</b>' +
              (P.reference ? ' · платежка ' + esc(P.reference) : '') +
              (P.created_by ? ' · ' + esc(P.created_by) : '') + '</div>' +
          '</div>' +
        '</div>'
      : '';

    var facts = [
      ['Исполнитель', esc(p.full_name || '—') + (p.phone ? ' · ' + esc(p.phone) : '')],
      ['Услуга', esc(t.service_title || t.title) + (t.service_code ? ' · ' + esc(t.service_code) : '')],
      ['Проект', t.project ? esc(t.project) : '—'],
      ['Период', esc(ctPeriod(t))],
      ['Место выполнения', esc(t.place || 'Удаленно')],
      ['Цена за единицу', ctMoney(t.unit_price) + ' ₽ за ' + esc(t.unit)],
      ['Объем', ctNum(t.qty_plan) + ' по плану' +
        (t.qty_fact !== null && t.qty_fact !== undefined
          ? ' · ' + ctNum(t.qty_fact) + ' фактически' : '')],
    ];
    // Откуда задание выросло: работа из плана или разовое поручение. Строка появляется
    // только у выросших из плана — «нет» тут писать не о чем.
    if (t.from_plan) {
      facts.push(['Из плана', esc(plPeriodName(t.from_plan.period, t.from_plan.starts_on))]);
    }
    facts = facts.map(function (r) { return czRow2(r[0], r[1]); }).join('');

    var text = ['Что нужно сделать', t.description, 'Что считается выполнением', t.result_req,
                'Информация для исполнителя', t.info];
    var blocks = '';
    for (var i = 0; i < text.length; i += 2) {
      if (!text[i + 1]) continue;
      blocks += '<div class="m-sec"><div class="m-sec-h">' + esc(text[i]) + '</div>' +
        '<div class="ct-blk-b">' + esc(text[i + 1]).replace(/\n/g, '<br>') + '</div></div>';
    }

    /* Сдача исполнителя. Приемка идет по файлу, а не по фразе «сделал», поэтому блок
       стоит до истории — сразу под условиями работы. Скачиваем через тот же ключ, что
       и остальная CRM: в файлах бывают документы с чужими персональными данными. */
    var files = (t.files || []).length
      ? '<div class="m-sec"><div class="m-sec-h">Файлы от исполнителя</div>' +
        '<div class="ct-files">' + t.files.map(function (f) {
          return '<a class="ct-file" href="' + API + '/admin/api/contractor-task-files/' +
            encodeURIComponent(f.id) + '?k=' + encodeURIComponent(getKey()) + '" download>' +
            ic('doc', 14) + '<span class="ct-file-n">' + esc(f.name) + '</span>' +
            '<span class="ct-file-s">' + Math.max(1, Math.round((f.size_bytes || 0) / 1024)) +
            ' КБ · ' + fmtWhen(f.created_at) + '</span></a>';
        }).join('') + '</div></div>'
      : '';

    var ev = (t.events || []).map(function (e) {
      return '<div class="ct-ev"><span class="ct-ev-d">' + esc(czDate(e.at)) + '</span>' +
        '<span class="ct-ev-t">' + esc(e.text) + '</span>' +
        (e.author ? '<span class="ct-ev-a">' + esc(e.author) + '</span>' : '') + '</div>';
    }).join('');

    modal.innerHTML =
      '<div class="m-head">' +
        '<div class="m-navfloat"><button class="m-arrow" id="ct-x">' + ic('x', 14) + '</button></div>' +
        '<div class="m-id"><div class="m-name-row"><div class="m-name">' +
          '<span class="ct-no">№' + t.number + '</span>' + esc(t.title) + '</div></div>' +
          '<div class="m-sub"><span class="sev ' + (CT_ST[t.status] || 'ct-draft') + '">' +
            esc(t.status_title) + '</span>' +
            (t.next_hint ? '<span class="dot-sep"></span><span>' + esc(t.next_hint) + '</span>' : '') +
            '<span class="dot-sep"></span><span>' + esc(p.full_name || '—') + '</span>' +
          '</div></div>' +
      '</div>' +
      '<div class="m-body"><div class="m-content">' +
        money + acts + payBlock + actBlock +
        '<div class="m-sec"><div class="m-sec-h">Условия</div><div class="ab">' + facts + '</div></div>' +
        blocks + files +
        (t.cancel_reason
          ? '<div class="m-sec"><div class="m-sec-h">Причина</div>' +
            '<div class="ct-blk-b">' + esc(t.cancel_reason) + '</div></div>'
          : '') +
        '<div class="m-sec"><div class="m-sec-h">История</div>' +
          '<div class="ct-hist">' + (ev || '<span class="cz-fine">Пока пусто</span>') + '</div></div>' +
      '</div></div>';

    el('ct-x').addEventListener('click', closeCt);
    var fix = el('ct-fix');
    if (fix) fix.addEventListener('click', function () { openCtFix(t); });
    var sign = el('ct-sign');
    if (sign) sign.addEventListener('click', function () { ctSignAct(t.id, A.id); });
    Array.prototype.forEach.call(modal.querySelectorAll('[data-cta]'), function (b) {
      b.addEventListener('click', function () {
        var to = b.getAttribute('data-cta');
        // «Сформировать акт» — не смена статуса, а создание документа: он делает снимок
        // условий, поэтому у него своя ручка. Задание за документом двинет сервер.
        if (to === 'act_made') return ctMakeAct(t.id);
        /* Деньги — не смена статуса. Выплата это отдельная запись со снимком проверок
           и реквизитов, поэтому «Оплатить» открывает форму платежа, а «Отменить
           выплату» — отмену с причиной. Сервер отметку статусом и не примет. */
        if (to === 'paid') {
          return openPayout({ task_id: t.id, task_number: t.number, title: t.title,
                              amount: t.act ? t.act.amount : t.amount, act: t.act,
                              contractor: p });
        }
        if (to === 'act_signed' && t.payout) return openPayCancel(t.payout.id);
        // Возврат из акта — это аннулирование документа, и оно всегда с причиной.
        if (to === 'approved' && t.act) {
          return openCtReason(t.id, to, 'Почему аннулируем акт?');
        }
        if (CT_ASK[to]) return openCtReason(t.id, to, CT_ASK[to]);
        ctAct(t.id, to);
      });
    });
  }

  /* Состояние акта считает сервер по подписям — здесь только цвет чипа. */
  var ACT_ST = { wait_both: 'ct-wait', wait_co: 'ct-wait', wait_ct: 'ct-wait',
                 signed: 'ct-ok', paid: 'ct-paid', void: 'ct-off' };

  function ctMakeAct(id) {
    if (CT.busy) return;
    CT.busy = true;
    czSend('/admin/api/contractor-tasks/' + id + '/act', 'POST')
      .then(function () { return api('/admin/api/contractor-tasks/' + id); })
      .then(function (t) {
        ctPut(t); renderCtCard();
        if (czPlansOn()) plLoad(); else ctLoad();
        showToast('Акт сформирован. Проверьте документ и подпишите');
      })
      .catch(function (e) { showToast(e.message); })
      .then(function () { CT.busy = false; });
  }
  function ctSignAct(tid, aid) {
    if (CT.busy) return;
    CT.busy = true;
    czSend('/admin/api/contractor-acts/' + aid + '/sign', 'POST')
      .then(function () { return api('/admin/api/contractor-tasks/' + tid); })
      .then(function (t) {
        ctPut(t); renderCtCard();
        if (czPlansOn()) plLoad(); else ctLoad();
      })
      .catch(function (e) { showToast(e.message); })
      .then(function () { CT.busy = false; });
  }

  /* Причина обязательна там, где действие закрывает работу: через полгода «почему
     отменили» не вспомнит никто, а спрашивают об этом ровно тогда, когда речь о деньгах. */
  function openCtReason(id, to, question) {
    openSheet(question, 'Причина останется в истории задания — через полгода на этот вопрос отвечать по переписке никто не будет.', [
      ['reason', 'text', 'Причина', ''],
    ], function (vals, close) {
      if (!vals.reason.trim()) return 'Напишите причину — она останется в истории задания';
      ctAct(id, to, vals.reason.trim());
      close();
    });
  }
  /* Уточнение объема и суммы. Причина обязательна не для порядка: разница между
     «уточнили объем» и «заплатили меньше, чем договорились» — ровно в этом поле, и
     смотреть на него будут при споре. Правило проверяет и сервер. */
  function openCtFix(t) {
    var planSum = Math.round(Number(t.amount_plan) * 100) / 100;
    openSheet('Фактический объем и сумма',
      'Сумма считается сама: объем × цена за единицу. На нее и будет подписан акт.', [
      ['qty', 'number', 'Фактический объем, ' + t.unit, ctNum(t.qty)],
      ['price', 'number', 'Цена за 1 ' + t.unit + ', ₽', String(t.unit_price)],
      ['why', 'text', 'Почему сумма отличается от плановой', t.correction || ''],
    ], function (vals, close) {
      var qty = Number(vals.qty), price = Number(vals.price);
      if (!(qty > 0)) return 'Объем должен быть больше нуля';
      if (!(price >= 0)) return 'Цена должна быть числом';
      if (Math.round(qty * price * 100) / 100 !== planSum && !vals.why.trim()) {
        return 'Укажите причину — почему итог отличается от плановой суммы';
      }
      czSend('/admin/api/contractor-tasks/' + t.id, 'PATCH', {
        qty_fact: qty, price_fact: price, correction: vals.why.trim() || undefined,
      }).then(function (r) {
        ctPut(r); renderCtCard(); close();
        if (czPlansOn()) plLoad(); else ctLoad();
      })
        .catch(function (e) { showToast(e.message); });
      return null;
    }, function (vals) {
      // считаем прямо под полями: оператор видит итог до того, как нажал
      var s = Math.round(Number(vals.qty || 0) * Number(vals.price || 0));
      return 'К оплате: <b>' + ctMoney(s) + ' ₽</b>' +
        (s === Math.round(planSum) ? '' : ' · по плану ' + ctMoney(planSum) + ' ₽');
    });
  }

  /* Создание задания. Исполнителей берем из уже загруженного справочника: ставить
     задание можно только тому, кто прошел онбординг, и это видно прямо в списке. */
  function openCtNew() {
    var make = function () {
      var people = (CZ.list || []).filter(function (c) { return !c.archived && !c.blocked; });
      ctServices(function (svc) {
        var opts = people.map(function (c) {
          return '<option value="' + c.id + '">' + esc(c.full_name) +
            (c.state === 'ok' ? '' : ' — ' + esc((CZ_STATE[c.state] || {}).label || '')) + '</option>';
        }).join('');
        var sopts = '<option value="">— без каталога —</option>' + svc.map(function (s) {
          return '<option value="' + s.id + '">' + esc(s.title) +
            (s.price ? ' · ' + ctMoney(s.price) + ' ₽/' + esc(s.unit) : '') + '</option>';
        }).join('');
        openCtForm(opts, sopts, svc, people);
      });
    };
    if (CZ.list === null) czLoad(function () { make(); });
    else make();
  }
  function openCtForm(opts, sopts, svc, people) {
    if (document.querySelector('.al-ov')) return;
    var ov = document.createElement('div');
    ov.className = 'al-ov';
    var f = function (id, label, inner) {
      return '<label class="al-f"><span class="al-l">' + label + '</span>' + inner + '</label>';
    };
    ov.innerHTML =
      '<div class="al-card ct-card" role="dialog" aria-modal="true">' +
        '<div class="al-head">' +
          '<div><div class="al-eyebrow">Самозанятые</div><div class="al-title">Новое задание</div></div>' +
          '<button class="al-x" id="ctf-x" title="Закрыть">' + ic('x', 16) + '</button>' +
        '</div>' +
        '<div class="al-sub">Задание — это работа с результатом и суммой. Из принятых заданий собирается акт, по акту идет выплата. Текущие поручения и планы заданиями не являются.</div>' +
        (people.length
          ? '<div class="al-body">' +
              f('who', 'Исполнитель <i>*</i>',
                '<span class="al-selwrap"><select id="ctf-who" class="al-sel">' + opts + '</select></span>') +
              f('svc', 'Из каталога услуг',
                '<span class="al-selwrap"><select id="ctf-svc" class="al-sel">' + sopts + '</select></span>') +
              f('title', 'Название задания <i>*</i>',
                '<input id="ctf-title" class="al-in" maxlength="200" placeholder="Например: монтаж ролика для рассылки">') +
              f('desc', 'Что нужно сделать',
                '<textarea id="ctf-desc" class="al-in al-ta" rows="2" placeholder="Опишите услугу и результат, а не рабочий режим"></textarea>') +
              f('res', 'Что считается выполнением',
                '<input id="ctf-res" class="al-in" maxlength="300" placeholder="Например: ролик смонтирован и сдан в двух форматах">') +
              '<div class="al-row">' +
                f('d1', 'Начало', '<input id="ctf-d1" class="al-in" type="date">') +
                f('d2', 'Срок', '<input id="ctf-d2" class="al-in" type="date">') +
              '</div>' +
              /* Место выполнения — часть условий: «удаленно» и «в офисе на дне
                 открытых дверей» это разная работа, и в акте оно стоит рядом с
                 объемом. Пустое поле сервер понимает как «Удаленно». */
              f('place', 'Место выполнения',
                '<input id="ctf-place" class="al-in" maxlength="200" placeholder="Удаленно">') +
              '<div class="al-row">' +
                f('unit', 'Единица', '<input id="ctf-unit" class="al-in" value="шт" maxlength="40">') +
                f('qty', 'Объем', '<input id="ctf-qty" class="al-in" type="number" min="0.5" step="0.5" value="1">') +
                f('sum', 'Цена за единицу, ₽', '<input id="ctf-sum" class="al-in" type="number" min="0" step="100" value="0">') +
              '</div>' +
              '<div class="ct-live" id="ctf-total"></div>' +
              '<div class="ct-warn" id="ctf-warn"></div>' +
            '</div>' +
            '<div class="al-foot">' +
              '<button class="al-cancel" id="ctf-cancel">Отмена</button>' +
              '<button class="bp ghost al-save" id="ctf-draft">В черновики</button>' +
              '<button class="bp al-save" id="ctf-send">' + ic('send', 14) + 'Отправить</button>' +
            '</div>'
          : '<div class="al-body"><div class="empty">Сначала пригласите исполнителя — заданий без человека не бывает.</div></div>' +
            '<div class="al-foot"><button class="al-cancel" id="ctf-cancel">Закрыть</button></div>') +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    var closed = false;
    var close = function () {
      if (closed) return; closed = true;
      ov.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 180);
    };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);
    el('ctf-x').addEventListener('click', close);
    el('ctf-cancel').addEventListener('click', close);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    if (!people.length) return;

    var svcSel = el('ctf-svc');
    svcSel.addEventListener('change', function () {
      var s = null;
      for (var i = 0; i < svc.length; i++) if (svc[i].id === svcSel.value) s = svc[i];
      if (!s) return;
      /* Каталог подставляет условия, дальше они живут в задании: поменяют прайс — сумма
         уже согласованного задания не поедет (Приложение № 1, п. 3 договора). */
      if (!el('ctf-title').value) el('ctf-title').value = s.title;
      if (!el('ctf-desc').value && s.description) el('ctf-desc').value = s.description;
      if (!el('ctf-res').value && s.result_req) el('ctf-res').value = s.result_req;
      el('ctf-unit').value = s.unit || 'шт';
      if (s.price) el('ctf-sum').value = String(s.price);   // цена каталога — за единицу
      total();
    });
    /* Итог считаем на глазах: цена в задании — за штуку, и человек должен видеть, что
       два поста по 900 стоят 1800, до того как отправит. */
    var total = function () {
      var q = Number(el('ctf-qty').value || 0), pr = Number(el('ctf-sum').value || 0);
      el('ctf-total').innerHTML = 'Итого по заданию: <b>' + ctMoney(q * pr) + ' ₽</b>' +
        (q && pr ? ' · ' + ctNum(q) + ' × ' + ctMoney(pr) + ' ₽ за ' +
          esc(el('ctf-unit').value || 'шт') : '');
    };
    ['ctf-qty', 'ctf-sum', 'ctf-unit'].forEach(function (id) {
      el(id).addEventListener('input', total);
    });
    total();
    /* Отправить задание можно только тому, у кого все в порядке: неготовый человек его
       не примет, а заплатить потом будет некуда. Это же правило стоит на сервере — здесь
       мы просто не даем оператору упереться в отказ вслепую. */
    var whoSel = el('ctf-who');
    var gate = function () {
      var c = null;
      for (var i = 0; i < people.length; i++) if (people[i].id === whoSel.value) c = people[i];
      var ok = !c || c.state === 'ok';
      el('ctf-send').disabled = !ok;
      el('ctf-warn').innerHTML = ok ? '' :
        esc(c.full_name) + ' пока не готов к работе: ' +
        esc((c.problems || []).join('; ') || 'не завершен онбординг') +
        '. Черновик сохранить можно, отправить — нет.';
    };
    whoSel.addEventListener('change', gate);
    gate();
    var submit = function (offer) {
      var titleI = el('ctf-title');
      if (titleI.value.trim().length < 2) {
        titleI.classList.add('al-err'); titleI.focus();
        showToast('Напишите название задания');
        return;
      }
      czSend('/admin/api/contractor-tasks', 'POST', {
        contractor_id: el('ctf-who').value,
        title: titleI.value.trim(),
        description: el('ctf-desc').value.trim() || undefined,
        result_req: el('ctf-res').value.trim() || undefined,
        date_start: el('ctf-d1').value || undefined,
        date_end: el('ctf-d2').value || undefined,
        place: el('ctf-place').value.trim() || undefined,
        unit: el('ctf-unit').value.trim() || 'шт',
        qty_plan: Number(el('ctf-qty').value || 1),
        price_plan: Number(el('ctf-sum').value || 0),
        offer: !!offer,
      }).then(function (t) {
        close(); CT.list = null; ctLoad();
        showToast(offer ? 'Задание отправлено исполнителю' : 'Черновик сохранен');
        openCt(t.id);
      }).catch(function (e) { showToast(e.message); });
    };
    el('ctf-draft').addEventListener('click', function () { submit(false); });
    el('ctf-send').addEventListener('click', function () { submit(true); });
    titleFocus();
    function titleFocus() { setTimeout(function () { el('ctf-title').focus(); }, 30); }
  }

  /* ── КАТАЛОГ УСЛУГ ────────────────────────────────────────────────────────
     Это «каталог типовых заданий и их стоимости» из Приложения № 1 к договору: прайс,
     а не заказ. Цена отсюда подставляется в НОВОЕ задание и дальше живет в нем — правка
     каталога не меняет суммы уже выданных заданий (Приложение № 1, п. 3). Выключенная
     услуга просто исчезает из выбора, а не удаляется: на нее могут ссылаться прошлые
     задания и акты. */
  function czSvcLoad(cb) {
    api('/admin/api/contractor-services?include_off=true').then(function (r) {
      CT.cat = r.services || []; CT.services = null; CT.catErr = '';
      if (state.page === 'czservices') renderAll();
      if (cb) cb(true);
    }).catch(function (e) {
      if (e.message === '403') return;
      CT.cat = CT.cat || [];
      CT.catErr = 'Не удалось загрузить каталог. Проверьте связь и обновите страницу.';
      if (state.page === 'czservices') renderAll();
      if (cb) cb(false);
    });
  }
  function czSvcRow(s) {
    return '<div class="trow sv-grid' + (s.active ? '' : ' off') + '" data-sv="' + s.id + '">' +
      '<span class="sv-main"><b>' + esc(s.title) + '</b>' +
        (s.code ? '<span class="ct-proj">' + esc(s.code) + '</span>' : '') +
        (s.description ? '<span class="sv-desc">' + esc(s.description) + '</span>' : '') + '</span>' +
      '<span class="sv-unit">' + esc(s.unit || 'шт') + '</span>' +
      '<span class="sv-price">' + (s.price ? '<b>' + ctMoney(s.price) + ' ₽</b>' : '—') + '</span>' +
      '<span class="sv-state">' + (s.active
        ? '<span class="ct-chip ct-ok">В работе</span>'
        : '<span class="ct-chip ct-off">Выключена</span>') + '</span>' +
      '</div>';
  }
  /* ── ДОКУМЕНТЫ (модуль самозанятых, этап 5) ───────────────────────────────
     Одно место, где лежит бумажная часть работы с человеком: акты и его личные
     документы — согласие на обработку данных, договор, NDA. До этого раздела они
     жили в почте и переписке, и на вопрос «а подписан ли договор с Петровым» никто
     не мог ответить, не подняв чат. Чеки приедут на этапе 7 — пустую строку под них
     сейчас не рисуем: раздел показывает то, что есть.

     Акт открывается печатной формой в новой вкладке: этот документ печатают и
     отправляют, а не рассматривают в интерфейсе CRM. */
  var DC = { items: null, err: '', q: '', kind: 'all', _t: null };
  var DC_KINDS = [['all', 'Все'], ['act', 'Акты'], ['contract', 'Договоры'],
                  ['pdn', 'Согласия на данные'], ['nda', 'NDA']];
  var DC_ST = { wait_both: 'ct-wait', wait_co: 'ct-wait', wait_ct: 'ct-wait',
                signed: 'ct-ok', paid: 'ct-paid', void: 'ct-off',
                none: 'ct-draft', sent: 'ct-wait' };
  var DC_ICON = { act: 'doc', contract: 'doc', pdn: 'badge', nda: 'doc' };

  function dcLoad(cb) {
    var p = '/admin/api/contractor-documents?kind=' + encodeURIComponent(DC.kind) +
      (DC.q ? '&q=' + encodeURIComponent(DC.q) : '');
    api(p).then(function (r) {
      DC.items = r.items || []; DC.err = '';
      if (state.page === 'czdocs') renderAll();
      if (cb) cb();
    }).catch(function (e) {
      if (e.message === '403') return;
      DC.items = DC.items || [];
      DC.err = 'Не удалось загрузить документы. Проверьте связь и обновите страницу.';
      if (state.page === 'czdocs') renderAll();
    });
  }

  function dcRow(d) {
    var when = d.date ? czDate(d.date) : '—';
    return '<div class="trow dc-grid" data-dc="' + esc(d.contractor_id) +
      '" data-dk="' + esc(d.kind) + '" data-dt="' + esc(d.task_id || '') + '">' +
      '<span class="dc-main"><span class="dc-ic">' + ic(DC_ICON[d.kind] || 'doc', 14) + '</span>' +
        '<b>' + esc(d.title) + '</b></span>' +
      '<span class="dc-who">' + esc(d.contractor || '—') +
        (d.inn ? '<span class="dc-inn">' + esc(d.inn) + '</span>' : '') + '</span>' +
      '<span class="dc-when">' + esc(when) + '</span>' +
      '<span class="dc-sum">' + (d.amount ? '<b>' + ctMoney(d.amount) + ' ₽</b>' : '—') + '</span>' +
      '<span class="dc-state"><span class="ct-chip ' + (DC_ST[d.status] || 'ct-draft') + '">' +
        esc(d.status_title) + '</span></span>' +
      '</div>';
  }

  function renderCzDocs(view) {
    if (DC.items === null) { view.innerHTML = dashSkeleton(); dcLoad(); return; }
    var list = DC.items;
    var chips = DC_KINDS.map(function (k) {
      return '<button class="qchip' + (DC.kind === k[0] ? ' on' : '') + '" data-dkind="' +
        k[0] + '">' + k[1] + '</button>';
    }).join('');
    var body = DC.err
      ? '<div class="empty">' + esc(DC.err) + '</div>'
      : (!list.length
        ? '<div class="empty">' + (DC.q
            ? 'По запросу «' + esc(DC.q) + '» документов не нашли.'
            : 'Документов пока нет. Акт появляется здесь сам, как только вы сформируете его по принятому заданию.') + '</div>'
        : list.map(dcRow).join(''));

    view.innerHTML =
      '<div class="card listcard">' +
        '<div class="list-tools">' +
          '<div class="searchwrap' + (DC.q ? ' has-val' : '') + '">' + ic('search', 16) +
            '<input class="search" id="dc-q" placeholder="Поиск по фамилии, ИНН, телефону или названию" value="' + esc(DC.q) + '">' +
            (DC.q ? '<button class="s-clear" id="dc-qx">' + ic('x', 13) + '</button>' : '') +
          '</div>' +
          '<span class="list-count"><b>' + list.length + '</b> ' +
            plural(list.length, 'документ', 'документа', 'документов') + '</span>' +
        '</div>' +
        '<div class="list-quick">' + chips + '</div>' +
        '<div class="trow dc-grid thead">' +
          '<span class="th">Документ</span><span class="th">Исполнитель</span>' +
          '<span class="th">Дата</span><span class="th">Сумма</span>' +
          '<span class="th">Состояние</span>' +
        '</div>' + body +
      '</div>';

    var qi = el('dc-q');
    if (qi) {
      qi.addEventListener('input', function () {
        DC.q = qi.value;
        clearTimeout(DC._t);
        DC._t = setTimeout(function () { dcLoad(); }, 250);
      });
      qi.addEventListener('keydown', function (e) { if (e.key === 'Escape') { DC.q = ''; dcLoad(); } });
    }
    var qx = el('dc-qx');
    if (qx) qx.addEventListener('click', function () { DC.q = ''; dcLoad(); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-dkind]'), function (b) {
      b.addEventListener('click', function () {
        DC.kind = b.getAttribute('data-dkind'); DC.items = null; renderView();
      });
    });
    /* Клик по акту открывает задание, а не сам документ: спор идет о работе, а
       печатная форма — одна кнопка внутри карточки. Личный документ ведется в карточке
       человека, туда и ведем. */
    Array.prototype.forEach.call(view.querySelectorAll('[data-dc]'), function (r) {
      r.addEventListener('click', function () {
        var kind = r.getAttribute('data-dk');
        if (kind === 'act') {
          var tid = r.getAttribute('data-dt');
          if (tid) return openCt(tid);
        }
        openCz(r.getAttribute('data-dc'));
      });
    });
    pageAnim(view);
  }

  /* ── ВЫПЛАТЫ (этап 6 модуля самозанятых) ───────────────────────────────────
     Деньги уходят из банка руками, поэтому экран отвечает на два вопроса: кому сегодня
     платить и что мешает заплатить остальным. Обе цифры и все проверки считает сервер
     (шесть условий ТЗ 12 плюс блокировка человека) — экран их только показывает.
     Считать проверки здесь нельзя: посчитанное дважды правило разъезжается, и всегда в
     сторону «на экране зеленое». */
  var PY = { reg: null, hist: null, err: '', tab: 'ready', busy: false };
  var PY_TABS = [['ready', 'К оплате'], ['waiting', 'Ждут документов'], ['hist', 'История']];

  function pyLoad(cb) {
    /* Реестр берем сразу с застрявшими (waiting=1): «к оплате» и «ждут документов» —
       две вкладки одного списка, и второй запрос ради переключения вкладки не нужен. */
    api('/admin/api/contractor-payouts/registry?waiting=1').then(function (r) {
      PY.reg = r; PY.err = '';
      if (state.page === 'czpay') renderAll();
      if (cb) cb();
    }).catch(function (e) {
      if (e.message === '403') return;
      PY.reg = PY.reg || { rows: [], ready_count: 0, ready_amount: 0 };
      PY.err = 'Не удалось загрузить реестр. Проверьте связь и обновите страницу.';
      if (state.page === 'czpay') renderAll();
    });
  }
  function pyHist(cb) {
    api('/admin/api/contractor-payouts').then(function (r) {
      PY.hist = r.rows || [];
      if (state.page === 'czpay') renderAll();
      if (cb) cb();
    }).catch(function () { PY.hist = PY.hist || []; if (state.page === 'czpay') renderAll(); });
  }
  function pyRows(tab) {
    var rows = (PY.reg && PY.reg.rows) || [];
    return rows.filter(function (r) {
      return tab === 'ready' ? r.status === 'act_signed' : r.status !== 'act_signed';
    });
  }
  /* Проверки в строке: пройденные молчат, непройденные объясняют себя. Семь зеленых
     галочек в каждой строке — это шум, из которого не видно единственную красную. */
  function pyChecks(r) {
    if (r.ok) {
      return '<span class="py-ok">' + ic('check', 12) + 'Проверки пройдены</span>';
    }
    return '<span class="py-bad">' + r.blockers.map(function (b) {
      return '<span class="py-b1">' + esc(b) + '</span>';
    }).join('') + '</span>';
  }
  function pyRegRow(r) {
    var c = r.contractor || {};
    return '<div class="trow py-grid" data-pyt="' + esc(r.task_id) + '">' +
      '<span class="py-who"><b>' + esc(c.full_name || '—') + '</b>' +
        (c.job ? '<span class="py-job">' + esc(c.job) + '</span>' : '') + '</span>' +
      '<span class="py-task"><span class="ct-no">№' + r.task_number + '</span>' +
        esc(r.title) +
        (r.act ? '<span class="py-act">Акт № ' + r.act.number + ' от ' +
          esc(czDate(r.act.act_date)) + '</span>' : '') + '</span>' +
      '<span class="py-sum"><b>' + ctMoney(r.amount) + ' ₽</b>' +
        (c.pay_account ? '<span class="py-acc num">' + esc(c.pay_account) + '</span>' : '') +
        '</span>' +
      '<span class="py-check">' + pyChecks(r) + '</span>' +
      '<span class="py-do">' + (r.ok
        ? '<button class="bp sm" data-pypay="' + esc(r.task_id) + '">Провести выплату</button>'
        : '<span class="cz-fine">' + esc(r.status_title) + '</span>') + '</span>' +
      '</div>';
  }
  function pyHistRow(p) {
    var t = p.task || {};
    var off = p.status === 'cancelled';
    return '<div class="trow py-grid py-hist' + (off ? ' py-off' : '') + '">' +
      '<span class="py-who"><b>' + esc(p.ct_name || '—') + '</b>' +
        '<span class="py-job">Выплата № ' + p.number + '</span></span>' +
      '<span class="py-task"><span class="ct-no">№' + (t.number || '—') + '</span>' +
        esc(t.title || '—') +
        (p.reference ? '<span class="py-act">Платежка ' + esc(p.reference) + '</span>' : '') +
        '</span>' +
      '<span class="py-sum"><b>' + ctMoney(p.amount) + ' ₽</b>' +
        '<span class="py-acc">' + esc(czDate(p.paid_at)) + '</span></span>' +
      '<span class="py-check">' + (off
        ? '<span class="py-bad"><span class="py-b1">' + esc(p.cancel_reason || 'Отменена') +
          '</span></span>'
        : '<span class="py-ok">' + ic('check', 12) + 'Проведена' +
          (p.created_by ? ' · ' + esc(p.created_by) : '') + '</span>') + '</span>' +
      '<span class="py-do">' + (off ? '' :
        '<button class="bp sm ghost" data-pycancel="' + esc(p.id) + '">Отменить</button>') +
        '</span>' +
      '</div>';
  }
  function renderCzPay(view) {
    if (PY.reg === null) { view.innerHTML = dashSkeleton(); pyLoad(); return; }
    if (PY.tab === 'hist' && PY.hist === null) { pyHist(); }
    var reg = PY.reg;
    var counts = { ready: pyRows('ready').length, waiting: pyRows('waiting').length,
                   hist: PY.hist ? PY.hist.length : undefined };
    var tabs = PY_TABS.map(function (t) {
      var n = counts[t[0]];
      return '<button class="qchip' + (PY.tab === t[0] ? ' on' : '') + '" data-pytab="' +
        t[0] + '">' + t[1] + (n === undefined ? '' : ' <span class="qn">' + n + '</span>') +
        '</button>';
    }).join('');

    var body, head;
    if (PY.tab === 'hist') {
      var h = PY.hist || [];
      head = '<span class="th">Кому</span><span class="th">Задание</span>' +
        '<span class="th">Сумма и дата</span><span class="th">Состояние</span><span class="th"></span>';
      body = !h.length
        ? '<div class="empty">Выплат пока не было. Первая появится здесь сразу после того, как проведете ее по подписанному акту.</div>'
        : h.map(pyHistRow).join('');
    } else {
      var rows = pyRows(PY.tab);
      head = '<span class="th">Исполнитель</span><span class="th">За что</span>' +
        '<span class="th">Сумма</span><span class="th">Проверки</span><span class="th"></span>';
      body = PY.err
        ? '<div class="empty">' + esc(PY.err) + '</div>'
        : (!rows.length
          ? '<div class="empty">' + (PY.tab === 'ready'
              ? 'Платить пока нечего. Задание попадает сюда, когда работа принята и акт подписан обеими сторонами.'
              : 'Все принятые работы дошли до акта — ничего не застряло.') + '</div>'
          : rows.map(pyRegRow).join(''));
    }

    view.innerHTML =
      '<div class="card listcard">' +
        '<div class="list-tools">' +
          '<span class="list-count"><b>' + reg.ready_count + '</b> ' +
            plural(reg.ready_count, 'выплата', 'выплаты', 'выплат') +
            ' готово на <b>' + ctMoney(reg.ready_amount) + ' ₽</b></span>' +
          '<span class="py-hint">Деньги отправляете из банка сами. Здесь — проверка и отметка, ' +
            'что платеж прошел.</span>' +
        '</div>' +
        '<div class="list-quick">' + tabs + '</div>' +
        '<div class="trow py-grid thead">' + head + '</div>' + body +
      '</div>';

    Array.prototype.forEach.call(view.querySelectorAll('[data-pytab]'), function (b) {
      b.addEventListener('click', function () {
        PY.tab = b.getAttribute('data-pytab');
        if (PY.tab === 'hist' && PY.hist === null) pyHist();
        renderAll();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pyt]'), function (r) {
      r.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        openCt(r.getAttribute('data-pyt'));
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pypay]'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var tid = b.getAttribute('data-pypay');
        var row = pyRows('ready').filter(function (x) { return x.task_id === tid; })[0];
        openPayout(row);
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pycancel]'), function (b) {
      b.addEventListener('click', function () { openPayCancel(b.getAttribute('data-pycancel')); });
    });
    pageAnim(view);
  }
  /* Отметка о платеже. Сумму человек не вводит: платят ровно то, что подписано в акте,
     и поле для суммы означало бы, что ее можно набрать другой. Номер платежки не
     обязателен в момент отметки — его вписывают из выписки, но без него сверка с
     банком идет по суммам и датам. */
  function openPayout(row) {
    if (!row) return;
    var c = row.contractor || {};
    openSheet('Провести выплату',
      esc(c.full_name) + ' · ' + ctMoney(row.amount) + ' ₽ по акту № ' +
        (row.act ? row.act.number : '—') + '. Полные реквизиты — в карточке исполнителя.', [
      ['date', 'date', 'Дата платежа', new Date().toISOString().slice(0, 10)],
      ['ref', 'line', 'Номер платежного поручения', ''],
      ['note', 'text', 'Заметка (необязательно)', ''],
    ], function (vals, close) {
      if (PY.busy) return;
      PY.busy = true;
      czSend('/admin/api/contractor-payouts', 'POST', {
        task_id: row.task_id, paid_at: vals.date || undefined,
        reference: vals.ref.trim() || undefined, note: vals.note.trim() || undefined,
      }).then(function () {
        close(); pyAfter();
        showToast('Выплата отмечена. Задание закрыто');
      }).catch(function (e) { el('sh-err').textContent = e.message; })
        .then(function () { PY.busy = false; });
      return '';
    }, null, 'Выплата', 'Провести');
  }
  function openPayCancel(pid) {
    openSheet('Отменить выплату',
      'Задание вернется в «акт подписан» и снова появится в реестре. Причина останется в истории: без нее исчезнувшая сумма выглядит как потеря денег.', [
      ['reason', 'text', 'Что случилось', ''],
    ], function (vals, close) {
      if (!vals.reason.trim()) return 'Напишите причину — она останется в истории';
      czSend('/admin/api/contractor-payouts/' + pid + '/cancel', 'POST',
             { reason: vals.reason.trim() })
        .then(function () { close(); pyAfter(); })
        .catch(function (e) { el('sh-err').textContent = e.message; });
      return '';
    }, null, 'Выплата', 'Отменить выплату');
  }
  /* Выплату проводят из двух мест — из реестра и из карточки задания. Обновлять после
     нее надо то, что человек видит: реестр, историю и открытую карточку. */
  function pyAfter() {
    PY.hist = null;
    pyLoad();
    if (PY.tab === 'hist') pyHist();
    if (CT.openId) {
      api('/admin/api/contractor-tasks/' + CT.openId).then(function (t) {
        ctPut(t);
        if (CT.openId === t.id) renderCtCard();
      }).catch(function () {});
    }
    if (state.page === 'cztasks') ctLoad();
    else if (czPlansOn()) plLoad();
  }

  function renderCzServices(view) {
    if (!CT.cat) { view.innerHTML = dashSkeleton(); czSvcLoad(); return; }
    var list = CT.cat;
    // Группируем по категории: категория — это, по сути, должность (смм, монтаж,
    // ассистент), и оператор ищет услугу именно так.
    var cats = [], byCat = {};
    list.forEach(function (s) {
      var c = s.category || 'Без категории';
      if (!byCat[c]) { byCat[c] = []; cats.push(c); }
      byCat[c].push(s);
    });
    var body = CT.catErr
      ? '<div class="empty">' + esc(CT.catErr) + '</div>'
      : (!list.length
        ? '<div class="empty">Каталог пуст. Добавьте услугу — название, единицу и цену за единицу, — и она появится в выборе при создании задания.</div>'
        : cats.map(function (c) {
          return '<div class="sv-cat">' + esc(c) + '</div>' + byCat[c].map(czSvcRow).join('');
        }).join(''));

    view.innerHTML =
      '<div class="card listcard">' +
        '<div class="list-tools">' +
          '<span class="list-count"><b>' + list.length + '</b> ' +
            plural(list.length, 'услуга', 'услуги', 'услуг') + '</span>' +
          '<button class="bp sm cz-add" id="sv-add">' + ic('plus', 14) + 'Новая услуга</button>' +
        '</div>' +
        '<div class="trow sv-grid thead">' +
          '<span class="th">Услуга</span><span class="th">Единица</span>' +
          '<span class="th">Цена за единицу</span><span class="th">Состояние</span>' +
        '</div>' + body +
      '</div>';

    el('sv-add').addEventListener('click', function () { openSvcForm(null); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-sv]'), function (r) {
      r.addEventListener('click', function () {
        var id = r.getAttribute('data-sv');
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return openSvcForm(list[i]);
      });
    });
    pageAnim(view);
  }
  /* Форма услуги. Одна и та же на создание и правку: полей мало, и разводить два
     экрана ради одного заголовка незачем. */
  function openSvcForm(s) {
    if (document.querySelector('.al-ov')) return;
    var isNew = !s;
    s = s || { title: '', code: '', category: '', description: '', result_req: '',
               unit: 'шт', price: '', active: true };
    var ov = document.createElement('div');
    ov.className = 'al-ov';
    var f = function (label, inner) {
      return '<label class="al-f"><span class="al-l">' + label + '</span>' + inner + '</label>';
    };
    var v = function (x) { return esc(x === null || x === undefined ? '' : String(x)); };
    ov.innerHTML =
      '<div class="al-card ct-card" role="dialog" aria-modal="true">' +
        '<div class="al-head">' +
          '<div><div class="al-eyebrow">Каталог услуг</div><div class="al-title">' +
            (isNew ? 'Новая услуга' : 'Услуга') + '</div></div>' +
          '<button class="al-x" id="sv-x" title="Закрыть">' + ic('x', 16) + '</button>' +
        '</div>' +
        '<div class="al-sub">Цена указывается за одну единицу: пост, ролик, час, обращение. Сумма задания считается как объем × эта цена.</div>' +
        '<div class="al-body">' +
          f('Название услуги <i>*</i>',
            '<input id="sv-title" class="al-in" maxlength="200" value="' + v(s.title) + '" placeholder="Например: монтаж короткого ролика">') +
          '<div class="al-row">' +
            f('Категория', '<input id="sv-cat" class="al-in" maxlength="120" value="' + v(s.category) + '" placeholder="СММ, Видео, Ассистент">') +
            f('Код', '<input id="sv-code" class="al-in" maxlength="40" value="' + v(s.code) + '" placeholder="SMM-01">') +
          '</div>' +
          '<div class="al-row">' +
            f('Единица <i>*</i>', '<input id="sv-unit" class="al-in" maxlength="40" value="' + v(s.unit || 'шт') + '">') +
            f('Цена за единицу, ₽', '<input id="sv-price" class="al-in" type="number" min="0" step="50" value="' + v(s.price) + '">') +
          '</div>' +
          f('Что входит в услугу',
            '<textarea id="sv-desc" class="al-in al-ta" rows="2" placeholder="Состав действий — то же, что видит исполнитель в задании"></textarea>') +
          f('Что считается выполнением',
            '<input id="sv-res" class="al-in" maxlength="300" value="' + v(s.result_req) + '" placeholder="Например: ролик сдан в двух форматах">') +
          '<label class="al-f sv-onoff"><input type="checkbox" id="sv-on"' + (s.active ? ' checked' : '') + '>' +
            '<span>Услуга в работе — показывать при создании задания</span></label>' +
          '<div class="ct-err" id="sv-err"></div>' +
        '</div>' +
        '<div class="al-foot">' +
          '<button class="al-cancel" id="sv-cancel">Отмена</button>' +
          '<button class="bp al-save" id="sv-ok">Сохранить</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    el('sv-desc').value = s.description || '';
    var closed = false;
    var close = function () {
      if (closed) return; closed = true;
      ov.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 180);
    };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);
    el('sv-x').addEventListener('click', close);
    el('sv-cancel').addEventListener('click', close);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    el('sv-ok').addEventListener('click', function () {
      var title = el('sv-title').value.trim();
      if (title.length < 2) { el('sv-err').textContent = 'Напишите название услуги'; return; }
      var unit = el('sv-unit').value.trim() || 'шт';
      var price = el('sv-price').value === '' ? null : Number(el('sv-price').value);
      if (price !== null && !(price >= 0)) { el('sv-err').textContent = 'Цена должна быть числом'; return; }
      var body = {
        title: title, unit: unit, price: price,
        code: el('sv-code').value.trim() || null,
        category: el('sv-cat').value.trim() || null,
        description: el('sv-desc').value.trim() || null,
        result_req: el('sv-res').value.trim() || null,
        active: el('sv-on').checked,
      };
      czSend('/admin/api/contractor-services' + (isNew ? '' : '/' + s.id),
             isNew ? 'POST' : 'PATCH', body)
        .then(function () {
          close(); czSvcLoad();
          showToast(isNew ? 'Услуга добавлена в каталог' : 'Услуга сохранена');
        })
        .catch(function (e) { el('sv-err').textContent = e.message; });
    });
    setTimeout(function () { el('sv-title').focus(); }, 30);
  }

  /* ── ПЛАНЫ РАБОТ (модуль самозанятых, вторая половина этапа 2) ─────────────
     План отвечает на вопрос «что человек делает на этой неделе», задание — «за что мы
     платим». Это разные сущности, и здесь денег нет вообще: ни цены, ни количества, ни
     суммы. Единственный переход к оплате — превращение пункта в задание, и цена
     появляется уже у задания.

     Так и в договоре (пп. 1.1.2 и 1.1.3): перечень ежедневных поручений в акте
     читается как трудовая функция, а это прямой путь к переквалификации отношений.
     Запрет держится на структуре данных, а не на дисциплине оператора — взять сумму
     из плана технически неоткуда. */
  var PL = { period: 'week', on: '', data: null, err: '', busy: false };
  var PL_TABS = [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']];
  var PL_MON = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  function plIso(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  /* Начало текущего периода на стороне экрана — только чтобы понять, листаем мы прошлое
     или смотрим на сегодня. Нормализацию дат для базы делает сервер. */
  function plToday(period) {
    var d = new Date(); d.setHours(12, 0, 0, 0);
    if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (period === 'month') d.setDate(1);
    return plIso(d);
  }
  // месяц называем один раз, если неделя внутри одного месяца: «4 — 10 августа 2026»
  function plRange(s, e) {
    var a = /^(\d{4})-(\d{2})-(\d{2})/.exec(s), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(e);
    if (!a || !b) return czDate(s);
    return a[2] === b[2]
      ? Number(a[3]) + ' — ' + Number(b[3]) + ' ' + CZ_MON[Number(b[2]) - 1] + ' ' + b[1]
      : Number(a[3]) + ' ' + CZ_MON[Number(a[2]) - 1] + ' — ' + czDate(e);
  }
  /* Конец периода по его началу. Сервер отдает ends_on для открытого экрана, но карточка
     задания знает про свой план только период и его начало — считаем на месте. */
  function plEnds(period, s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    if (period === 'week') d.setDate(d.getDate() + 6);
    else if (period === 'month') { d.setMonth(d.getMonth() + 1); d.setDate(0); }
    return plIso(d);
  }
  /* Название периода для чужих экранов: «неделя 3 — 9 августа 2026», «Август 2026». */
  function plPeriodName(period, s) {
    if (period === 'day') return czDate(s);
    if (period === 'month') {
      var m = /^(\d{4})-(\d{2})/.exec(s);
      return m ? PL_MON[Number(m[2]) - 1] + ' ' + m[1] : czDate(s);
    }
    return 'неделя ' + plRange(s, plEnds('week', s));
  }
  function plTitle() {
    if (PL.period === 'day') return czDate(PL.data.starts_on);
    if (PL.period === 'month') return plPeriodName('month', PL.data.starts_on);
    return plRange(PL.data.starts_on, PL.data.ends_on);
  }
  function plArrow(back) {
    return '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M' +
      (back ? '12 4.5 6.5 10 12 15.5' : '8 4.5 13.5 10 8 15.5') + '"/></svg>';
  }
  function plLoad(cb) {
    var p = '/admin/api/contractor-plans?period=' + PL.period + (PL.on ? '&on=' + PL.on : '');
    api(p).then(function (r) {
      PL.data = r; PL.err = '';
      if (czPlansOn()) renderAll();
      if (cb) cb(true);
    }).catch(function (e) {
      if (e.message === '403') return;
      PL.data = PL.data || { plans: [], people: [] };
      PL.err = 'Не удалось загрузить планы. Проверьте связь и обновите страницу.';
      if (czPlansOn()) renderAll();
      if (cb) cb(false);
    });
  }
  /* Сводка для вердикта в шапке: сколько пунктов, сколько сделано, у скольких людей
     плана на этот период нет. Пустая неделя у исполнителя — это и есть повод спросить. */
  function plStats() {
    var d = PL.data || { plans: [], people: [] };
    var items = 0, done = 0, tasks = 0;
    (d.plans || []).forEach(function (p) {
      items += p.stats.count; done += p.stats.done; tasks += p.stats.tasks;
    });
    var empty = (d.people || []).filter(function (p) { return !p.has_plan; }).length;
    return { items: items, done: done, tasks: tasks, empty: empty,
             people: (d.people || []).length };
  }
  function plItemRow(it) {
    var right = it.task_id
      ? '<button class="pl-task on" data-pl-open="' + it.task_id + '">' +
          ic('task', 12) + '№' + it.task_number + '</button>'
      : '<button class="pl-task" data-pl-task="' + it.id + '">В задание</button>';
    return '<div class="pl-i' + (it.done ? ' done' : '') + '">' +
      '<button class="pl-ck" data-pl-done="' + it.id + '" title="' +
        (it.done ? 'Снять отметку' : 'Отметить выполненным') + '">' + ic('check', 12) + '</button>' +
      '<span class="pl-t"><b>' + esc(it.title) + '</b>' +
        (it.note ? '<span class="pl-n">' + esc(it.note) + '</span>' : '') +
        (it.due ? '<span class="pl-due">' + ic('clock', 11) + esc(czDate(it.due)) + '</span>' : '') +
      '</span>' +
      '<span class="pl-a">' + right +
        (it.task_id ? '' : '<button class="pl-x" data-pl-del="' + it.id + '" title="Убрать пункт">' +
          ic('x', 12) + '</button>') +
      '</span>' +
    '</div>';
  }
  function plPersonCard(person, plan) {
    var items = plan.items;
    var sub = items.length
      ? (plan.stats.done + ' из ' + items.length + ' сделано' +
         (plan.stats.tasks ? ' · ' + plan.stats.tasks + ' ' +
           plural(plan.stats.tasks, 'в задании', 'в заданиях', 'в заданиях') : ''))
      : 'Пунктов пока нет';
    return '<div class="card pl-p">' +
      '<div class="pl-p-h">' +
        '<span class="pl-p-n"><b>' + esc(person.full_name) + '</b>' +
          (person.blocked ? '<span class="ct-chip ct-off">Заблокирован</span>' : '') + '</span>' +
        '<span class="pl-p-s">' + esc(sub) + '</span>' +
      '</div>' +
      (items.length ? '<div class="pl-list">' + items.map(plItemRow).join('') + '</div>' : '') +
      '<button class="pl-add" data-pl-add="' + person.id + '">' + ic('plus', 13) + 'Добавить пункт</button>' +
    '</div>';
  }
  function renderCzPlans(view) {
    if (!PL.data) { view.innerHTML = dashSkeleton(); plLoad(); return; }
    var d = PL.data;
    // Связь оборвалась на первой же загрузке — периода мы не знаем, и рисовать шапку
    // с листалкой не из чего. Показываем причину, а не пустую страницу.
    if (!d.starts_on) {
      view.innerHTML = '<div class="card"><div class="empty">' +
        esc(PL.err || 'Не удалось загрузить планы. Обновите страницу.') + '</div></div>';
      return;
    }
    var byPerson = {};
    (d.plans || []).forEach(function (p) { byPerson[p.contractor_id] = p; });
    var tabs = PL_TABS.map(function (t) {
      return '<button class="qchip' + (PL.period === t[0] ? ' on' : '') + '" data-pltab="' + t[0] + '">' +
        t[1] + '</button>';
    }).join('');
    var cur = d.starts_on === plToday(PL.period);
    // Люди с планом — карточками, остальные одной строкой чипов. Девять одинаковых
    // карточек «плана нет» съедают экран и уравнивают пустое с работой, а вопрос по
    // ним один и тот же: записать первый пункт.
    var withPlan = (d.people || []).filter(function (p) { return byPerson[p.id]; });
    var without = (d.people || []).filter(function (p) { return !byPerson[p.id]; });
    var cards = withPlan.map(function (p) { return plPersonCard(p, byPerson[p.id]); }).join('');
    var rest = !without.length ? '' :
      '<div class="card pl-rest">' +
        '<div class="pl-rest-h">Без плана на этот период · ' + without.length + '</div>' +
        '<div class="pl-rest-l">' + without.map(function (p) {
          return '<button class="pl-chip" data-pl-add="' + p.id + '">' + esc(p.full_name) +
            ic('plus', 12) + '</button>';
        }).join('') + '</div>' +
      '</div>';
    var body = PL.err
      ? '<div class="card"><div class="empty">' + esc(PL.err) + '</div></div>'
      : (!(d.people || []).length
        ? '<div class="card"><div class="empty">Исполнителей пока нет. Пригласите первого — тогда можно будет планировать его работу.</div></div>'
        : (cards ? '<div class="pl-grid">' + cards + '</div>' : '') + rest);

    view.innerHTML =
      '<div class="card listcard pl-bar">' +
        '<div class="list-tools">' +
          '<div class="pl-nav">' +
            '<button class="pl-arr" id="pl-prev" title="Предыдущий период">' + plArrow(true) + '</button>' +
            '<span class="pl-when">' + esc(plTitle()) + '</span>' +
            '<button class="pl-arr" id="pl-next" title="Следующий период">' + plArrow(false) + '</button>' +
            (cur ? '<span class="pl-now">сейчас</span>'
                 : '<button class="pl-today" id="pl-today">Вернуться к текущему</button>') +
          '</div>' +
          '<div class="list-quick pl-per">' + tabs + '</div>' +
        '</div>' +
      '</div>' + body;

    el('pl-prev').addEventListener('click', function () { PL.on = d.prev_on; PL.data = null; renderView(); });
    el('pl-next').addEventListener('click', function () { PL.on = d.next_on; PL.data = null; renderView(); });
    if (el('pl-today')) el('pl-today').addEventListener('click', function () {
      PL.on = ''; PL.data = null; renderView();
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pltab]'), function (b) {
      b.addEventListener('click', function () {
        // период меняем — дату сбрасываем на сегодня: «третья неделя мая» в режиме дня
        // означала бы случайный день, а не то, что человек хотел увидеть
        PL.period = b.getAttribute('data-pltab'); PL.on = ''; PL.data = null; renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pl-add]'), function (b) {
      b.addEventListener('click', function () { plAddItem(b.getAttribute('data-pl-add')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pl-done]'), function (b) {
      b.addEventListener('click', function () { plToggle(b.getAttribute('data-pl-done')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pl-del]'), function (b) {
      b.addEventListener('click', function () { plDelItem(b.getAttribute('data-pl-del')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pl-task]'), function (b) {
      b.addEventListener('click', function () { plToTask(b.getAttribute('data-pl-task')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pl-open]'), function (b) {
      b.addEventListener('click', function () { openCt(b.getAttribute('data-pl-open')); });
    });
    pageAnim(view);
  }
  function plAddItem(cid) {
    openSheet('Пункт плана', 'Что человек делает в этот период. Стоимости у пункта нет: ' +
      'платим мы за задания, и любой пункт можно превратить в задание отдельно.',
      [['title', 'text', 'Что сделать', ''], ['due', 'date', 'Срок, если он есть', '']],
      function (v, close) {
        var title = (v.title || '').trim();
        if (title.length < 2) return 'Напишите, что нужно сделать';
        if (PL.busy) return null;
        PL.busy = true;
        // план заводим тем же действием: отдельная кнопка «создать план» ничего не
        // добавляет — план без единого пункта не значит ничего
        czSend('/admin/api/contractor-plans', 'POST',
               { contractor_id: cid, period: PL.period, on: PL.data.starts_on })
          .then(function (p) {
            return czSend('/admin/api/contractor-plans/' + p.id + '/items', 'POST',
                          { title: title, due: v.due || null });
          })
          .then(function () { close(); plLoad(); })
          .catch(function (e) { showToast(e.message); })
          .then(function () { PL.busy = false; });
        return null;
      }, null, 'Планы работ');
  }
  function plToggle(iid) {
    if (PL.busy) return;
    var it = null;
    (PL.data.plans || []).forEach(function (p) {
      p.items.forEach(function (x) { if (x.id === iid) it = x; });
    });
    if (!it) return;
    PL.busy = true;
    czSend('/admin/api/contractor-plan-items/' + iid, 'PATCH', { done: !it.done })
      .then(function () { plLoad(); })
      .catch(function (e) { showToast(e.message); })
      .then(function () { PL.busy = false; });
  }
  function plDelItem(iid) {
    if (!window.confirm('Убрать пункт из плана?')) return;
    czSend('/admin/api/contractor-plan-items/' + iid, 'DELETE')
      .then(function () { plLoad(); })
      .catch(function (e) { showToast(e.message); });
  }
  /* Пункт → задание. Здесь и появляются деньги, которых в плане нет: цена за единицу и
     объем задаются в этот момент и дальше живут у задания. Создаем черновиком и сразу
     открываем карточку — отправлять человеку задание вслепую, не глянув на условия,
     не стоит. */
  function plToTask(iid) {
    openSheet('Превратить пункт в задание',
      'У задания есть цена, объем и приемка — из принятых заданий собирается акт, а по акту идет выплата.',
      [['unit', 'line', 'Единица', 'шт'], ['qty', 'number', 'Объем', '1'],
       ['price', 'number', 'Цена за единицу, ₽', '']],
      function (v, close) {
        var qty = Number(v.qty), price = Number(v.price || 0);
        if (!(qty > 0)) return 'Объем должен быть больше нуля';
        if (!(price >= 0)) return 'Цена должна быть числом';
        if (PL.busy) return null;
        PL.busy = true;
        czSend('/admin/api/contractor-plan-items/' + iid + '/to-task', 'POST',
               { unit: (v.unit || 'шт').trim() || 'шт', qty_plan: qty, price_plan: price })
          .then(function (r) {
            close(); plLoad();
            showToast('Задание №' + r.task.number + ' создано черновиком');
            openCt(r.task.id);
          })
          .catch(function (e) { showToast(e.message); })
          .then(function () { PL.busy = false; });
        return null;
      },
      function (v) {
        var qty = Number(v.qty), price = Number(v.price || 0);
        if (!(qty > 0) || !(price >= 0)) return '';
        return 'Сумма задания: <b>' + ctMoney(qty * price) + ' ₽</b>' +
          '<span class="ct-live-x">' + ctNum(qty) + ' × ' + ctMoney(price) + ' ₽ за ' +
          esc((v.unit || 'шт').trim() || 'шт') + '</span>';
      }, 'Планы работ');
  }

  /* ── КАБИНЕТ ИСПОЛНИТЕЛЯ В CRM («Моя работа») ─────────────────────────────
     Преподаватель и куратор у нас одновременно сотрудники и самозанятые: они ведут
     клиентов в CRM и получают от нас задания. Второй логин тем же людям не нужен
     (решение владельца от 2026-08-11), поэтому свои задания, план и акты человек
     открывает здесь. Внешний кабинет по коду остается для подрядчиков со стороны —
     монтажера и ассистента в CRM пускать нельзя, там детские анкеты и деньги.

     Разделов пять, отдельными пунктами меню: Главная, Уведомления, Задания, Мой план,
     Акты (решение владельца от 2026-08-11, образец — Консоль.Про). Вкладками их не
     мешаем: задание и акт — разные сущности с разной логикой, и делятся они по-разному.

     Пункты появляются только у того, чья учетка связана с карточкой исполнителя:
     возможность `mywork` выдает сервер по этой связи, а не роль.

     Экран НИЧЕГО не решает сам. Какие шаги человеку сейчас доступны, приходит с
     сервера в `actions`, и ручки под этим экраном — те же самые, что под кабинетом.
     Двум дверям в одну комнату нельзя проверять разное: под актом должна стоять его
     подпись под тем, что он действительно мог сделать. */

  var MW = { sub: 'active', tasks: null, counts: null, err: '',
             openId: null, detail: {}, busy: false, period: 'week', plan: null, planErr: '',
             acts: null, actsErr: '', actFilter: 'sign',
             home: null, homeErr: '', feed: null, feedErr: '' };
  var MW_PAGES = ['mywork', 'mwnotif', 'mwtasks', 'mwplan', 'mwacts'];
  var MW_TITLES = { mywork: 'Моя работа', mwnotif: 'Уведомления', mwtasks: 'Задания',
                    mwplan: 'Мой план', mwacts: 'Акты' };
  function mwOn() { return MW_PAGES.indexOf(state.page) !== -1; }
  // Активные и завершенные — так разложены задания у Консоли, на которую мы равняемся
  // (ориентир владельца от 2026-08-06). Группы считает сервер: «активное» это то, что
  // еще движется, «завершенное» — оплаченное, отмененное и то, от чего отказались.
  var MW_SUB = [['active', 'Активные'], ['closed', 'Завершенные']];
  /* Акты делятся по подписи: «на подписание» — где не хватает ЕГО подписи, дальше
     подписанные (решение владельца от 2026-08-11). Оплату показываем внутри строки:
     это состояние денег, а не документа. */
  var MW_ACT_TABS = [['sign', 'На подписание'], ['signed', 'Подписанные']];
  function mwActIn(a, f) {
    if (f === 'sign') return !a.signed_ct_at && !a.voided_at;
    return !!a.signed_ct_at || !!a.voided_at;
  }
  // Бейдж у пункта меню: что горит прямо сейчас. Считает сервер, экран только рисует.
  function mwBadge(page) {
    var c = MW.counts || {};
    if (page === 'mwnotif') return c.unread || 0;
    if (page === 'mwtasks') return (c.todo || 0) - (c.acts_to_sign || 0);
    if (page === 'mwacts') return c.acts_to_sign || 0;
    return 0;
  }

  /* Сервер отдает формулировки для ИСТОРИИ задания («Исполнитель принял задание») и
     подсказки для менеджера («Ждем ответа исполнителя»). Человеку про самого себя так
     писать нельзя: на кнопке это читается как отчет о чужом поступке. Названия те же,
     что в кабинете, — экраны разные, слова одни. */
  var MW_DO = { accepted: 'Принять задание', declined: 'Отказаться',
                in_progress: 'Взять в работу', done: 'Сдать результат' };
  var MW_HINT = {
    offered: 'Примите задание или откажитесь',
    accepted: 'Можно приступать',
    in_progress: 'Сдайте результат, когда будет готов',
    done: 'Менеджер проверяет результат',
    approved: 'Результат принят — ждем акт',
    act_made: 'Подпишите акт',
    act_signed: 'Подписан — ждем выплату',
    paid: 'Оплачено',
    declined: 'Вы отказались от задания',
    cancelled: 'Задание отменено',
  };
  // Названия состояний тоже с его стороны: «Принято исполнителем» человек читает про
  // себя в третьем лице, а состояние должно отвечать «где сейчас моя работа».
  var MW_ST = { offered: 'Предложено вам', accepted: 'Вы приняли', in_progress: 'В работе',
                done: 'Сдано на проверку', approved: 'Результат принят',
                act_made: 'Акт сформирован', act_signed: 'Акт подписан', paid: 'Оплачено',
                declined: 'Вы отказались', cancelled: 'Отменено' };
  function mwSt(t) { return MW_ST[t.status] || t.status_title; }
  var MW_ACT_ST = { wait_both: 'Ждет обеих подписей', wait_ct: 'Ждет вашей подписи',
                    wait_co: 'Ждет подписи заказчика' };
  function mwActTitle(a) { return MW_ACT_ST[a.status] || a.status_title; }
  // Файл имеет смысл, только когда работа уже наша: до принятия задания прикладывать
  // нечего, после выплаты — поздно.
  var MW_FILES_AT = ['accepted', 'in_progress', 'done', 'approved', 'act_made', 'act_signed'];

  /* Свой запрос вместо общего api(): первый же ответ тут бывает 409 с человеческой
     фразой («учетка не связана с карточкой»), и показать надо именно ее. */
  function mwGet(path) {
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    return fetch(API + '/admin/api/my/cz' + path + sep + 'k=' + encodeURIComponent(getKey()))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          throw new Error((j && typeof j.detail === 'string' && j.detail) ||
            'Не удалось загрузить. Проверьте связь и обновите страницу');
        });
      });
  }
  function mwSend(path, method, body) {
    return czSend('/admin/api/my/cz' + path, method, body);
  }
  // Перерисовка после ответа сервера: разделов кабинета пять, и любой из них могли
  // успеть закрыть, пока шел запрос.
  /* Перерисовка после ответа сервера. Внутри кабинета — целиком (любой из пяти
     разделов могли успеть закрыть), снаружи — только сайдбар: там висит счетчик на
     кнопке «Моя работа», и он обязан обновиться, даже пока человек ведет клиентов. */
  function mwDone() { if (mwOn()) renderAll(); else renderSide(); }
  function mwLoad() {
    mwGet('/tasks?tab=' + MW.sub).then(function (r) {
      MW.tasks = r.tasks || []; MW.counts = r.counts || null; MW.err = '';
      mwDone();
    }).catch(function (e) {
      MW.tasks = []; MW.err = e.message; mwDone();
    });
  }
  /* Счетчики нужны на любом из пяти экранов — бейджи в меню и вердикт в шапке живут
     не только на главной. Ручка та же, что у кабинета: «кто я и что меня ждет». */
  function mwLoadCounts() {
    if (MW.counts || MW.err) return;
    MW.counts = {};   // чтобы не запросить дважды, пока идет ответ
    mwGet('').then(function (r) {
      MW.counts = r.counts || {}; mwDone();
    }).catch(function (e) {
      MW.counts = null; MW.err = e.message; mwDone();
    });
  }
  function mwLoadHome() {
    mwGet('/home').then(function (r) {
      MW.home = r; MW.counts = r.counts || MW.counts; MW.homeErr = ''; mwDone();
    }).catch(function (e) {
      MW.home = { soon: [] }; MW.homeErr = e.message; mwDone();
    });
  }
  /* Открыл уведомления — значит прочитал: отметку ставим сразу после загрузки, но
     «непрочитано» в самом списке оставляем от ответа сервера, чтобы новое было видно
     глазами, а не только цифрой в меню. */
  function mwLoadFeed() {
    mwGet('/feed').then(function (r) {
      MW.feed = r.items || []; MW.feedErr = ''; mwDone();
      if (r.unread) {
        mwSend('/feed/read', 'POST').then(function () {
          if (MW.counts) MW.counts.unread = 0;
          if (MW.home) MW.home.unread = 0;
          mwDone();
        }).catch(function () {});
      }
    }).catch(function (e) {
      MW.feed = []; MW.feedErr = e.message; mwDone();
    });
  }
  function mwLoadPlan() {
    mwGet('/plan?period=' + MW.period).then(function (r) {
      MW.plan = r; MW.planErr = ''; mwDone();
    }).catch(function (e) {
      MW.plan = { items: [] }; MW.planErr = e.message; mwDone();
    });
  }
  function mwLoadActs() {
    mwGet('/acts').then(function (r) {
      MW.acts = r.acts || []; MW.actsErr = ''; mwDone();
    }).catch(function (e) {
      MW.acts = []; MW.actsErr = e.message; mwDone();
    });
  }
  function mwPut(t) { MW.detail[t.id] = t; }
  function mwFind(id) {
    if (MW.detail[id]) return MW.detail[id];
    // Карточку открывают и со списка заданий, и с главной — ищем в обоих.
    var l = (MW.tasks || []).concat((MW.home && MW.home.soon) || []);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  /* Строка задания теми же колонками, что у Консоли: номер, название, статус, срок,
     цена, место. Заказчика колонкой не выносим — он у нас один, и повторять его в
     каждой строке значит тратить место на то, что человек и так знает. */
  function mwRow(t) {
    var wait = t.act && !t.act.signed_ct_at && t.act.status !== 'void';
    return '<div class="trow mw-grid" data-mw="' + t.id + '">' +
      '<span class="ct-no mw-num">№' + t.number + '</span>' +
      '<span class="ct-main"><b>' + esc(t.title) + '</b>' +
        (t.project ? '<span class="ct-proj">' + esc(t.project) + '</span>' : '') + '</span>' +
      '<span class="ct-state"><span class="sev ' + (CT_ST[t.status] || 'ct-draft') + '">' +
        esc(mwSt(t)) + '</span>' +
        (wait ? '<span class="ct-next">акт ждет вашей подписи</span>'
              : (MW_HINT[t.status] ? '<span class="ct-next">' + esc(MW_HINT[t.status]) + '</span>' : '')) +
      '</span>' +
      '<span class="ct-when">' + esc(mwTerm(t)) + '</span>' +
      '<span class="ct-sum"><b>' + ctMoney(t.amount) + ' ₽</b>' +
        (t.corrected ? '<span class="ct-corr">сумма уточнена</span>' : '') + '</span>' +
      '<span class="ct-when mw-place" title="' + esc(t.place || 'Удаленно') + '">' +
        esc(t.place || 'Удаленно') + '</span>' +
    '</div>';
  }
  // Срок словами: у задания бывает и начало, и конец, и только конец, и ничего.
  function mwTerm(t) {
    if (t.date_start && t.date_end) {
      // Работа на один день — одна дата, а не «15 августа — 15 августа».
      if (t.date_start === t.date_end) return czDate(t.date_end);
      return czDate(t.date_start) + ' — ' + czDate(t.date_end);
    }
    if (t.date_end) return 'до ' + czDate(t.date_end);
    if (t.date_start) return 'с ' + czDate(t.date_start);
    return 'без срока';
  }

  /* Пункт плана глазами исполнителя: галочка — единственное, что он тут меняет.
     Что делать, ставит менеджер, а денег в плане нет вообще (пп. 1.1.2 и 1.1.3
     договора) — поэтому ни цены, ни кнопки «в задание» здесь и быть не может. */
  function mwItemRow(it) {
    return '<div class="pl-i' + (it.done ? ' done' : '') + '">' +
      '<button class="pl-ck" data-mwit="' + it.id + '" title="' +
        (it.done ? 'Снять отметку' : 'Отметить выполненным') + '">' + ic('check', 12) + '</button>' +
      '<span class="pl-t"><b>' + esc(it.title) + '</b>' +
        (it.note ? '<span class="pl-n">' + esc(it.note) + '</span>' : '') +
        (it.due ? '<span class="pl-due">' + ic('clock', 11) + esc(czDate(it.due)) + '</span>' : '') +
      '</span>' +
      '<span class="pl-a">' + (it.task_id
        ? '<button class="pl-task on" data-mw="' + it.task_id + '">' + ic('task', 12) +
          '№' + it.task_number + '</button>' : '') + '</span>' +
    '</div>';
  }

  /* Акт — документ, поэтому и показан документом: тем же блоком .ct-act, что видит
     оператор. Подписывают обе стороны одну и ту же бумагу, и выглядеть она должна
     одинаково — иначе спор пойдет о том, кто что видел. */
  function mwActCard(a) {
    var docUrl = API + '/admin/api/my/cz/acts/' + encodeURIComponent(a.id) +
      '/doc?k=' + encodeURIComponent(getKey());
    var sg = function (who, when, note, wait) {
      return '<div class="ct-sg1"><span class="ct-sg-k">' + who + '</span>' +
        (when ? '<b>Подписан ' + esc(czDate(when)) + '</b>' +
                (note ? '<span class="ct-sg-n">' + esc(note) + '</span>' : '')
              : '<span class="ct-sg-no">' + wait + '</span>') + '</div>';
    };
    return '<div class="card mw-act">' +
      '<div class="ct-act">' +
        '<div class="ct-act-h"><b>Акт № ' + a.number + '</b>' +
          '<span class="ct-chip ' + (ACT_ST[a.status] || 'ct-wait') + '">' +
            esc(mwActTitle(a)) + '</span></div>' +
        '<div class="ct-act-m">от ' + esc(czDate(a.act_date)) + ' · ' +
          esc(a.service_title || '') + ' · <b>' + ctMoney(a.amount) + ' ₽</b></div>' +
        '<div class="ct-sg">' +
          sg('Заказчик', a.signed_co_at, a.signed_co_by, 'Не подписан') +
          sg('Вы', a.signed_ct_at, 'простой электронной подписью', 'Ждем вашу подпись') +
        '</div>' +
        (a.voided_at
          ? '<div class="ct-why">Акт аннулирован: ' + esc(a.void_reason || '') + '</div>' : '') +
        '<div class="ct-acts">' +
          '<a class="bp sm ghost" href="' + docUrl + '" target="_blank" rel="noopener">' +
            'Открыть документ</a>' +
          (!a.signed_ct_at && !a.voided_at
            ? '<button class="bp sm" data-mwsign="' + a.id + '">Подписать</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* Главная кабинета: три вопроса, с которыми человек сюда заходит, — что от меня
     ждут, что горит по срокам и сколько денег. Цифры считает сервер: те же самые
     видит внешний кабинет по коду, расходиться им нельзя. */
  function renderMwHome(view) {
    if (MW.home === null) { view.innerHTML = dashSkeleton(); mwLoadHome(); return; }
    if (MW.homeErr) {
      view.innerHTML = '<div class="card"><div class="empty">' + esc(MW.homeErr) + '</div></div>';
      return;
    }
    var h = MW.home, c = h.counts || {}, m = h.money || {};
    var tile = function (page, k, n, hint) {
      return '<button class="card mw-tile' + (n ? ' hot' : '') + '" data-mwgo="' + page + '">' +
        '<span class="mw-tile-k">' + k + '</span>' +
        '<b class="mw-tile-n">' + n + '</b>' +
        '<span class="mw-tile-h">' + hint + '</span></button>';
    };
    var money = function (k, v, hint) {
      return '<div class="card mw-tile"><span class="mw-tile-k">' + k + '</span>' +
        '<b class="mw-tile-n">' + ctMoney(v) + ' ₽</b>' +
        '<span class="mw-tile-h">' + hint + '</span></div>';
    };
    var soon = (h.soon || []);
    view.innerHTML =
      '<div class="mw-tiles">' +
        tile('mwtasks', 'Ждут вашего ответа', (c.todo || 0) - (c.acts_to_sign || 0),
             'новые задания') +
        tile('mwtasks', 'В работе', c.active || 0, 'приняли и делаете') +
        tile('mwacts', 'Акты на подпись', c.acts_to_sign || 0, 'без подписи выплаты нет') +
        tile('mwnotif', 'Новые уведомления', h.unread || 0, 'что произошло без вас') +
      '</div>' +
      '<div class="mw-tiles">' +
        money('Заработано в этом месяце', m.paid_month || 0, 'по оплаченным заданиям') +
        money('Ждет выплаты', m.awaiting || 0, 'акты подписаны, деньги в пути') +
        money('Всего заработано', m.paid_total || 0, 'за все время') +
      '</div>' +
      '<div class="card listcard">' +
        '<div class="lc-h"><b>Ближайшие сроки</b>' +
          '<button class="bp sm ghost" data-mwgo="mwtasks">Все задания</button></div>' +
        (!soon.length
          ? '<div class="empty">Активных заданий нет. Когда менеджер пришлет задание, оно появится здесь.</div>'
          : '<div class="trow mw-grid thead">' +
              '<span class="th">№</span><span class="th">Название</span>' +
              '<span class="th">Статус</span><span class="th">Срок</span>' +
              '<span class="th">Цена</span><span class="th">Место</span>' +
            '</div>' + soon.map(mwRow).join('')) +
      '</div>';
    mwWire(view);
  }

  /* Уведомления — что произошло с моей работой без меня. Свои же действия сюда не
     попадают: человек не уведомляет себя о том, что сам нажал. */
  function renderMwNotif(view) {
    if (MW.feed === null) { view.innerHTML = dashSkeleton(); mwLoadFeed(); return; }
    if (MW.feedErr) {
      view.innerHTML = '<div class="card"><div class="empty">' + esc(MW.feedErr) + '</div></div>';
      return;
    }
    var items = MW.feed || [];
    view.innerHTML = '<div class="card listcard">' +
      (!items.length
        ? '<div class="empty">Пока ничего не происходило. Здесь появятся новые задания, приемка результата, готовые акты и выплаты.</div>'
        : items.map(function (i) {
            return '<div class="mw-nf' + (i.unread ? ' new' : '') + '" data-mw="' + i.task_id + '">' +
              '<span class="mw-nf-d">' + esc(fmtWhen(i.at)) + '</span>' +
              '<span class="mw-nf-t"><b>' + esc(i.title) + '</b>' +
                '<span class="mw-nf-s">№' + i.task_number + ' · ' + esc(i.task_title) + '</span>' +
              '</span>' +
              (i.unread ? '<span class="mw-nf-new">новое</span>' : '') +
            '</div>';
          }).join('')) +
    '</div>';
    mwWire(view);
  }

  function renderMwTasks(view) {
    if (MW.tasks === null) { view.innerHTML = dashSkeleton(); mwLoad(); return; }
    /* Связи учетки с карточкой нет — раздела фактически нет. Показываем причину
       человеческими словами, а не пустой список. */
    if (MW.err) {
      view.innerHTML = '<div class="card"><div class="empty">' + esc(MW.err) + '</div></div>';
      return;
    }
    var rows = MW.tasks || [];
    var sub = MW_SUB.map(function (s) {
      return '<button class="qchip' + (MW.sub === s[0] ? ' on' : '') +
        '" data-mwsub="' + s[0] + '">' + s[1] + '</button>';
    }).join('');
    view.innerHTML = '<div class="card listcard">' +
      '<div class="list-quick">' + sub + '</div>' +
      (!rows.length
        ? '<div class="empty">' + (MW.sub === 'closed'
            ? 'Завершенных заданий пока нет.'
            : 'Заданий пока нет. Когда менеджер пришлет задание, оно появится здесь — и до начала работы его надо принять.') +
          '</div>'
        : '<div class="trow mw-grid thead">' +
            '<span class="th">№</span><span class="th">Название</span>' +
            '<span class="th">Статус</span><span class="th">Срок</span>' +
            '<span class="th">Цена</span><span class="th">Место</span>' +
          '</div>' + rows.map(mwRow).join('')) +
    '</div>';
    mwWire(view);
  }

  function renderMwPlan(view) {
    if (MW.plan === null) { view.innerHTML = dashSkeleton(); mwLoadPlan(); return; }
    var items = MW.plan.items || [];
    var per = PL_TABS.map(function (t) {
      return '<button class="qchip' + (MW.period === t[0] ? ' on' : '') +
        '" data-mwper="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
    // «неделя 10 — 16 августа» приходит строчной буквой: внутри фразы это верно, а
    // заголовком карточки читается как обрывок.
    var when = plPeriodName(MW.period, MW.plan.starts_on);
    when = when.charAt(0).toUpperCase() + when.slice(1);
    var done = items.filter(function (i) { return i.done; }).length;
    view.innerHTML =
      '<div class="card pl-p mw-plan">' +
        '<div class="pl-p-h">' +
          '<span class="pl-p-n"><b>' + esc(when) + '</b></span>' +
          '<span class="pl-p-s">' + (items.length
            ? done + ' из ' + items.length + ' сделано' : 'Пунктов пока нет') + '</span>' +
        '</div>' +
        '<div class="list-quick mw-per">' + per + '</div>' +
        (MW.planErr ? '<div class="empty">' + esc(MW.planErr) + '</div>' : '') +
        (items.length
          ? '<div class="pl-list">' + items.map(mwItemRow).join('') + '</div>'
          : (MW.planErr ? '' : '<div class="empty">На этот период плана нет. План ставит менеджер: это то, чем занята неделя, а не то, за что платят — деньги идут по заданиям.</div>')) +
      '</div>';
    mwWire(view);
  }

  function renderMwActs(view) {
    if (MW.acts === null) { view.innerHTML = dashSkeleton(); mwLoadActs(); return; }
    if (MW.actsErr) {
      view.innerHTML = '<div class="card"><div class="empty">' + esc(MW.actsErr) + '</div></div>';
      return;
    }
    var acts = MW.acts || [];
    // Счетчик у каждого разреза: пустая вкладка должна быть видна до нажатия.
    var af = MW_ACT_TABS.map(function (f) {
      var n = acts.filter(function (a) { return mwActIn(a, f[0]); }).length;
      return '<button class="qchip' + (MW.actFilter === f[0] ? ' on' : '') +
        '" data-mwaf="' + f[0] + '">' + f[1] +
        (n ? ' <span class="qn">' + n + '</span>' : '') + '</button>';
    }).join('');
    var shown = acts.filter(function (a) { return mwActIn(a, MW.actFilter); });
    view.innerHTML =
      (acts.length ? '<div class="card listcard"><div class="list-quick">' + af + '</div></div>' : '') +
      (!acts.length
        ? '<div class="card"><div class="empty">Актов пока нет. Акт появляется, когда менеджер принял результат задания: вы подписываете его кодом с рабочей почты, и после обеих подписей идет выплата.</div></div>'
        : (!shown.length
          ? '<div class="card"><div class="empty">' + (MW.actFilter === 'sign'
              ? 'Все акты подписаны — от вас сейчас ничего не ждут.'
              : 'Подписанных актов пока нет.') + '</div></div>'
          : '<div class="pl-grid">' + shown.map(mwActCard).join('') + '</div>'));
    mwWire(view);
  }

  function mwView(view) {
    if (state.page === 'mwnotif') return renderMwNotif(view);
    if (state.page === 'mwtasks') return renderMwTasks(view);
    if (state.page === 'mwplan') return renderMwPlan(view);
    if (state.page === 'mwacts') return renderMwActs(view);
    return renderMwHome(view);
  }

  // Обработчики у всех пяти разделов одни и те же — вешаем одной функцией.
  function mwWire(view) {
    Array.prototype.forEach.call(view.querySelectorAll('[data-mwgo]'), function (b) {
      b.addEventListener('click', function () { setPage(b.getAttribute('data-mwgo')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-mwsub]'), function (b) {
      b.addEventListener('click', function () {
        MW.sub = b.getAttribute('data-mwsub'); MW.tasks = null; renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-mwaf]'), function (b) {
      b.addEventListener('click', function () {
        MW.actFilter = b.getAttribute('data-mwaf'); renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-mwper]'), function (b) {
      b.addEventListener('click', function () {
        MW.period = b.getAttribute('data-mwper'); MW.plan = null; renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-mwit]'), function (b) {
      b.addEventListener('click', function () { mwTick(b.getAttribute('data-mwit')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-mw]'), function (r) {
      r.addEventListener('click', function (e) {
        e.stopPropagation(); mwOpen(r.getAttribute('data-mw'));
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-mwsign]'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation(); mwSign(b.getAttribute('data-mwsign'));
      });
    });
    pageAnim(view);
  }

  function mwTick(iid) {
    var items = (MW.plan && MW.plan.items) || [];
    var cur = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === iid) cur = items[i];
    if (!cur || MW.busy) return;
    MW.busy = true;
    mwSend('/plan-items/' + iid, 'PATCH', { done: !cur.done })
      .then(function (r) { cur.done = r.done; cur.done_at = r.done_at; renderAll(); })
      .catch(function (e) { showToast(e.message); })
      .then(function () { MW.busy = false; });
  }

  /* ── своя карточка задания ────────────────────────────────────────────────
     Та же модалка, что у оператора, но без второй половины: приемка результата,
     подпись со стороны компании и выплата — решения заказчика, и кнопок на них тут
     нет. Сервер их и не даст (403), а рисовать кнопку, которая всегда откажет, —
     обман. */
  function mwOpen(id) {
    MW.openId = id;
    el('mbg').classList.add('open');
    el('modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    renderMwCard();
    mwGet('/tasks/' + id).then(function (t) {
      mwPut(t);
      if (MW.openId === id) renderMwCard();
    }).catch(function (e) {
      if (MW.openId === id) { mwClose(); showToast(e.message); }
    });
  }
  function mwClose() {
    MW.openId = null;
    el('mbg').classList.remove('open');
    el('modal').classList.remove('open');
    document.body.style.overflow = '';
  }
  /* Шаг по заданию меняет и списки, и цифры на главной, и бейджи в меню — сбрасываем
     все, что могло устареть, а грузит заново только открытый раздел. */
  function mwStale() { MW.tasks = null; MW.home = null; MW.acts = null; MW.counts = null; }
  function mwAct(id, to, reason) {
    if (MW.busy) return;
    MW.busy = true;
    mwSend('/tasks/' + id + '/status', 'POST', { to: to, reason: reason })
      .then(function (t) {
        mwPut(t); renderMwCard(); mwStale(); mwDone();
        if (to === 'done') showToast('Результат отправлен — менеджер его проверит');
      })
      .catch(function (e) { showToast(e.message); })
      .then(function () { MW.busy = false; });
  }
  // Отказ — единственный шаг исполнителя, который надо объяснить: причина остается в
  // истории задания, и через полгода отвечать на этот вопрос по переписке некому.
  function mwDecline(id) {
    openSheet('Отказаться от задания', 'Причина останется в истории задания — ее увидит менеджер.',
      [['reason', 'text', 'Почему не беретесь', '']],
      function (v, close) {
        if (!v.reason.trim()) return 'Напишите причину — она останется в истории задания';
        mwAct(id, 'declined', v.reason.trim());
        close();
        return null;
      }, null, 'Мое задание', 'Отказаться');
  }
  /* Файл — это и есть сдача работы: приемка идет по нему, а не по фразе «сделал».
     Читаем файл в браузере и отправляем строкой; потолки (8 МБ на файл и лимит на
     задание) проверяет сервер, здесь только человеческий отказ до отправки. */
  function mwUpload(id, file) {
    if (!file || MW.busy) return;
    if (file.size > 8 * 1024 * 1024) {
      return showToast('Файл больше 8 МБ — пришлите ссылку на облако');
    }
    MW.busy = true;
    var fr = new FileReader();
    fr.onerror = function () { MW.busy = false; showToast('Файл не читается'); };
    fr.onload = function () {
      mwSend('/tasks/' + id + '/files', 'POST',
             { name: file.name, mime: file.type || 'application/octet-stream',
               data: String(fr.result) })
        .then(function (r) {
          var t = MW.detail[id];
          if (t) { t.files = r.files || []; renderMwCard(); }
          showToast('Файл приложен');
        })
        .catch(function (e) { showToast(e.message); })
        .then(function () { MW.busy = false; });
    };
    fr.readAsDataURL(file);
  }
  /* Подпись акта — код на рабочую почту (договор, п. 8.5.2: ключ простой электронной
     подписи это адрес плюс одноразовый код). Ни оператор, ни этот экран подписать за
     человека не могут: сервер сверяет код и отпечаток документа. */
  function mwSign(aid) {
    if (MW.busy) return;
    MW.busy = true;
    mwSend('/acts/' + aid + '/sign/request', 'POST')
      .then(function (r) {
        openSheet('Подпись акта',
          'Код отправлен на ' + (r.email_hint || 'вашу рабочую почту') +
            '. Он живет ' + (r.ttl_min || 15) + ' минут.',
          [['code', 'line', 'Код из письма', '']],
          function (v, close) {
            var code = (v.code || '').trim();
            if (code.length < 4) return 'Введите код из письма';
            if (MW.busy) return null;
            MW.busy = true;
            mwSend('/acts/' + aid + '/sign', 'POST', { code: code })
              .then(function () {
                close(); MW.detail = {}; mwStale(); mwDone();
                if (MW.openId) mwOpen(MW.openId);
                showToast('Акт подписан');
              })
              .catch(function (e) { el('sh-err').textContent = e.message; })
              .then(function () { MW.busy = false; });
            return null;
          }, null, 'Акт', 'Подписать');
      })
      .catch(function (e) { showToast(e.message); })
      .then(function () { MW.busy = false; });
  }

  function renderMwCard() {
    var modal = el('modal');
    var id = MW.openId;
    if (!modal || !id) return;
    var t = MW.detail[id] || mwFind(id);
    if (!t) {
      modal.innerHTML = '<div class="m-navfloat"><button class="m-arrow" id="mw-x">' + ic('x', 14) + '</button></div>' +
        '<div class="m-load">Открываем задание…</div>';
      el('mw-x').addEventListener('click', mwClose);
      return;
    }
    // Сервер уже оставил в actions только шаги исполнителя — это его карточка.
    var acts = (t.actions || []).map(function (a) {
      return '<button class="bp sm' + (a.primary ? '' : ' ghost') + '" data-mwa="' + a.to + '">' +
        esc(MW_DO[a.to] || a.label) + '</button>';
    }).join('');

    var A = t.act;
    var actBlock = '';
    if (A) {
      var docUrl = API + '/admin/api/my/cz/acts/' + encodeURIComponent(A.id) +
        '/doc?k=' + encodeURIComponent(getKey());
      actBlock = '<div class="m-sec"><div class="m-sec-h">Акт</div>' +
        '<div class="ct-act">' +
          '<div class="ct-act-h"><b>Акт № ' + A.number + '</b>' +
            '<span class="ct-chip ' + (ACT_ST[A.status] || 'ct-wait') + '">' +
              esc(mwActTitle(A)) + '</span></div>' +
          '<div class="ct-act-m">от ' + esc(czDate(A.act_date)) + ' · <b>' +
            ctMoney(A.amount) + ' ₽</b></div>' +
          (A.signed_ct_at
            ? '<div class="ct-act-m">Ваша подпись стоит ' + esc(czDate(A.signed_ct_at)) + '</div>'
            : '<div class="ct-frozen">Подпись подтверждается кодом с вашей рабочей почты.</div>') +
          '<div class="ct-acts">' +
            '<a class="bp sm ghost" href="' + docUrl + '" target="_blank" rel="noopener">' +
              'Открыть документ</a>' +
            (A.signed_ct_at ? ''
              : '<button class="bp sm" data-mwsign="' + A.id + '">Подписать</button>') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    /* Порядок блоков — как в карточке задания у Консоли (ориентир владельца): сверху
       сумма и срок, потом «что будете делать» с расчетом объем × цена, потом где и на
       каких условиях, а кнопки «принять/отказаться» — внизу, под всем, что человек
       должен был прочитать до решения. */
    var mtext = function (s) { return esc(s).replace(/\n/g, '<br>'); };
    var doing =
      '<div class="m-sec"><div class="m-sec-h">Что будете делать</div>' +
        '<div class="mw-svc">' +
          // Название услуги повторяет заголовок карточки в большинстве заданий —
          // второй раз его не пишем, остается расчет.
          '<span class="mw-svc-n">' +
            esc((t.service_title && t.service_title !== t.title) ? t.service_title : 'Объем и цена') +
          '</span>' +
          '<span class="mw-svc-c">' + ctNum(t.qty) + ' ' + esc(t.unit) + ' × ' +
            ctMoney(t.unit_price) + ' ₽ = <b>' + ctMoney(t.amount) + ' ₽</b></span>' +
        '</div>' +
        (t.corrected
          ? '<div class="ct-why">Сумма уточнена: ' + esc(t.correction || '') +
            ' · по плану было ' + ctMoney(t.amount_plan) + ' ₽</div>' : '') +
        (t.description ? '<div class="ct-blk-b">' + mtext(t.description) + '</div>' : '') +
        (t.result_req
          ? '<div class="mw-h2">Что считается выполнением</div>' +
            '<div class="ct-blk-b">' + mtext(t.result_req) + '</div>' : '') +
      '</div>';

    var where =
      '<div class="m-sec"><div class="m-sec-h">Где выполнять</div>' +
        '<div class="ct-blk-b">' + esc(t.place || 'Удаленно') + '</div>' +
      '</div>';

    var extra = (t.info || t.cancel_reason)
      ? '<div class="m-sec"><div class="m-sec-h">Дополнительно</div>' +
          (t.info ? '<div class="ct-blk-b">' + mtext(t.info) + '</div>' : '') +
          (t.cancel_reason
            ? '<div class="mw-h2">Причина отмены</div>' +
              '<div class="ct-blk-b">' + mtext(t.cancel_reason) + '</div>' : '') +
        '</div>'
      : '';

    var canFile = MW_FILES_AT.indexOf(t.status) !== -1;
    /* Пока задание не принято, файлов не бывает и приложить их нельзя — пустой блок
       на экране решения только мешает читать условия. */
    var files = (!canFile && !(t.files || []).length) ? '' :
      '<div class="m-sec"><div class="m-sec-h">Файлы по заданию</div>' +
      ((t.files || []).length
        ? '<div class="ct-files">' + t.files.map(function (f) {
            return '<a class="ct-file" href="' + API + '/admin/api/my/cz/files/' +
              encodeURIComponent(f.id) + '?k=' + encodeURIComponent(getKey()) + '" download>' +
              ic('doc', 14) + '<span class="ct-file-n">' + esc(f.name) + '</span>' +
              '<span class="ct-file-s">' + Math.max(1, Math.round((f.size_bytes || 0) / 1024)) +
              ' КБ · ' + fmtWhen(f.created_at) + '</span></a>';
          }).join('') + '</div>'
        : '<div class="ct-blk-b">Пока ничего не приложено.</div>') +
      (!canFile ? '' :
        '<div class="mw-up"><input type="file" id="mw-file" hidden>' +
          '<button class="bp sm ghost" id="mw-add">' + ic('plus', 13) + 'Приложить файл</button>' +
          '<span class="cz-fine">До 8 МБ. Работу принимают по тому, что здесь лежит.</span>' +
        '</div>') +
    '</div>';

    var ev = (t.events || []).map(function (e) {
      return '<div class="ct-ev"><span class="ct-ev-d">' + esc(czDate(e.at)) + '</span>' +
        '<span class="ct-ev-t">' + esc(e.text) + '</span>' +
        (e.author ? '<span class="ct-ev-a">' + esc(e.author) + '</span>' : '') + '</div>';
    }).join('');

    modal.innerHTML =
      '<div class="m-head">' +
        '<div class="m-navfloat"><button class="m-arrow" id="mw-x">' + ic('x', 14) + '</button></div>' +
        '<div class="m-id"><div class="m-name-row"><div class="m-name">' +
          '<span class="ct-no">№' + t.number + '</span>' + esc(t.title) + '</div></div>' +
          '<div class="m-sub"><span class="sev ' + (CT_ST[t.status] || 'ct-draft') + '">' +
            esc(mwSt(t)) + '</span>' +
            (MW_HINT[t.status]
              ? '<span class="dot-sep"></span><span>' + esc(MW_HINT[t.status]) + '</span>' : '') +
          '</div></div>' +
      '</div>' +
      '<div class="m-body"><div class="m-content">' +
        '<div class="mw-top">' +
          '<div class="mw-t1"><span class="mw-t-k">Сумма</span>' +
            '<b>' + ctMoney(t.amount) + ' ₽</b></div>' +
          '<div class="mw-t1"><span class="mw-t-k">Срок</span>' +
            '<b>' + esc(mwTerm(t)) + '</b></div>' +
        '</div>' +
        doing + where + extra + actBlock + files +
        '<div class="m-sec"><div class="m-sec-h">История</div>' +
          '<div class="ct-hist">' + (ev || '<span class="cz-fine">Пока пусто</span>') + '</div></div>' +
        (acts ? '<div class="ct-acts mw-do">' + acts + '</div>' : '') +
      '</div></div>';

    el('mw-x').addEventListener('click', mwClose);
    var add = el('mw-add'), inp = el('mw-file');
    if (add && inp) {
      add.addEventListener('click', function () { inp.click(); });
      inp.addEventListener('change', function () { mwUpload(t.id, inp.files[0]); });
    }
    Array.prototype.forEach.call(modal.querySelectorAll('[data-mwsign]'), function (b) {
      b.addEventListener('click', function () { mwSign(b.getAttribute('data-mwsign')); });
    });
    Array.prototype.forEach.call(modal.querySelectorAll('[data-mwa]'), function (b) {
      b.addEventListener('click', function () {
        var to = b.getAttribute('data-mwa');
        if (to === 'declined') return mwDecline(t.id);
        mwAct(t.id, to);
      });
    });
  }

  /* Маленькая форма-вопрос на той же модалке дизайн-системы: пара полей и проверка.
     Возврат строки из обработчика = текст ошибки под формой, null = все хорошо. */
  function openSheet(title, sub, fields, onOk, live, eyebrow, okLabel) {
    if (document.querySelector('.al-ov')) return;
    var ov = document.createElement('div');
    // форма открывается ПОВЕРХ карточки задания — обычный слой модалки лежит под ней
    ov.className = 'al-ov over';
    ov.innerHTML =
      '<div class="al-card" role="dialog" aria-modal="true">' +
        '<div class="al-head">' +
          '<div><div class="al-eyebrow">' + esc(eyebrow || 'Задание') + '</div>' +
            '<div class="al-title">' + esc(title) + '</div></div>' +
          '<button class="al-x" id="sh-x" title="Закрыть">' + ic('x', 16) + '</button>' +
        '</div>' +
        (sub ? '<div class="al-sub">' + esc(sub) + '</div>' : '') +
        '<div class="al-body">' +
          fields.map(function (f) {
            return '<label class="al-f"><span class="al-l">' + esc(f[2]) + '</span>' +
              (f[1] === 'text'
                ? '<textarea id="sh-' + f[0] + '" class="al-in al-ta" rows="2" maxlength="1000"></textarea>'
                : '<input id="sh-' + f[0] + '" class="al-in" type="' +
                    (f[1] === 'line' ? 'text' : f[1]) + '" value="' + esc(f[3]) + '">') +
              '</label>';
          }).join('') +
          (live ? '<div class="ct-live" id="sh-live"></div>' : '') +
          '<div class="ct-err" id="sh-err"></div>' +
        '</div>' +
        '<div class="al-foot"><button class="al-cancel" id="sh-cancel">Отмена</button>' +
          '<button class="bp al-save" id="sh-ok">' + esc(okLabel || 'Сохранить') + '</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    fields.forEach(function (f) { if (f[1] === 'text') el('sh-' + f[0]).value = f[3] || ''; });
    var vals = function () {
      var v = {};
      fields.forEach(function (f) { v[f[0]] = el('sh-' + f[0]).value; });
      return v;
    };
    if (live) {
      var upd = function () { el('sh-live').innerHTML = live(vals()); };
      fields.forEach(function (f) { el('sh-' + f[0]).addEventListener('input', upd); });
      upd();
    }
    var closed = false;
    var close = function () {
      if (closed) return; closed = true;
      ov.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 180);
    };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);
    el('sh-x').addEventListener('click', close);
    el('sh-cancel').addEventListener('click', close);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    el('sh-ok').addEventListener('click', function () {
      var err = onOk(vals(), close);
      if (err) el('sh-err').textContent = err;
    });
    setTimeout(function () { el('sh-' + fields[0][0]).focus(); }, 30);
  }

  /* ── ВЕДОМОСТЬ (финансовая модель) — этап 1: смотреть ──────────────────────
     Ведомость — не отчет, а рабочий цикл выплат: сколько пришло, сколько отложили в
     фонды, сколько потратили и хватает ли денег, чтобы период закрыть. До сих пор она
     жила отдельным приложением со своим логином; решение владельца от 2026-08-11 —
     перенести ее в CRM, потому что доходы приходят из ЮKassa и карточек клиентов, а
     расходы на подрядчиков придут из модуля самозанятых.

     Этап 1 — только чтение (план: `_specs/finmodel/plan.md`). Правка остается в старом
     приложении, пока экраны не приняты: показать неверную цифру плохо, а дать по ней
     нажать — хуже.

     Главный экран построен вокруг КАСКАДА: доход → краткосрочка → база → фонды →
     прямые расходы → чистая → флекс → дивиденды. Порядок жесткий, каждый шаг считается
     от предыдущего, и спор в команде идет именно о нем — поэтому он и есть якорь
     экрана, а не набор одинаковых плиток. Считает все бэкенд (routers/fin.py), который
     зовет функции схемы finmodel: две копии формул разъедутся, и никто не докажет, чья
     цифра верная. */
  var FIN = { periods: null, id: null, sheet: null, ops: null, pnl: null, refs: null,
              scope: 'all', src: '', kind: '', q: '', err: '', _t: null };

  /* Суммы ведомости — всегда с копейками: тут сходятся акты и выписки, и округление
     «для красоты» превращается в расхождение, которое потом ищут руками. */
  function finNum(v, dec) {
    var d = dec === undefined ? 2 : dec;
    var x = Number(v) || 0;
    var neg = x < 0;
    var s = Math.abs(x).toFixed(d).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '−' : '') + s.join(',');
  }
  function finRub(v, dec) { return finNum(v, dec) + ' ₽'; }
  function finPct(v) { return finNum(v, 1) + '%'; }
  function finDate(s) {
    if (!s) return '—';
    var p = String(s).split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : s;
  }
  function finErrText(e) {
    var m = String((e && e.message) || '');
    if (m.indexOf('503') !== -1) return 'Ведомость на этом сервере пока не подключена: раздел работает только там, где выложены новые ручки бэкенда.';
    if (m.indexOf('404') !== -1) return 'Ведомостей пока нет — ни одного периода не заведено.';
    return 'Не удалось загрузить ведомость. Проверьте связь и обновите страницу.';
  }
  function finErrView(view) {
    view.innerHTML = '<div class="card"><div class="empty">' + esc(FIN.err) + '</div></div>';
    pageAnim(view);
  }
  /* Хвост запроса с выбранным периодом. Период не хранится на сервере: какой открыт на
     экране, за тот и спрашиваем — иначе две вкладки покажут разные цифры под одним
     заголовком. */
  function finQ(extra) {
    var q = FIN.id ? 'id=' + encodeURIComponent(FIN.id) : '';
    if (extra) q += (q ? '&' : '') + extra;
    return q ? '?' + q : '';
  }
  function finFail(e, key) {
    if (e && e.message === '403') return;
    FIN.err = finErrText(e);
    FIN[key] = FIN[key] || 'none';
    renderAll();
  }
  function finLoadPeriods(cb) {
    api('/admin/api/fin/periods').then(function (r) {
      FIN.periods = r.periods || [];
      FIN.err = '';
      if (!FIN.id) FIN.id = r.open_id || (FIN.periods[0] && FIN.periods[0].id) || null;
      if (cb) cb();
      renderAll();
    }).catch(function (e) { FIN.periods = []; finFail(e, 'periods'); });
  }
  function finLoadSheet() {
    if (!FIN.periods) return finLoadPeriods(function () { finLoadSheet(); });
    api('/admin/api/fin/period' + finQ()).then(function (r) {
      FIN.sheet = r; FIN.err = '';
      if (state.page === 'finsheet') renderAll();
    }).catch(function (e) { finFail(e, 'sheet'); });
  }
  function finLoadOps() {
    if (!FIN.periods) return finLoadPeriods(function () { finLoadOps(); });
    var ex = [];
    if (FIN.src) ex.push('source=' + encodeURIComponent(FIN.src));
    if (FIN.kind) ex.push('kind=' + encodeURIComponent(FIN.kind));
    if (FIN.q) ex.push('q=' + encodeURIComponent(FIN.q));
    api('/admin/api/fin/operations' + finQ(ex.join('&'))).then(function (r) {
      FIN.ops = r; FIN.err = '';
      if (state.page === 'finops') renderAll();
    }).catch(function (e) { finFail(e, 'ops'); });
  }
  function finLoadPnl() {
    if (!FIN.periods) return finLoadPeriods(function () { finLoadPnl(); });
    api('/admin/api/fin/pnl' + finQ('scope=' + FIN.scope)).then(function (r) {
      FIN.pnl = r; FIN.err = '';
      if (state.page === 'finpnl') renderAll();
    }).catch(function (e) { finFail(e, 'pnl'); });
  }
  function finLoadRefs() {
    api('/admin/api/fin/refs').then(function (r) {
      FIN.refs = r; FIN.err = '';
      if (state.page === 'finref') renderAll();
    }).catch(function (e) { finFail(e, 'refs'); });
  }
  /* Смена периода сбрасывает ВСЕ куски экрана разом: каскад одного периода рядом с
     операциями другого — это не «частично устарело», это неправильные данные. */
  function finSetPeriod(id) {
    if (FIN.id === id) return;
    FIN.id = id; FIN.sheet = null; FIN.ops = null; FIN.pnl = null;
    renderAll();
  }
  function finPeriod() {
    var l = FIN.periods || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === FIN.id) return l[i];
    return l[0] || null;
  }

  var FIN_SCOPES = [['period', 'Ведомость'], ['month', 'Месяц'], ['quarter', 'Квартал'],
                    ['year', 'Год'], ['all', 'Все время']];
  var FIN_KINDS = [['', 'Все'], ['доход', 'Доходы'], ['расход', 'Расходы'], ['перевод', 'Переводы']];

  /* Главный экран: каскад + фонды + счета + касса. */
  function renderFinSheet(view) {
    if (!FIN.sheet) {
      if (FIN.err) return finErrView(view);
      view.innerHTML = dashSkeleton(); finLoadSheet(); return;
    }
    if (FIN.sheet === 'none') return finErrView(view);
    var s = FIN.sheet, c = s.cascade, m = s.metrics || {}, cash = s.cash || {};
    var funds = (s.rules || []).filter(function (r) {
      return r.account_id !== 'shortterm' && r.account_id !== 'flex';
    });
    var stRule = null, flexRule = null;
    (s.rules || []).forEach(function (r) {
      if (r.account_id === 'shortterm') stRule = r;
      if (r.account_id === 'flex') flexRule = r;
    });

    var bar = statBar([
      { label: 'Доход к зачислению', value: finRub(c.income, 0), sub: 'уже за вычетом комиссии' },
      { label: 'Дивиденды', value: finRub(c.dividends, 0), sub: 'после всех отчислений' },
      { label: 'Денег в фондах', value: finRub(m.in_funds, 0), sub: 'по всем фондам сразу' },
      { label: 'Остаток на р/с', value: finRub(m.on_vtb, 0), sub: 'сколько реально на ВТБ' },
    ]);

    var rows = [{ cls: 'in', name: 'Доход к зачислению',
                  why: 'все, что пришло за период, за вычетом комиссии эквайринга',
                  v: c.income }];
    rows.push({ cls: 'out', name: 'Фонд краткосрочки',
                why: stRule ? stRule.explain : 'вычитается первым, до остальных фондов',
                v: -c.shortterm });
    rows.push({ cls: 'sum', name: 'База для отчислений',
                why: 'от нее считаются проценты фондов', v: c.base });
    funds.forEach(function (r) {
      rows.push({ cls: 'out', name: r.name, why: r.explain, v: -r.amount });
    });
    rows.push({ cls: 'out', name: 'Прямые расходы',
                why: 'факт из расчетных листов: зарплаты, сервисы, реклама',
                v: -c.direct });
    rows.push({ cls: 'sum', name: 'Чистая прибыль', why: '', v: c.profit });
    rows.push({ cls: 'out', name: 'Флекс-проджекта',
                why: flexRule ? flexRule.explain : '20% от чистой прибыли', v: -c.flex });
    rows.push({ cls: 'total', name: 'Дивиденды', why: 'то, что остается к распределению',
                v: c.dividends });

    var casc = '<div class="card fin-casc">' +
      '<div class="sec-head"><span class="ic">' + ic('coins', 14) + '</span>' +
        '<div><div class="t">Каскад ведомости</div>' +
        '<div class="s">каждый шаг считается от предыдущего — сверху вниз</div></div></div>' +
      '<div class="fc-rows">' + rows.map(function (r) {
        return '<div class="fc-row ' + r.cls + '">' +
          '<div class="fc-l"><span class="fc-name">' + esc(r.name) + '</span>' +
            (r.why ? '<span class="fc-why">' + esc(r.why) + '</span>' : '') + '</div>' +
          '<div class="fc-v num' + (r.v < 0 && r.cls !== 'out' ? ' neg' : '') + '">' + finRub(r.v) + '</div></div>';
      }).join('') + '</div></div>';

    var direct = (s.direct || []).length
      ? '<div class="card fin-block">' +
        '<div class="sec-head"><span class="ic">' + ic('rows', 14) + '</span>' +
          '<div><div class="t">Прямые расходы по разделам</div>' +
          '<div class="s">из чего сложились ' + finRub(c.direct) + '</div></div></div>' +
        '<div class="fin-list">' + s.direct.map(function (d) {
          var w = c.direct ? Math.max(2, Math.round(d.amount / c.direct * 100)) : 0;
          return '<div class="fl-row"><div class="fl-main"><span class="fl-name">' + esc(d.source) + '</span>' +
            '<span class="fl-sub">' + d.count + ' ' + plural(d.count, 'операция', 'операции', 'операций') + '</span></div>' +
            '<div class="fl-bar"><i style="width:' + w + '%"></i></div>' +
            '<div class="fl-v num">' + finRub(d.amount) + '</div></div>';
        }).join('') + '</div></div>'
      : '';

    var fundsCard = '<div class="card fin-block">' +
      '<div class="sec-head"><span class="ic">' + ic('wallet', 14) + '</span>' +
        '<div><div class="t">Фонды</div>' +
        '<div class="s">остаток с прошлого периода, движение и что уедет в следующий</div></div></div>' +
      '<div class="fin-funds">' + (s.funds || []).filter(function (f) {
        return f.kind === 'фонд';
      }).map(function (f) {
        return '<div class="ff-row' + (f.alert ? ' warn' : '') + '">' +
          '<div class="ff-top"><span class="ff-name">' + esc(f.name) + '</span>' +
            '<span class="ff-v num">' + finRub(f.next) + '</span></div>' +
          '<div class="ff-sub"><span>было ' + finNum(f.opening) + '</span>' +
            '<span>отложили ' + finNum(f.added) + '</span>' +
            '<span>потратили ' + finNum(f.spent) + '</span></div>' +
          /* Сервер говорит «фонд ушел в минус», сравнивая с остатком ДО отложений
             этого периода. Рядом с положительным итогом такая фраза читается как
             ошибка, поэтому показываем ту самую цифру, о которой речь. */
          (f.alert ? '<div class="ff-warn">Тратили больше, чем на фонде оставалось: до отложений ' +
            finRub(f.balance) + '</div>' : '') +
        '</div>';
      }).join('') + '</div></div>';

    var cashCard = '<div class="card fin-block">' +
      '<div class="sec-head"><span class="ic">' + ic('card', 14) + '</span>' +
        '<div><div class="t">Движение денег</div>' +
        '<div class="s">это не прибыль, а сколько осталось на расчетном счете</div></div></div>' +
      '<div class="fin-kv">' +
        '<div class="fkv"><span>Пришло на р/с</span><b class="num">' + finRub(cash.in) + '</b></div>' +
        '<div class="fkv"><span>Ушло наружу</span><b class="num">' + finRub(-cash.out) + '</b></div>' +
        '<div class="fkv"><span>Ушло в фонды</span><b class="num">' + finRub(-cash.to_funds) + '</b></div>' +
        '<div class="fkv total"><span>Остаток на р/с</span><b class="num">' + finRub(cash.flow) + '</b></div>' +
      '</div></div>';

    var warn = (s.warnings || []).length
      ? '<div class="card fin-block">' +
        '<div class="sec-head"><span class="ic">' + ic('alert', 14) + '</span>' +
          '<div><div class="t">Перед закрытием периода</div>' +
          '<div class="s">что стоит проверить, прежде чем платить</div></div></div>' +
        '<div class="fin-list">' + s.warnings.map(function (w) {
          return '<div class="fl-row fl-2 warn"><div class="fl-main">' +
            '<span class="fl-name">' + esc(w.account) + '</span>' +
            '<span class="fl-sub">' + esc(w.problem) + '</span></div>' +
            '<div class="fl-v num">' + finRub(w.amount) + '</div></div>';
        }).join('') + '</div></div>'
      : '';

    view.innerHTML = bar + '<div class="grid">' +
      '<div class="sp7">' + casc + direct + '</div>' +
      '<div class="sp5">' + fundsCard + cashCard + warn + '</div></div>';
    pageAnim(view);
  }

  /* P&L: только факт, нарастающим итогом. План сюда не попадает никогда — это отчет о
     том, что случилось, а не о том, что собирались сделать. */
  function renderFinPnl(view) {
    if (!FIN.pnl) {
      if (FIN.err) return finErrView(view);
      view.innerHTML = dashSkeleton(); finLoadPnl(); return;
    }
    if (FIN.pnl === 'none') return finErrView(view);
    var p = FIN.pnl, t = p.totals || {};
    var ladder = [
      { name: 'Выручка', v: t.revenue, cls: 'in' },
      { name: 'Переменные расходы', v: -t.variable, cls: 'out' },
      { name: 'Валовая прибыль', v: t.gross, cls: 'sum', pct: t.gross_pct, pctName: 'валовая рентабельность' },
      { name: 'Постоянные расходы', v: -t.fixed, cls: 'out' },
      { name: 'Операционная прибыль', v: t.operating, cls: 'sum', pct: t.margin_pct, pctName: 'маржинальность' },
      { name: 'Налоги', v: -t.taxes, cls: 'out' },
      { name: 'Чистая прибыль', v: t.net, cls: 'total', pct: t.net_pct, pctName: 'чистая рентабельность' },
    ];
    if (t.other_income) ladder.splice(5, 0, { name: 'Прочие доходы', v: t.other_income, cls: 'in' });
    if (t.other_expense) ladder.splice(5, 0, { name: 'Прочие расходы', v: -t.other_expense, cls: 'out' });
    if (t.interest) ladder.splice(ladder.length - 1, 0, { name: 'Проценты по кредитам', v: -t.interest, cls: 'out' });

    var lad = '<div class="card fin-casc">' +
      '<div class="sec-head"><span class="ic">' + ic('chart', 14) + '</span>' +
        '<div><div class="t">Отчет о прибылях и убытках</div>' +
        '<div class="s">' + (p.from ? finDate(p.from) + ' — ' + finDate(p.to) : 'за все время') +
        ', только факт</div></div></div>' +
      '<div class="fc-rows">' + ladder.map(function (r) {
        return '<div class="fc-row ' + r.cls + '">' +
          '<div class="fc-l"><span class="fc-name">' + esc(r.name) + '</span>' +
            (r.pct !== undefined ? '<span class="fc-why">' + esc(r.pctName) + ' ' + finPct(r.pct) + '</span>' : '') +
          '</div><div class="fc-v num' + (r.v < 0 && r.cls !== 'out' ? ' neg' : '') + '">' + finRub(r.v) + '</div></div>';
      }).join('') + '</div>' +
      (t.unsorted ? '<div class="fin-note">' + ic('alert', 13) +
        'Без статьи осталось ' + finRub(t.unsorted) + ' — эти операции в отчет не попали и их надо разнести.</div>' : '') +
    '</div>';

    var groups = (p.groups || []).map(function (g) {
      return '<div class="fg">' +
        '<div class="fg-head"><span>' + esc(g.name) + '</span><b class="num">' + finRub(g.total) + '</b></div>' +
        g.items.map(function (i) {
          // Число операций держим у названия, а не у суммы: рядом с деньгами оно
          // читается как часть цифры.
          return '<div class="fg-row"><span class="fg-n">' + esc(i.name) +
            '<i class="fg-c num">' + i.count + '</i></span>' +
            '<span class="fg-v num">' + finRub(i.amount) + '</span></div>';
        }).join('') + '</div>';
    }).join('');

    var offers = (p.offerings || []).length
      ? '<div class="card fin-block">' +
        '<div class="sec-head"><span class="ic">' + ic('box', 14) + '</span>' +
          '<div><div class="t">По услугам</div><div class="s">где сколько заработали</div></div></div>' +
        '<div class="fin-list">' + p.offerings.map(function (o) {
          return '<div class="fl-row fl-2"><div class="fl-main">' +
            '<span class="fl-name">' + esc(o.name) + '</span>' +
            '<span class="fl-sub">валовая ' + finRub(o.gross) + ' · маржа ' + finPct(o.margin_pct) + '</span></div>' +
            '<div class="fl-v num">' + finRub(o.revenue) + '</div></div>';
        }).join('') + '</div></div>'
      : '';

    view.innerHTML = '<div class="grid">' +
      '<div class="sp7">' + lad + '</div>' +
      '<div class="sp5">' +
        '<div class="card fin-block"><div class="sec-head"><span class="ic">' + ic('rows', 14) + '</span>' +
          '<div><div class="t">Статьи</div><div class="s">из чего сложились цифры слева</div></div></div>' +
          '<div class="fin-groups">' + (groups || '<div class="empty">Операций за этот отрезок нет.</div>') + '</div></div>' +
        offers +
      '</div></div>';
    pageAnim(view);
  }

  /* Карта операций: все, что внесено, одной лентой. Новое сверху. */
  function renderFinOps(view) {
    if (!FIN.ops) {
      if (FIN.err) return finErrView(view);
      view.innerHTML = dashSkeleton(); finLoadOps(); return;
    }
    if (FIN.ops === 'none') return finErrView(view);
    var o = FIN.ops;
    var chips = FIN_KINDS.map(function (kk) {
      return '<button class="qchip' + (FIN.kind === kk[0] ? ' on' : '') + '" data-fkind="' + kk[0] + '">' + kk[1] + '</button>';
    }).join('') + ((o.sources || []).length ? '<span class="qsep">раздел</span>' : '') +
      (o.sources || []).map(function (src) {
      return '<button class="qchip' + (FIN.src === src ? ' on' : '') + '" data-fsrc="' + esc(src) + '">' + esc(src) + '</button>';
    }).join('');

    var rows = (o.items || []).map(function (it) {
      var neg = it.kind === 'расход';
      return '<div class="trow fin-grid' + (it.included === false ? ' muted' : '') + '">' +
        '<span class="num fo-date">' + finDate(it.date) + '</span>' +
        '<span class="fo-what"><b>' + esc(it.counterparty || it.item || '—') + '</b>' +
          '<i>' + esc(it.item || it.category || '') + (it.comment ? ' · ' + esc(it.comment) : '') + '</i></span>' +
        '<span class="fo-src">' + esc(it.source || '—') + '</span>' +
        '<span class="fo-acc">' + esc(it.account || '—') +
          (it.account_to ? ' → ' + esc(it.account_to) : '') + '</span>' +
        '<span class="num fo-sum' + (neg ? ' neg' : '') + '">' + finRub(neg ? -it.amount : it.amount) + '</span>' +
        '<span class="fo-st"><span class="fst ' + (it.status === 'факт' ? 'ok' : 'wait') + '">' + esc(it.status) + '</span></span>' +
      '</div>';
    }).join('');

    view.innerHTML = '<div class="card listcard">' +
      '<div class="list-tools">' +
        '<div class="searchwrap' + (FIN.q ? ' has-val' : '') + '">' + ic('search', 16) +
          '<input class="search" id="fo-q" placeholder="Поиск по контрагенту, статье или комментарию" value="' + esc(FIN.q) + '">' +
          (FIN.q ? '<button class="s-clear" id="fo-qx">' + ic('x', 13) + '</button>' : '') +
        '</div>' +
        '<span class="list-count"><b>' + o.total + '</b> ' +
          plural(o.total, 'операция', 'операции', 'операций') +
          ' · доход <b>' + finRub(o.income) + '</b> · расход <b>' + finRub(o.expense) + '</b></span>' +
      '</div>' +
      '<div class="list-quick">' + chips + '</div>' +
      '<div class="trow fin-grid thead">' +
        '<span class="th">Дата</span><span class="th">Что</span><span class="th">Раздел</span>' +
        '<span class="th">Счет</span><span class="th">Сумма</span><span class="th">Статус</span>' +
      '</div>' +
      (rows || '<div class="empty">Под эти условия операций не нашлось.</div>') +
      ((o.items || []).length >= o.limit
        ? '<div class="fin-note">Показаны первые ' + o.limit + ' операций из ' + o.total + '. Сузьте фильтр, чтобы увидеть остальные.</div>'
        : '') +
    '</div>';

    var qi = el('fo-q');
    if (qi) {
      qi.addEventListener('input', function () {
        FIN.q = qi.value;
        clearTimeout(FIN._t);
        FIN._t = setTimeout(function () { finLoadOps(); }, 250);
      });
      qi.addEventListener('keydown', function (e) { if (e.key === 'Escape') { FIN.q = ''; finLoadOps(); } });
    }
    var qx = el('fo-qx');
    if (qx) qx.addEventListener('click', function () { FIN.q = ''; finLoadOps(); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-fkind]'), function (b) {
      b.addEventListener('click', function () { FIN.kind = b.getAttribute('data-fkind'); finLoadOps(); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-fsrc]'), function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-fsrc');
        FIN.src = FIN.src === v ? '' : v;
        finLoadOps();
      });
    });
    pageAnim(view);
  }

  /* Сервисы и обязательства: то, что спишется само, и то, что мы должны. */
  function renderFinRefs(view) {
    if (!FIN.refs) {
      if (FIN.err) return finErrView(view);
      view.innerHTML = dashSkeleton(); finLoadRefs(); return;
    }
    if (FIN.refs === 'none') return finErrView(view);
    var r = FIN.refs;
    var today = new Date().toISOString().slice(0, 10);
    var services = (r.services || []).map(function (s) {
      var soon = s.next_on && s.next_on <= today;
      return '<div class="fl-row fl-2' + (soon ? ' warn' : '') + (s.active ? '' : ' muted') + '">' +
        '<div class="fl-main"><span class="fl-name">' + esc(s.name) + '</span>' +
          // Прошедшая дата — это не «следующее списание», а «пора платить»: подпись
          // должна говорить, что делать, а не когда собирались.
          '<span class="fl-sub">' + (s.next_on
            ? (soon ? 'пора платить — срок был ' + finDate(s.next_on)
                    : 'следующее списание ' + finDate(s.next_on))
            : 'дата списания не задана') +
          (s.counterparty ? ' · ' + esc(s.counterparty) : '') + '</span></div>' +
        '<div class="fl-v num">' + finRub(s.amount) + '</div></div>';
    }).join('');
    var obl = (r.obligations || []).map(function (o) {
      var done = o.status === 'погашен' || o.remaining <= 0;
      return '<div class="fl-row fl-2' + (done ? ' muted' : '') + '">' +
        '<div class="fl-main"><span class="fl-name">' + esc(o.title || o.kind) + '</span>' +
          '<span class="fl-sub">' + esc(o.counterparty || '') +
          ' · всего ' + finRub(o.principal) + ' · погашено ' + finRub(o.paid) + '</span></div>' +
        '<div class="fl-v num">' + finRub(o.remaining) + '</div></div>';
    }).join('');

    view.innerHTML = '<div class="grid">' +
      '<div class="sp7"><div class="card fin-block">' +
        '<div class="sec-head"><span class="ic">' + ic('clock', 14) + '</span>' +
          '<div><div class="t">Сервисы</div>' +
          '<div class="s">регулярные списания: подписки, связь, банк</div></div></div>' +
        '<div class="fin-list">' + (services || '<div class="empty">Сервисов пока нет.</div>') + '</div>' +
      '</div></div>' +
      '<div class="sp5"><div class="card fin-block">' +
        '<div class="sec-head"><span class="ic">' + ic('shield', 14) + '</span>' +
          '<div><div class="t">Долги и кредиты</div>' +
          '<div class="s">остаток едет в следующий период, пока не погашен</div></div></div>' +
        '<div class="fin-list">' + (obl || '<div class="empty">Обязательств нет.</div>') + '</div>' +
      '</div></div></div>';
    pageAnim(view);
  }

  /* ── Команда и роли (Super Admin) ── */
  /* Короткая подпись темы для чипа в строке: полную («документы и гранты») отдает сервер,
     она уходит в title. В строке нужна одна ширина на всех, иначе колонка едет. */
  var TM_TOPIC_SHORT = { lang: 'Язык', docs: 'Документы', sales: 'Продажи' };
  function tmTopicChips(u) {
    var mine = u.notify_topics || [];
    return '<span class="tm-tp" data-uid="' + u.id + '">' +
      (state._teamTopics || []).map(function (t) {
        var on = mine.indexOf(t.id) >= 0;
        return '<button type="button" class="tm-tp-b' + (on ? ' on' : '') + '" data-t="' + esc(t.id) + '" ' +
          'title="' + esc(on ? 'Приходят уведомления: ' + t.label : 'Не приходят: ' + t.label) + '">' +
          esc(TM_TOPIC_SHORT[t.id] || t.label) + '</button>';
      }).join('') + '</span>';
  }
  /* Подстрочник сотрудника. Про уведомления говорим только там, где есть о чем: тема
     отмечена, а мессенджер не подключен — это тишина, а не доставка, и знать об этом надо
     до того, как клиент повиснет. Без тем строка молчит — пустые чипы и так все сказали. */
  function tmSub(u) {
    var mine = u.notify_topics || [];
    if (!mine.length) return '';
    if (!u.notify_linked) {
      return '<span class="tm-warn" title="Тема отмечена, но человек не нажал «Начать» ' +
        'у бота уведомлений — сообщение ему не дойдет">' + ic('alert', 11) + 'нет мессенджера</span>';
    }
    return 'уведомления в ' + (u.notify_channel === 'max' ? 'Макс' : 'Телеграм');
  }
  function tmLine(u) {
    var sub = tmSub(u);
    return '@' + esc(u.login) + (sub ? ' · ' + sub : '');
  }
  function renderTeam(view) {
    if (!state._team) {
      view.innerHTML = dashSkeleton();
      api('/admin/api/team').then(function (r) {
        state._team = (r && r.users) || [];
        state._teamTopics = (r && r.topics) || [];
        state._teamShared = !r || r.shared_chat !== false;
        if (state.page === 'team') renderView();
      }).catch(function () { state._team = 'none'; if (state.page === 'team') renderView(); });
      return;
    }
    if (state._team === 'none') { view.innerHTML = '<div class="card"><div class="empty">Не удалось загрузить команду. Нужен доступ Super Admin.</div></div>'; return; }
    /* верхние роли раздает только тот, у кого они уже есть — бэкенд отвечает тем же
       (иначе руководитель выписывал бы себе доступ к финансам и документам детей) */
    var iAmTop = state.role === 'super_admin' || state.role === 'owner';
    var assignable = Object.keys(ROLES).filter(function (k) {
      if (k === 'owner' || k === 'manager') return false;
      return k !== 'super_admin' || iAmTop;
    });
    function roleOpts(cur) {
      return assignable.map(function (k) {
        return '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + ROLES[k].label + '</option>';
      }).join('');
    }
    var rows = state._team.map(function (u) {
      var label = ROLES[u.role] ? ROLES[u.role].label : u.role;
      /* Чужую верхнюю учетку не правит тот, кто сам не верхний — бэкенд отвечает 403.
         Показываем ее настоящую роль и запираем поля: пустой селект «Куратор» напротив
         супер-админа врал бы о том, кто в системе главный. */
      var lock = (u.role === 'super_admin' || u.role === 'owner') && !iAmTop;
      var legacy = (u.role === 'owner' || u.role === 'manager') ? '<option value="' + u.role + '" selected>' + label + ' (legacy)</option>' : '';
      var sel = lock
        ? '<select class="tm-sel" disabled title="Верхнюю роль меняет только владелец"><option>' + esc(label) + '</option></select>'
        : '<select class="tm-sel" data-uid="' + u.id + '">' + legacy + roleOpts(u.role) + '</select>';
      return '<div class="tm-row"><span class="tm-av">' + esc(initials(u.name || u.login)) + '</span>' +
        '<div class="tm-i"><div class="tm-n">' + esc(u.name || u.login) + '</div>' +
          '<div class="tm-l">' + tmLine(u) + '</div></div>' +
        tmTopicChips(u) +
        '<input class="tm-mail' + (u.email ? '' : ' none') + '" data-uid="' + u.id + '" type="email" autocomplete="off" ' +
          (lock ? 'disabled ' : '') + 'value="' + esc(u.email || '') + '" placeholder="почта для входа">' +
        sel + '</div>';
    }).join('');

    /* Только что заведенный сотрудник: пароль показываем ОДИН раз — в базе лежит
       только его хеш, второй раз взять неоткуда. */
    var made = state._teamMade;
    var madeHtml = made ? '<div class="tm-made">' +
        '<div class="tm-made-h">' + ic('check', 14) + 'Сотрудник заведен: ' + esc(made.user.name) + '</div>' +
        '<div class="tm-made-b">Логин <b>' + esc(made.user.login) + '</b> · пароль <b>' + esc(made.password) + '</b></div>' +
        '<div class="tm-made-s">Передайте пароль лично и попросите сменить его после первого входа. ' +
          'Здесь он больше не появится — мы храним только его отпечаток.</div>' +
        '<div class="tm-made-a"><button class="bp sm" id="tm-copy">' + ic('copy', 13) + 'Скопировать</button>' +
        '<button class="bp sm ghost" id="tm-made-x">Понятно</button></div></div>' : '';

    var d = state._teamNew;
    var formHtml = d ? '<div class="tm-add">' +
        '<div class="tm-add-g">' +
          '<label class="tm-f"><span>Имя</span><input id="tn-name" value="' + esc(d.name) + '" placeholder="Лиана Эванс" autocomplete="off"></label>' +
          '<label class="tm-f"><span>Логин</span><input id="tn-login" value="' + esc(d.login) + '" placeholder="liana" autocomplete="off"></label>' +
          '<label class="tm-f"><span>Почта</span><input id="tn-email" type="email" value="' + esc(d.email) + '" placeholder="liana@example.com" autocomplete="off"></label>' +
          '<label class="tm-f"><span>Роль</span><select id="tn-role">' + roleOpts(d.role) + '</select></label>' +
        '</div>' +
        '<div class="tm-add-a"><span class="tm-add-s">Пароль придумаем сами и покажем один раз.</span>' +
        '<button class="bp sm ghost" id="tn-cancel">Отмена</button>' +
        '<button class="bp sm" id="tn-save">Завести</button></div></div>' : '';

    /* Общий чат — исторический адрес, куда падало все и сразу. Выключать его можно, но
       осознанно: пока команда подключается лично, это единственный работающий канал. */
    var sharedOn = state._teamShared !== false;
    var sharedHtml = '<div class="det-sw-row tm-shared">' +
      '<div class="det-sw-b"><div class="det-sw-t">Копия в общий чат</div>' +
        '<div class="det-sw-s">' + (sharedOn
          ? 'Каждое уведомление дублируется в общий чат — там его видят все, кому он открыт.'
          : 'Уведомления идут только тем, за кем закреплена тема. Если по теме никого нет, ' +
            'копия все равно уйдет в общий чат — иначе клиент потеряется.') + '</div></div>' +
      '<button type="button" class="pd-sw' + (sharedOn ? ' on' : '') + '" id="tm-shared">' +
        '<span class="pd-sw-l">' + (sharedOn ? 'Включена' : 'Выключена') + '</span>' +
        '<span class="pd-sw-t"><span class="pd-sw-k"></span></span></button></div>';

    view.innerHTML = '<div class="card" style="padding:24px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('team', 14) + '</span><div><div class="t">Команда и роли</div>' +
      '<div class="s">роль определяет доступ к разделам, темы — кому придет уведомление о клиенте</div></div>' +
      '<span class="cnt num">' + state._team.length + '</span>' +
      (d ? '' : '<button class="bp sm tm-new" id="tm-new">' + ic('plus', 14) + '<span>Добавить сотрудника</span></button>') +
      '</div>' + madeHtml + formHtml +
      '<div class="tm-list">' + (rows || '<div class="empty">Пока только базовые аккаунты.</div>') + '</div>' +
      '<div class="m-sec tm-nsec"><div class="m-sec-h">Уведомления команды</div>' +
        '<div class="tm-hint">Клиент пишет боту и просит человека — уведомление уходит тем, ' +
          'за кем закреплена тема разговора. Мессенджер каждый выбирает сам: профиль → «Уведомления».</div>' +
        sharedHtml + '</div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('.tm-sel'), function (sel) {
      sel.addEventListener('change', function () {
        var u = (state._team || []).filter(function (x) { return String(x.id) === sel.getAttribute('data-uid'); })[0];
        if (u) u.role = sel.value;
        apiSend('/admin/api/users/' + sel.getAttribute('data-uid'), 'PATCH', { role: sel.value }, function () { showToast('Роль обновлена'); });
      });
    });
    /* Тема закрепляется одним нажатием. Локально красим сразу, но правдой считаем ответ
       сервера: не сохранилось — возвращаем чип как был, чтобы галочка не врала. */
    Array.prototype.forEach.call(view.querySelectorAll('.tm-tp-b'), function (b) {
      b.addEventListener('click', function () {
        var uid = b.parentNode.getAttribute('data-uid');
        var u = (state._team || []).filter(function (x) { return String(x.id) === uid; })[0];
        if (!u) return;
        var t = b.getAttribute('data-t'), was = (u.notify_topics || []).slice();
        var next = was.indexOf(t) >= 0
          ? was.filter(function (x) { return x !== t; })
          : was.concat([t]);
        u.notify_topics = next;
        b.classList.toggle('on');
        b.disabled = true;
        apiSend('/admin/api/users/' + uid, 'PATCH', { notify_topics: next }, function () {
          b.disabled = false;
          var sub = b.parentNode.parentNode.querySelector('.tm-l');
          if (sub) sub.innerHTML = tmLine(u);
          showToast(next.length > was.length
            ? (u.name || u.login) + ' получает: ' + (TM_TOPIC_SHORT[t] || t).toLowerCase()
            : (u.name || u.login) + ' больше не получает: ' + (TM_TOPIC_SHORT[t] || t).toLowerCase());
        }, function () {
          b.disabled = false; u.notify_topics = was; b.classList.toggle('on');
          showToast('Не удалось сохранить — попробуйте еще раз');
        });
      });
    });
    var shb = el('tm-shared');
    if (shb) shb.addEventListener('click', function () {
      var next = !(state._teamShared !== false);
      shb.disabled = true;
      apiSend('/admin/api/team/shared-chat', 'PUT', { on: next }, function () {
        state._teamShared = next;
        renderView();
        showToast(next ? 'Копии уходят в общий чат' : 'Общий чат отключен');
      }, function () {
        shb.disabled = false;
        showToast('Не удалось сохранить — попробуйте еще раз');
      });
    });
    /* почта сохраняется по уходу из поля: печатать и слать на каждую букву — лишние запросы */
    Array.prototype.forEach.call(view.querySelectorAll('.tm-mail'), function (inp) {
      inp.addEventListener('change', function () {
        var uid = inp.getAttribute('data-uid');
        var u = (state._team || []).filter(function (x) { return String(x.id) === uid; })[0];
        var val = inp.value.trim();
        if (u && (u.email || '') === val) return;
        apiSend('/admin/api/users/' + uid, 'PATCH', { email: val }, function () {
          if (u) u.email = val;
          inp.classList.toggle('none', !val);
          showToast(val ? 'Почта сохранена' : 'Почта убрана');
        });
      });
    });

    var nb = el('tm-new');
    if (nb) nb.addEventListener('click', function () {
      state._teamNew = { name: '', login: '', email: '', role: 'curator' };
      state._teamMade = null;   // прошлый выданный пароль убираем: он уже передан
      renderView();
      var f = el('tn-name'); if (f) f.focus();
    });
    var cx = el('tn-cancel');
    if (cx) cx.addEventListener('click', function () { state._teamNew = null; renderView(); });
    var mx = el('tm-made-x');
    if (mx) mx.addEventListener('click', function () { state._teamMade = null; renderView(); });
    var cp = el('tm-copy');
    if (cp) cp.addEventListener('click', function () {
      var m = state._teamMade;
      copyText('Логин: ' + m.user.login + '\nПароль: ' + m.password + '\nАдрес: ' + CRM_HOME);
    });
    ['tn-name', 'tn-login', 'tn-email', 'tn-role'].forEach(function (id) {
      var f = el(id);
      if (f) f.addEventListener('input', function () {
        state._teamNew[id.slice(3)] = f.value;
      });
    });
    var sv = el('tn-save');
    if (sv) sv.addEventListener('click', function () {
      var body = state._teamNew || {};
      if (!body.name.trim() || !body.login.trim()) return showToast('Заполните имя и логин');
      sv.disabled = true;
      apiSend('/admin/api/users', 'POST', {
        name: body.name.trim(), login: body.login.trim().toLowerCase(),
        email: body.email.trim(), role: body.role,
      }, function (r) {
        state._teamNew = null;
        state._teamMade = r;
        state._team = null;   // перечитываем список с сервера, а не дорисовываем локально
        renderView();
      }, function (code) {
        sv.disabled = false;
        showToast(code === 409 ? 'Такой логин или почта уже заняты'
          : code === 403 ? 'Эту роль может выдать только владелец'
          : code === 422 ? 'Проверьте логин: латиница, цифры, точка и дефис, от 3 символов'
          : 'Не удалось завести — попробуйте еще раз');
      });
    });
  }
  /* ── МАРКЕТИНГ: CRM владеет воронкой, агент — только шагами logics/<code>.md ── */
  /* копируемый /go-адрес: на проде — ЛАТИНСКИЙ go.eastside.study. Кириллический домен
     Instagram не принимает: в шапке профиля вместо ссылки висит `go.%D0%B8%D1%81...`, и она
     не кликается (скрин маркетолога 30.07.2026); плюс зону .рф резолвят не все зарубежные
     DNS, а часть аудитории — Китай. Уже разошедшиеся по постам .рф-ссылки продолжают
     работать, меняется только то, что копируется впредь.
     Локаль/staging (EASTSIDE_API_BASE на другой хост) — рабочий /go ЭТОГО окружения, иначе
     скопированная ссылка вела бы на прод, где превью-данных нет. */
  var MK_GO = (function () {
    var base = window.EASTSIDE_API_BASE || '';
    if (!base || /истсайд\.рф|xn--80aikf2bag|eastside\.study/.test(base)) return 'https://go.eastside.study/';
    return base + '/go/';
  })();
  var MK_CODE_RE = /^[a-z0-9_-]{1,64}$/;
  var MK_CHANNELS = [
    { id: 'vk', label: 'ВКонтакте', src: 'vk' },
    { id: 'inst', label: 'Instagram', src: 'instagram' },
    { id: 'yt', label: 'YouTube', src: 'youtube' },
    { id: 'tt', label: 'TikTok', src: 'tiktok' },
    { id: 'tgch', label: 'Телеграм-канал', src: 'telegram' },
    { id: 'dzen', label: 'Дзен', src: 'dzen' },
    /* ссылка внутри самого бота (кнопка под приветствием и т.п.): свой источник, иначе
       переходы из бота слипаются с «Другое место» и канал нечем измерить */
    { id: 'bot', label: 'Бот EastSide', src: 'telegram_bot' },
    { id: 'site', label: 'Другое место', src: 'other' },
  ];
  var MK_MEDIUMS = [
    { id: 'post', label: 'Пост', utm: 'post' },
    { id: 'reels', label: 'Рилс / Shorts', utm: 'reels' },
    { id: 'stories', label: 'Сторис', utm: 'stories' },
    { id: 'ads', label: 'Реклама / таргет', utm: 'ads' },
    { id: 'bio', label: 'Описание профиля', utm: 'bio' },
    { id: 'welcome', label: 'Приветствие в боте', utm: 'welcome' },
  ];
  /* WhatsApp появится в выборе, когда бот заработает в WA; отображение wa-ссылок
     из БД оставлено в MK_KIND_INFO, чтобы старые данные не показывались как WEB */
  var MK_KINDS = [
    { id: 'tg', label: 'В бот · Telegram', short: 'TG' },
    { id: 'vk', label: 'В бот · VK', short: 'VK' },
    { id: 'page', label: 'На страницу', short: 'WEB' },
  ];
  var MK_KIND_INFO = {
    tg: MK_KINDS[0], vk: MK_KINDS[1], page: MK_KINDS[2],
    wa: { id: 'wa', label: 'В бот · WhatsApp', short: 'WA' },
  };
  var MK_SOURCE_NAMES = {
    direct: 'Кодовое слово', vk: 'ВКонтакте', instagram: 'Instagram', youtube: 'YouTube',
    tiktok: 'TikTok', telegram: 'Telegram', telegram_bot: 'Бот EastSide',
    whatsapp: 'WhatsApp', dzen: 'Дзен', other: 'Другое',
  };

  function mkUrl(code) {
    return MK_GO + code;
  }
  function mkKind(kind) {
    return MK_KIND_INFO[kind] || MK_KIND_INFO.page;
  }
  function mkSourceName(source) {
    return MK_SOURCE_NAMES[source] || source || 'Другое';
  }
  function mkChips(code, kinds) {
    return '<span class="mk-chips" data-code="' + esc(code) + '">' +
      kinds.map(function (k) {
        return '<button class="mk-chip" data-k="' + k + '" title="Скопировать ссылку ' + k + '">' + k + ic('copy', 10) + '</button>';
      }).join('') + '</span>';
  }
  function mkBindChips(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('.mk-chip'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        copyText(mkUrl(b.parentNode.getAttribute('data-code')), b);
        showToast('Ссылка скопирована');
      });
    });
  }
  /* слово встречается и как код, и как ключевое слово (короткие коды типа «10») —
     не дублируем его же чипом рядом с самим кодом */
  function mkKwChips(f) {
    return (f.keywords || []).filter(function (w) { return w.toLowerCase() !== f.code.toLowerCase(); })
      .map(function (w) { return '<span class="mk-kw">' + esc(w) + '</span>'; }).join('');
  }
  /* автокод: воронка + тип + площадка + формат (+номер, если занят) —
     tg/vk/page входит в код, чтобы разные назначения не сталкивались */
  function mkAutoCode(d) {
    var w = state._mkL;
    if (!w || w.touched) return;
    var used = {};
    (d.funnels || []).forEach(function (f) { used[f.code] = 1; });
    (d.links || []).forEach(function (l) { used[l.code] = 1; });
    var base = [w.funnel, w.kind, w.chan, w.med && w.med !== 'post' ? w.med : '']
      .filter(Boolean).join('_').slice(0, 58);
    var code = base, n = 2;
    while (used[code]) { code = (base + n).slice(0, 64); n++; }
    w.code = code;
  }
  function fetchMk(cb) {
    api('/admin/api/marketing/overview').then(function (r) {
      state._mk = r;
      if (cb) cb(); else if (state.page === 'marketing') { renderView(); mkModal(r); }
    }).catch(function (e) {
      if (e.message !== '403') { state._mk = 'none'; if (state.page === 'marketing') renderView(); }
    });
  }
  function mkRequest(path, method, body) {
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    return fetch(API + path + sep + 'k=' + encodeURIComponent(getKey()), {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        if (r.status === 403) {
          localStorage.removeItem(KEY_LS); renderLogin('Сессия истекла — войди заново');
          throw new Error('403');
        }
        if (!r.ok) throw new Error(data.detail || 'Не сохранилось — проверь данные');
        return data;
      });
    });
  }
  function mkFail(e) {
    if (e && e.message !== '403') showToast(e.message || 'Не сохранилось — проверь данные');
  }

  /* ── попапы (в body, НЕ в #view: transform анимации страницы ломает fixed) ──
     Воронка/форма/ссылка/удаление живут в одном дизайн-паттерне. */
  /* ESC закрывает любой открытый попап маркетинга (навешивается один раз) */
  if (!window._mkEscBound) {
    window._mkEscBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !document.getElementById('mk-ovl')) return;
      state._mkDel = null; state._mkL = null; state._mkDone = null; state._mkStats = null;
      state._mkClicks = null; state._mkFForm = null; state._mkSource = null;
      mkModal(state._mk && state._mk !== 'none' ? state._mk : null);
    });
  }

  function mkModal(d) {
    var host = document.getElementById('mk-ovl-host');
    if (!state._mkDel && !state._mkL && !state._mkDone && !state._mkStats &&
        !state._mkClicks && !state._mkFForm) { if (host) host.remove(); return; }
    if (!host) { host = document.createElement('div'); host.id = 'mk-ovl-host'; document.body.appendChild(host); }
    var inner = '';
    var wide = false;

    if (state._mkClicks) {
      var cl = state._mkClicks; // {code, title, data:null|{total,days}}
      if (!cl.data) {
        inner = '<div class="mk-modal-t">Клики · <span class="mk-code num">' + esc(cl.code) + '</span></div>' +
          '<div class="loadwrap" style="padding:24px 0"><div class="loaddot"></div><div class="loaddot"></div><div class="loaddot"></div></div>';
      } else {
        var maxN = Math.max(1, cl.data.days.reduce(function (m, x) { return Math.max(m, x.n); }, 0));
        var byDay = {};
        cl.data.days.forEach(function (x) { byDay[x.day] = x.n; });
        var today = new Date();
        var bars2 = [];
        for (var i = 13; i >= 0; i--) {
          var dt = new Date(today); dt.setDate(dt.getDate() - i);
          var key = dt.toISOString().slice(0, 10);
          var v = byDay[key] || 0;
          bars2.push('<div class="mk-cd-bar" title="' + key + ': ' + v + '"><div class="mk-cd-fill" style="height:' + Math.round(v / maxN * 100) + '%"></div></div>');
        }
        inner = '<div class="mk-modal-t">Клики · <span class="mk-code num">' + esc(cl.code) + '</span></div>' +
          '<div class="mk-modal-s">' + esc(cl.title || '') + '</div>' +
          '<div class="mk-kpis"><div class="mk-kpi"><div class="mk-kpi-n num">' + cl.data.total + '</div><div class="mk-kpi-l">кликов всего</div></div></div>' +
          '<div class="mk-q" style="margin:10px 0 4px">Последние 14 дней</div>' +
          '<div class="mk-cd-chart">' + bars2.join('') + '</div>';
      }
    } else if (state._mkStats && !state._mkDel && !state._mkDone && !state._mkL && !state._mkFForm) {
      /* Воронка: аналитика с фильтром площадки + её ссылки. Шаги только read-only. */
      wide = true;
      var sf = ((d && d.funnels) || []).filter(function (x) { return x.code === state._mkStats; })[0];
      if (sf) {
        var seg = (d && d.segments) || { reach: [], answers: [], handoffs: [] };
        var selected = state._mkSource || 'all';
        var sourceSet = {};
        (seg.reach || []).forEach(function (r) { if (r.funnel_code === sf.code) sourceSet[r.source] = 1; });
        /* источники видны сразу по ссылкам воронки, не только после первого трафика */
        ((d && d.links) || []).forEach(function (l) {
          if (l.funnel_code === sf.code && l.active && l.utm && l.utm.source) sourceSet[l.utm.source] = 1;
        });
        var sources = Object.keys(sourceSet).sort();
        var sourceChips = '<button class="mk-chip2' + (selected === 'all' ? ' on' : '') + '" data-mksource="all">Все источники</button>' +
          sources.map(function (src) {
            return '<button class="mk-chip2' + (selected === src ? ' on' : '') + '" data-mksource="' + esc(src) + '">' + esc(mkSourceName(src)) + '</button>';
          }).join('');
        var reachRows = selected === 'all' ? ((d && d.reach) || []) : (seg.reach || []).filter(function (r) { return r.source === selected; });
        var rm = {};
        reachRows.forEach(function (r) { if (r.funnel_code === sf.code) rm[r.step] = (rm[r.step] || 0) + r.users; });
        var entered = rm[0] || 0;
        var ho = (seg.handoffs || []).filter(function (r) {
          return r.funnel_code === sf.code && (selected === 'all' || r.source === selected);
        }).reduce(function (n, r) { return n + r.users; }, 0);
        var bars = (sf.steps || []).map(function (s, i) {
          var t = s.type === 'ask' ? 'Вопрос' : s.type === 'wait' ? 'Пауза ' + (s.hours || '') + ' ч'
            : s.type === 'file' ? 'Файл' : 'Сообщение';
          var preview = (s.text || s.caption || '').split('\n')[0].slice(0, 52);
          var got = rm[i + 1] || 0;
          var pct = entered ? Math.round(got / entered * 100) : 0;
          return '<div class="mk-sl"><span class="mk-sl-t">' + (i + 1) + ' · ' + t + '</span>' +
            '<span class="mk-sl-p">' + esc(preview) + '</span>' +
            '<div class="mk-sl-bar"><div class="mk-sl-fill" style="width:' + pct + '%"></div></div>' +
            '<span class="mk-sl-n num">' + got + ' · ' + pct + '%</span></div>';
        }).join('');
        var answerRows = selected === 'all' ? (((d && d.answers) || [])) : (seg.answers || []).filter(function (a) { return a.source === selected; });
        var ans = answerRows.filter(function (a) { return a.funnel_code === sf.code; }).map(function (a) {
          return '<div class="mk-ans-r"><span>' + esc(a.key) + ' · ' + esc(a.value) + '</span><span class="num">' + a.count + '</span></div>';
        }).join('');
        var st = (d && d.stats) || { clicks: {}, users: {}, handoffs: {} };
        function sn(map, code) { return (map && map[code]) || 0; }
        var flinks = ((d && d.links) || []).filter(function (l) {
          var src = l.utm && l.utm.source;
          return l.funnel_code === sf.code && l.active && (selected === 'all' || src === selected);
        });
        var linkRows = flinks.map(function (l) {
          var kind = mkKind(l.kind);
          return '<div class="mk-row mk-click" data-clicks="' + esc(l.code) + '">' +
            '<div class="mk-i"><div class="mk-n">' + esc(l.title || l.code) + '</div>' +
            '<div class="mk-l"><span class="mk-kind">' + kind.short + '</span> <span class="mk-code num">' + esc(l.code) + '</span> · ' +
            esc(mkSourceName(l.utm && l.utm.source)) + (l.note ? '<span class="mk-note">' + esc(l.note) + '</span>' : '') + '</div></div>' +
            '<div class="mk-st num" title="кликов по ссылке">' + sn(st.clicks, l.code) + '</div>' +
            mkChips(l.code, [kind.short]) + '<button class="mk-btn danger" data-dellink="' + esc(l.code) + '">' + ic('x', 12) + '</button></div>';
        }).join('');
        /* шаги показываем, если они есть в БД — даже пока файл агента не подцепился
           (переходное состояние до деплоя бота); нет шагов — честно «ждёт агента» */
        var stepsBlock = bars || (sf.logic_managed
          ? '<div class="mk-logic-empty">Файл шагов подключён, но сценарий пока пуст.</div>'
          : '<div class="mk-logic-empty">Шагов пока нет — воронка ждёт агента. Файл: <span class="mk-code num">logics/' + esc(sf.code) + '.md</span></div>');
        inner = '<div class="mk-modal-t">' + ic('funnel', 15) + ' ' + esc(sf.title || sf.code) + '</div>' +
          '<div class="mk-modal-s"><span class="mk-lbl">код</span> <span class="mk-code num">' + esc(sf.code) + '</span>' +
          (mkKwChips(sf) ? ' <span class="mk-lbl">слова</span> ' + mkKwChips(sf) : '') + '</div>' +
          '<div class="mk-sourcebar"><span class="mk-q" style="margin:0">Источник</span><div class="mk-chan">' + sourceChips + '</div></div>' +
          '<div class="mk-kpis">' +
            '<div class="mk-kpi"><div class="mk-kpi-n num">' + entered + '</div><div class="mk-kpi-l">вошло людей</div></div>' +
            '<div class="mk-kpi"><div class="mk-kpi-n num">' + ho + '</div><div class="mk-kpi-l">до менеджера</div></div>' +
            '<div class="mk-kpi"><div class="mk-kpi-n num">' + (entered ? Math.round(ho / entered * 100) : 0) + '%</div><div class="mk-kpi-l">конверсия</div></div>' +
          '</div>' +
          '<div class="mk-q" style="margin:6px 0 0">Дошли по шагам <span class="mk-q-s">с момента включения аналитики</span></div>' +
          stepsBlock +
          (ans ? '<div class="mk-q" style="margin:10px 0 0">Ответы на вопросы</div>' + ans : '') +
          '<div class="mk-q" style="margin:10px 0 0;display:flex;align-items:center;gap:8px">Ссылки для размещения' +
            '<span style="flex:1"></span><button class="mk-btn primary sm" id="mk-add-link">' + ic('plus', 12) + 'Ссылка</button></div>' +
          (linkRows || '<div class="empty" style="padding:10px 0">Ссылок пока нет — жми «+ Ссылка»: каждому месту размещения своя.</div>') +
          '<div class="mk-fr" style="margin-top:8px"><span class="mk-hint" style="margin:0">Тексты и шаги меняет агент песочницы (репо бота, папка logics).</span>' +
          '<span style="flex:1"></span><button class="mk-btn" id="mk-edit-funnel">Редактировать</button><button class="mk-btn danger" id="mk-del-funnel">Удалить</button></div>';
      }
    } else if (state._mkDel) {
      var del = state._mkDel;
      var isFunnel = del.type === 'funnel';
      var dl = isFunnel
        ? (((d && d.funnels) || []).filter(function (x) { return x.code === del.code; })[0] || { code: del.code })
        : (((d && d.links) || []).filter(function (x) { return x.code === del.code; })[0] || { code: del.code });
      inner = '<div class="mk-modal-t">Удалить ' + (isFunnel ? 'воронку' : 'ссылку') + '?</div>' +
        '<div class="mk-modal-s">«' + esc(dl.title || dl.code) + '» — код <span class="mk-code num">' + esc(dl.code) + '</span> ' +
        (isFunnel ? 'и все его ссылки исчезнут из CRM. История шагов и кликов останется в аналитике; файл шагов агент удаляет отдельно.'
          : 'перестанет работать везде, где уже размещён. История прошлых кликов сохранится.') + '</div>' +
        '<div class="mk-fr" style="justify-content:flex-end;margin-top:4px">' +
        '<button class="mk-btn" id="mk-x-no">Отмена</button>' +
        '<button class="mk-btn del" id="mk-x-yes">Удалить</button></div>';
    } else if (state._mkDone) {
      var dn = state._mkDone;
      inner = '<div class="mk-modal-t">' + ic('check', 14) + ' Ссылка готова</div>' +
        '<div class="mk-modal-s">Ведёт: ' + esc(mkKind(dn.kind).label) + '</div>' +
        '<div class="mk-done-r"><div class="mk-done-u num">' + esc(mkUrl(dn.code)) + '</div>' +
        '<button class="mk-btn sm" data-cp="go">' + ic('copy', 11) + 'Скопировать</button></div>' +
        '<div class="mk-fr"><span class="mk-hint" style="margin:0">Ссылка сначала фиксирует клик, затем ведёт по назначению.</span>' +
        '<span style="flex:1"></span><button class="mk-btn primary" id="mk-x-ok">Понятно</button></div>';
    } else if (state._mkFForm) {
      var fw = state._mkFForm;
      inner = '<div class="mk-modal-t">' + (fw.edit ? 'Настройки воронки' : 'Новая воронка') + '</div>' +
        '<div class="mk-modal-s">Название, слова и страница хранятся в БД. Шаги появятся только после файла агента.</div>' +
        '<div class="mk-field-grid"><div class="mk-qblock"><div class="mk-q">Название</div><input id="mk-ft" class="mk-inp" value="' + esc(fw.title || '') + '" placeholder="Летние программы"></div>' +
        '<div class="mk-qblock"><div class="mk-q">Код</div><input id="mk-fc" class="mk-inp num" value="' + esc(fw.code || '') + '" ' + (fw.edit ? 'disabled' : '') + ' placeholder="leto"></div></div>' +
        '<div class="mk-qblock"><div class="mk-q">Кодовые слова <span class="mk-q-s">через запятую</span></div><input id="mk-fk" class="mk-inp" value="' + esc(fw.keywords || '') + '" placeholder="лето, leto"></div>' +
        '<div class="mk-qblock"><div class="mk-q">Основная страница <span class="mk-q-s">необязательно</span></div><input id="mk-fu" class="mk-inp" value="' + esc(fw.target || '') + '" placeholder="истсайд.рф/shanghai_summer.html"></div>' +
        '<div class="mk-fr" style="justify-content:flex-end"><button class="mk-btn" id="mk-x-no">Отмена</button><button class="mk-btn primary" id="mk-f-save">Сохранить</button></div>';
    } else if (state._mkL) {
      var w = state._mkL;
      function chips2(items, sel, attr) {
        return '<div class="mk-chan">' + items.map(function (it) {
          return '<button class="mk-chip2' + (sel === it.id ? ' on' : '') + '" data-' + attr + '="' + esc(it.id) + '">' + esc(it.label) + '</button>';
        }).join('') + '</div>';
      }
      var targetBlock = w.kind === 'page'
        ? '<div class="mk-qblock"><div class="mk-q">Куда ведёт страница?</div><input id="mk-lu" class="mk-inp" value="' + esc(w.target || '') + '" placeholder="истсайд.рф/shanghai_summer.html"></div>'
        : '';
      inner = '<div class="mk-modal-t">Новая ссылка · <span class="mk-code num">' + esc(w.funnel) + '</span></div>' +
        '<div class="mk-qblock"><div class="mk-q">Куда ведёт?</div>' + chips2(MK_KINDS, w.kind, 'wk') + '</div>' + targetBlock +
        '<div class="mk-qblock"><div class="mk-q">Где будет размещена?</div>' + chips2(MK_CHANNELS, w.chan, 'wc') + '</div>' +
        '<div class="mk-qblock"><div class="mk-q">В каком виде? <span class="mk-q-s">необязательно</span></div>' + chips2(MK_MEDIUMS, w.med, 'wm') + '</div>' +
        '<div class="mk-qblock"><div class="mk-q">Комментарий для себя <span class="mk-q-s">необязательно</span></div>' +
        '<input id="mk-ln" class="mk-inp" value="' + esc(w.note || '') + '" placeholder="«рилс от 15 июля про кампусы»"></div>' +
        '<div class="mk-fr mk-code-row"><span class="mk-q" style="margin:0">Код ссылки</span>' +
        '<input id="mk-lc" class="mk-inp sm num" value="' + esc(w.code) + '">' +
        '<span style="flex:1"></span>' +
        '<button class="mk-btn" id="mk-x-no">Отмена</button>' +
        '<button class="mk-btn primary" id="mk-x-save">Создать ссылку</button></div>';
    }

    /* попап уже открыт → содержимое просто заменяется, анимация появления не
       переигрывается (иначе блинк при каждом клике по фильтру/чипу) */
    var wasOpen = !!document.getElementById('mk-ovl');
    host.innerHTML = '<div class="mk-ovl' + (wasOpen ? ' no-anim' : '') + '" id="mk-ovl">' +
      '<div class="mk-modal' + (wide ? ' wide' : '') + '">' +
      '<button class="mk-xbtn" id="mk-x-top" title="Закрыть">' + ic('x', 14) + '</button>' +
      inner + '</div></div>';
    mkBindChips(host); // чипы копирования в строках ссылок

    function closeTop() {
      if (state._mkClicks) state._mkClicks = null;
      else if (state._mkDel) state._mkDel = null;
      else if (state._mkDone) state._mkDone = null;
      else if (state._mkL) state._mkL = null;
      else if (state._mkFForm) state._mkFForm = null;
      else { state._mkStats = null; state._mkSource = null; }
      mkModal(d);
    }
    var ovl = el('mk-ovl');
    ovl.addEventListener('click', function (e) { if (e.target === ovl) closeTop(); });
    var xt = el('mk-x-top'); if (xt) xt.addEventListener('click', closeTop);
    var no = el('mk-x-no'); if (no) no.addEventListener('click', closeTop);
    var ok = el('mk-x-ok'); if (ok) ok.addEventListener('click', closeTop);
    var yes = el('mk-x-yes');
    if (yes) yes.addEventListener('click', function () {
      var del = state._mkDel;
      var path = del.type === 'funnel' ? '/admin/api/marketing/funnel/' : '/admin/api/marketing/link/';
      mkRequest(path + encodeURIComponent(del.code), 'DELETE').then(function () {
        state._mkDel = null;
        if (del.type === 'funnel') { state._mkStats = null; state._mkSource = null; }
        showToast(del.type === 'funnel' ? 'Воронка удалена' : 'Ссылка удалена');
        fetchMk(function () { if (state.page === 'marketing') renderView(); mkModal(state._mk); });
      }).catch(mkFail);
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-cp]'), function (b) {
      b.addEventListener('click', function () {
        copyText(mkUrl(state._mkDone.code), b);
        showToast('Ссылка скопирована');
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-mksource]'), function (b) {
      b.addEventListener('click', function () { state._mkSource = b.getAttribute('data-mksource'); mkModal(d); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-clicks]'), function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('.mk-chip') || e.target.closest('[data-dellink]')) return;
        var code = row.getAttribute('data-clicks');
        var l = (d.links || []).filter(function (x) { return x.code === code; })[0];
        state._mkClicks = { code: code, title: l && l.title, data: null };
        mkModal(d);
        api('/admin/api/marketing/link/' + code + '/clicks').then(function (r) {
          if (state._mkClicks && state._mkClicks.code === code) { state._mkClicks.data = r; mkModal(d); }
        }).catch(function () {});
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-dellink]'), function (b) {
      b.addEventListener('click', function () {
        state._mkDel = { type: 'link', code: b.getAttribute('data-dellink') }; mkModal(d);
      });
    });
    var addLink = el('mk-add-link');
    if (addLink) addLink.addEventListener('click', function () {
      var f = (d.funnels || []).filter(function (x) { return x.code === state._mkStats; })[0];
      state._mkL = { funnel: f.code, kind: 'tg', chan: 'inst', med: 'post', code: '', touched: false,
        target: f.target_url || '', note: '' };
      mkAutoCode(d); mkModal(d);
    });
    var editF = el('mk-edit-funnel');
    if (editF) editF.addEventListener('click', function () {
      var f = (d.funnels || []).filter(function (x) { return x.code === state._mkStats; })[0];
      state._mkFForm = { edit: true, code: f.code, title: f.title || '',
        keywords: (f.keywords || []).join(', '), target: f.target_url || '' };
      mkModal(d);
    });
    var delF = el('mk-del-funnel');
    if (delF) delF.addEventListener('click', function () {
      state._mkDel = { type: 'funnel', code: state._mkStats }; mkModal(d);
    });
    var saveF = el('mk-f-save');
    if (saveF) saveF.addEventListener('click', function () {
      var fw = state._mkFForm;
      var code = (el('mk-fc').value || '').trim().toLowerCase();
      var title = (el('mk-ft').value || '').trim();
      var keywords = (el('mk-fk').value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var target = (el('mk-fu').value || '').trim();
      if (!MK_CODE_RE.test(code)) { showToast('Код — латиницей, без пробелов (leto_2026)'); return; }
      if (!title) { showToast('Укажи название воронки'); return; }
      /* создание и правка — разные действия: POST падает 409 на занятом коде,
         PUT явно меняет существующую (код зафиксирован) */
      mkRequest(fw.edit ? '/admin/api/marketing/funnel/' + encodeURIComponent(fw.code)
        : '/admin/api/marketing/funnel', fw.edit ? 'PUT' : 'POST', {
        code: code, title: title, keywords: keywords, target_url: target || null, active: true,
      }).then(function () {
        state._mkFForm = null; state._mkStats = code; state._mkSource = 'all';
        showToast(fw.edit ? 'Воронка обновлена' : 'Воронка создана',
          fw.edit ? '' : 'Шаги настроит агент: logics/' + code + '.md');
        fetchMk(function () { if (state.page === 'marketing') renderView(); mkModal(state._mk); });
      }).catch(mkFail);
    });
    /* мастер: выборы, поля, сохранение */
    function keep() {
      var w = state._mkL; if (!w) return;
      var t = el('mk-lu'); if (t) w.target = t.value;
      var nn = el('mk-ln'); if (nn) w.note = nn.value;
      var c = el('mk-lc'); if (c && c.value !== w.code) { w.code = c.value; w.touched = true; }
    }
    ['wk', 'wc', 'wm'].forEach(function (attr) {
      Array.prototype.forEach.call(host.querySelectorAll('[data-' + attr + ']'), function (b) {
        b.addEventListener('click', function () {
          keep();
          var key = attr === 'wk' ? 'kind' : (attr === 'wc' ? 'chan' : 'med');
          state._mkL[key] = b.getAttribute('data-' + attr);
          state._mkL.touched = false; mkAutoCode(d); // тип входит в код — пересчёт на любом выборе
          if (attr === 'wk' && state._mkL.kind === 'page') {
            var f = (d.funnels || []).filter(function (x) { return x.code === state._mkL.funnel; })[0];
            state._mkL.target = (f && f.target_url) || '';
          }
          mkModal(d);
        });
      });
    });
    var save = el('mk-x-save');
    if (save) save.addEventListener('click', function () {
      keep();
      var w = state._mkL;
      var code = (w.code || '').trim().toLowerCase();
      if (!MK_CODE_RE.test(code)) { showToast('Код — латиницей, без пробелов (leto_tg_inst)'); return; }
      if (w.kind === 'page' && !(w.target || '').trim()) { showToast('Укажи адрес страницы'); return; }
      var chan = MK_CHANNELS.filter(function (c) { return c.id === w.chan; })[0] || MK_CHANNELS[0];
      var med = MK_MEDIUMS.filter(function (m) { return m.id === w.med; })[0] || MK_MEDIUMS[0];
      var kind = mkKind(w.kind);
      mkRequest('/admin/api/marketing/link', 'POST', {
        code: code,
        title: kind.short + ' · ' + chan.label + (med.id !== 'post' ? ' · ' + med.label : ''),
        funnel_code: w.funnel, kind: w.kind,
        target_url: w.kind === 'page' ? w.target.trim() : null,
        utm: { source: chan.src, medium: med.utm },
        note: (w.note || '').trim() || null,
      }).then(function () {
        state._mkL = null; state._mkDone = { code: code, kind: w.kind };
        mkModal(d); // сразу показать «готово», свежие цифры дотянутся следом
        fetchMk(function () { if (state.page === 'marketing') renderView(); mkModal(state._mk); });
      }).catch(mkFail);
    });
  }

  function renderMarketing(view) {
    if (!state._mk) {
      view.innerHTML = dashSkeleton();
      fetchMk();
      return;
    }
    if (state._mk === 'none') {
      view.innerHTML = '<div class="card"><div class="empty">Не удалось загрузить маркетинг — проверь сеть или доступ.</div></div>';
      return;
    }
    var d = state._mk;
    /* reach: code → {step: users} — «дошло до шага» из лога бота */
    var reach = {};
    (d.reach || []).forEach(function (r) { (reach[r.funnel_code] = reach[r.funnel_code] || {})[r.step] = r.users; });
    var segHandoffs = ((d.segments || {}).handoffs || []);
    var frows = (d.funnels || []).filter(function (f) { return f.active; }).map(function (f) {
      var entered = (reach[f.code] || {})[0] || 0;
      var ho = segHandoffs.filter(function (r) { return r.funnel_code === f.code; })
        .reduce(function (n, r) { return n + r.users; }, 0);
      var linkN = (d.links || []).filter(function (l) { return l.active && l.funnel_code === f.code; }).length;
      return '<div class="mk-row mk-click" data-stats="' + esc(f.code) + '" title="Открыть воронку">' +
        '<div class="mk-i"><div class="mk-n">' + esc(f.title || f.code) + '</div>' +
        '<div class="mk-l"><span class="mk-code num">' + esc(f.code) + '</span>' + mkKwChips(f) +
        ' · ' + (f.steps || []).length + ' ' + plural((f.steps || []).length, 'шаг', 'шага', 'шагов') +
        ' · ' + linkN + ' ' + plural(linkN, 'ссылка', 'ссылки', 'ссылок') + '</div></div>' +
        '<span class="mk-logic-badge ' + (f.logic_managed ? 'ok' : 'wait') + '">' +
          (f.logic_managed ? 'шаги подключены' : 'ждёт агента') + '</span>' +
        '<div class="mk-st num" title="вошло · дошли до менеджера">' + entered + ' · ' + ho + '</div></div>';
    }).join('');

    view.innerHTML =
      '<div class="card" style="padding:22px 24px"><div class="sec-head"><span class="ic">' + ic('funnel', 14) + '</span>' +
        '<div><div class="t">Воронки</div><div class="s">создавай воронку и ссылки здесь; шаги диалога меняет только агент песочницы</div></div>' +
        '<span style="flex:1"></span><button class="mk-btn primary" id="mk-newf">' + ic('plus', 12) + 'Воронка</button></div>' +
        '<div class="mk-list">' + (frows || '<div class="empty">Воронок пока нет — жми «+ Воронка».</div>') + '</div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('[data-stats]'), function (row) {
      row.addEventListener('click', function () {
        state._mkStats = row.getAttribute('data-stats');
        state._mkSource = 'all';
        mkModal(d);
      });
    });
    var nf = el('mk-newf');
    if (nf) nf.addEventListener('click', function () {
      state._mkDel = null; state._mkDone = null; state._mkStats = null; state._mkClicks = null;
      state._mkFForm = { edit: false, code: '', title: '', keywords: '', target: '' };
      mkModal(d);
    });
  }

  /* мягкое появление контента ТОЛЬКО при смене страницы (не на фильтрах/сегментах
     внутри той же страницы — иначе мелькает). CSS гасит при reduced-motion. */
  /* ── ШАБЛОНЫ пути поступления (мастер-планы → доска «Поступление») ── */
  function fetchTemplates(cb) {
    if (state._templates) { if (cb) cb(state._templates); return; }
    api('/admin/api/plan-templates').then(function (r) {
      state._templates = (r && r.templates) || [];
    }).catch(function () { state._templates = 'none'; }).finally(function () { if (cb) cb(state._templates); });
  }
  /* ── Продукты — живой каталог платформы (вкл/выкл, цена, описание) ── */
  function renderProducts(view) {
    if (!state._catalogAll) {
      view.innerHTML = dashSkeleton();
      api('/api/products?active_only=false').then(function (r) {
        state._catalogAll = Array.isArray(r) ? r : [];
        if (state.page === 'products') renderView();
      }).catch(function (e) {
        if (e.message !== '403') { state._catalogAll = 'none'; if (state.page === 'products') renderView(); }
      });
      return;
    }
    if (state._catalogAll === 'none') { view.innerHTML = '<div class="card"><div class="empty">Не удалось загрузить каталог.</div></div>'; return; }
    var items = state._catalogAll;
    var activeN = items.filter(function (p) { return p.is_active; }).length;
    var byCat = {};
    items.forEach(function (p) { (byCat[p.category] = byCat[p.category] || []).push(p); });
    var cats = PRODUCT_CAT_ORDER.filter(function (c) { return byCat[c]; })
      .concat(Object.keys(byCat).filter(function (c) { return PRODUCT_CAT_ORDER.indexOf(c) === -1; }));

    var html = '<div class="pd-wrap">' +
      '<div class="pd-head">' +
        '<div><h2 class="pd-h1">Каталог продуктов</h2>' +
        '<div class="pd-sub">Что продаём на платформе. Выключенный продукт исчезает из витрин и AI-подбора — клиент его не увидит.</div></div>' +
        '<span class="pd-cnt"><b class="num">' + activeN + '</b> из <span class="num">' + items.length + '</span> в продаже</span></div>';
    cats.forEach(function (cat) {
      var grp = byCat[cat], grpOn = grp.filter(function (p) { return p.is_active; }).length;
      html += '<div class="pd-grp">' +
        '<div class="pd-grp-h"><span class="pd-grp-t">' + esc(PRODUCT_CAT_RU[cat] || cat) + '</span>' +
          '<span class="pd-grp-n num">' + grpOn + '/' + grp.length + '</span></div>';
      grp.forEach(function (p) {
        var open = state._pdEdit === p.id;
        html += '<div class="pd-row' + (p.is_active ? '' : ' off') + (open ? ' open' : '') + '" data-pd="' + esc(p.id) + '">' +
          '<div class="pd-info" data-pdopen="' + esc(p.id) + '" title="Нажмите, чтобы отредактировать">' +
            '<div class="pd-nm">' + esc(p.name) + '<span class="pd-edit-hint">' + ic('go', 12) + 'изменить</span></div>' +
            '<div class="pd-desc">' + esc(p.description || '') + '</div>' +
          '</div>' +
          '<span class="pd-price num">' + esc(fmtPrice(p)) + '</span>' +
          '<button type="button" class="pd-sw' + (p.is_active ? ' on' : '') + '" data-pdtgl="' + esc(p.id) + '" ' +
            'title="' + (p.is_active ? 'Снять с продажи' : 'Вернуть в продажу') + '">' +
            '<span class="pd-sw-l">' + (p.is_active ? 'В продаже' : 'Выключен') + '</span>' +
            '<span class="pd-sw-t"><span class="pd-sw-k"></span></span>' +
          '</button>' +
        '</div>';
        if (open) {
          html += '<div class="pd-edit" data-pdform="' + esc(p.id) + '">' +
            '<label>Название<input class="pd-in" data-f="name" value="' + esc(p.name) + '"></label>' +
            '<label>Описание<textarea class="pd-in" data-f="description" rows="3">' + esc(p.description || '') + '</textarea></label>' +
            '<div class="pd-cols">' +
              '<label>Цена, ₽ (пусто — по запросу)<input class="pd-in num" data-f="price_amount" inputmode="numeric" value="' + (p.price_amount != null ? Math.round(p.price_amount) : '') + '"></label>' +
              '<label>Пояснение к цене<input class="pd-in" data-f="price_note" value="' + esc(p.price_note || '') + '" placeholder="в месяц / разово / по запросу"></label>' +
            '</div>' +
            '<div class="pd-foot"><button class="bp sm" data-pdsave="' + esc(p.id) + '">Сохранить</button>' +
            '<button class="bp ghost sm" data-pdclose="1">Закрыть</button></div>' +
          '</div>';
        }
      });
      html += '</div>';
    });
    html += '</div>';
    view.innerHTML = html;

    function put(p, cb) {
      apiSend('/api/products/' + encodeURIComponent(p.id), 'PUT', p, function (r) {
        state._catalog = null;            // витрина в карточке лида берёт active-only — сброс
        if (cb) cb(r);
      });
    }
    Array.prototype.forEach.call(view.querySelectorAll('[data-pdtgl]'), function (b) {
      b.addEventListener('click', function () {
        var p = items.find(function (x) { return x.id === b.getAttribute('data-pdtgl'); });
        if (!p) return;
        p.is_active = !p.is_active;
        put(p, function () { showToast(p.is_active ? 'Продукт включён' : 'Продукт выключен', p.name); });
        renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pdopen]'), function (n) {
      n.addEventListener('click', function () {
        var pid = n.getAttribute('data-pdopen');
        state._pdEdit = state._pdEdit === pid ? null : pid;
        renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pdsave]'), function (b) {
      b.addEventListener('click', function () {
        var pid = b.getAttribute('data-pdsave');
        var p = items.find(function (x) { return x.id === pid; });
        var form = view.querySelector('[data-pdform="' + pid + '"]');
        if (!p || !form) return;
        Array.prototype.forEach.call(form.querySelectorAll('.pd-in'), function (inp) {
          var f = inp.getAttribute('data-f'), v = inp.value.trim();
          if (f === 'price_amount') p.price_amount = v === '' ? null : (parseInt(v.replace(/\D/g, ''), 10) || null);
          else p[f] = v;
        });
        put(p, function () { showToast('Сохранено', p.name); });
        state._pdEdit = null;
        renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-pdclose]'), function (b) {
      b.addEventListener('click', function () { state._pdEdit = null; renderView(); });
    });
  }

  function renderTemplates(view) {
    if (!can('students')) { view.innerHTML = '<div class="card"><div class="empty">Нет доступа к шаблонам.</div></div>'; return; }
    if (state._tplEdit) return renderTemplateEditor(view);
    if (!state._templates) {
      view.innerHTML = dashSkeleton();
      fetchTemplates(function () { if (state.page === 'templates') renderView(); });
      return;
    }
    if (state._templates === 'none') { view.innerHTML = '<div class="card"><div class="empty">Не удалось загрузить шаблоны.</div></div>'; return; }
    var cards = state._templates.map(function (t) {
      return '<div class="card tpl-card">' +
        '<div class="sec-head"><span class="ic">' + ic('box', 14) + '</span>' +
          '<div><div class="t">' + esc(t.name) + '</div><div class="s">' + esc(t.description || t.segment || '') + '</div></div>' +
          '<span class="cnt num">' + (t.stages_count || 0) + ' этапов · ' + (t.tasks_count || 0) + ' задач</span></div>' +
        '<div class="tpl-actions">' +
          '<button class="bp ghost sm" data-tpledit="' + esc(t.id) + '">' + ic('note', 13) + 'Открыть</button>' +
          '<button class="bp ghost sm tpl-del" data-tpldelete="' + esc(t.id) + '" title="Удалить шаблон">' + ic('x', 13) + '</button>' +
        '</div></div>';
    }).join('');
    view.innerHTML = '<div class="card tpl-wrap">' +
      '<div class="sec-head"><span class="ic">' + ic('box', 14) + '</span>' +
        '<div><div class="t">Шаблоны пути поступления</div>' +
        '<div class="s">мастер-болванки: разворачиваются в доску «Поступление» клиента и правятся под него</div></div>' +
        '<button class="bp sm" id="tpl-new">' + ic('plus', 13) + 'Новый шаблон</button></div>' +
      '<div class="tpl-list">' + (cards || '<div class="empty">Пока нет шаблонов.</div>') + '</div></div>';
    var nb = el('tpl-new'); if (nb) nb.addEventListener('click', function () { startEditTemplate(null); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-tpledit]'), function (b) {
      b.addEventListener('click', function () { startEditTemplate(b.getAttribute('data-tpledit')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.tpl-del'), function (b) {
      b.addEventListener('click', function () {
        var tid = b.getAttribute('data-tpldelete');
        if (window.confirm('Удалить шаблон «' + tid + '»?')) {
          api('/admin/api/plan-templates/' + tid, { method: 'DELETE' }).then(function () {
            state._templates = null; showToast('Шаблон удалён'); renderView();
          });
        }
      });
    });
  }
  function startEditTemplate(id) {
    if (!id) {
      state._tplEdit = 'new';
      state._tplDraft = { id: '', name: '', segment: '', description: '', stages: [{ title: '', about: '', tasks: [] }] };
      renderView(); return;
    }
    state._tplEdit = id; state._tplDraft = null; renderView();
    api('/admin/api/plan-templates/' + id).then(function (t) {
      state._tplDraft = {
        id: t.id, name: t.name, segment: t.segment || '', description: t.description || '',
        stages: (t.stages || []).map(function (st) {
          return { title: st.title || '', about: st.about || '',
            tasks: (st.tasks || []).map(function (tk) {
              return { owner: tk.owner === 'eastside' ? 'eastside' : 'client', title: tk.title || '',
                description: tk.description || '', how_to: tk.how_to || '', tip: tk.tip || '', due_rule: tk.due_rule || '' };
            }) };
        }),
      };
      if (state.page === 'templates') renderView();
    }).catch(function () { showToast('Не удалось загрузить шаблон'); state._tplEdit = null; renderView(); });
  }
  function renderTemplateEditor(view) {
    var d = state._tplDraft;
    if (!d) { view.innerHTML = dashSkeleton(); return; }
    var stagesHtml = d.stages.map(function (st, si) {
      var tasks = st.tasks.map(function (tk, ti) {
        var own = tk.owner === 'eastside' ? 'eastside' : 'client';
        return '<div class="tpl-task">' +
          '<div class="tpl-task-top">' +
            '<div class="tpl-own">' +
              '<button class="tpl-own-b ' + (own === 'client' ? 'on' : '') + '" data-own="client" data-si="' + si + '" data-ti="' + ti + '">' + ic('leads', 12) + 'Клиент</button>' +
              '<button class="tpl-own-b ' + (own === 'eastside' ? 'on' : '') + '" data-own="eastside" data-si="' + si + '" data-ti="' + ti + '">' + ic('team', 12) + 'EastSide</button>' +
            '</div>' +
            '<button class="tpl-mini-del" data-deltask="' + si + '.' + ti + '" title="Удалить задачу">' + ic('x', 12) + '</button>' +
          '</div>' +
          '<input class="tpl-fld tpl-task-title" data-si="' + si + '" data-ti="' + ti + '" data-f="title" value="' + esc(tk.title) + '" placeholder="Название задачи">' +
          '<input class="tpl-fld" data-si="' + si + '" data-ti="' + ti + '" data-f="description" value="' + esc(tk.description) + '" placeholder="Что нужно сделать (описание)">' +
          '<textarea class="tpl-fld tpl-area" data-si="' + si + '" data-ti="' + ti + '" data-f="how_to" placeholder="Как выполнить — по строке на шаг">' + esc(tk.how_to) + '</textarea>' +
          '<input class="tpl-fld" data-si="' + si + '" data-ti="' + ti + '" data-f="tip" value="' + esc(tk.tip) + '" placeholder="Совет">' +
          '<input class="tpl-fld tpl-due" data-si="' + si + '" data-ti="' + ti + '" data-f="due_rule" value="' + esc(tk.due_rule) + '" placeholder="Срок (правило, напр. «до 1 декабря»)">' +
        '</div>';
      }).join('');
      return '<div class="tpl-stage">' +
        '<div class="tpl-stage-h">' +
          '<input class="tpl-fld tpl-stage-t" data-si="' + si + '" data-f="stitle" value="' + esc(st.title) + '" placeholder="Этап ' + (si + 1) + ' — название">' +
          '<button class="tpl-mini-del" data-delstage="' + si + '" title="Удалить этап">' + ic('x', 13) + '</button>' +
        '</div>' +
        '<input class="tpl-fld" data-si="' + si + '" data-f="sabout" value="' + esc(st.about) + '" placeholder="О чём этап — коротко">' +
        '<div class="tpl-tasks">' + (tasks || '<div class="tpl-empty">В этапе нет задач.</div>') + '</div>' +
        '<button class="bp ghost sm tpl-add-task" data-addtask="' + si + '">' + ic('plus', 12) + 'Добавить задачу</button>' +
      '</div>';
    }).join('');
    view.innerHTML = '<div class="card tpl-wrap">' +
      '<div class="tpl-edit-head">' +
        '<button class="bp ghost sm" id="tpl-cancel">' + ic('go', 13) + 'К списку</button>' +
        '<button class="bp sm" id="tpl-save">' + ic('check', 13) + 'Сохранить</button>' +
      '</div>' +
      '<div class="tpl-meta">' +
        '<input class="tpl-fld tpl-name" data-f="name" value="' + esc(d.name) + '" placeholder="Название шаблона">' +
        '<input class="tpl-fld tpl-slug" data-f="id" value="' + esc(d.id) + '" placeholder="slug (латиницей)" ' + (state._tplEdit === 'new' ? '' : 'disabled') + '>' +
        '<input class="tpl-fld" data-f="segment" value="' + esc(d.segment) + '" placeholder="сегмент (applying / exploring)">' +
        '<input class="tpl-fld tpl-desc" data-f="description" value="' + esc(d.description) + '" placeholder="Короткое описание">' +
      '</div>' +
      '<div class="tpl-stages">' + (stagesHtml || '<div class="empty">Нет этапов.</div>') + '</div>' +
      '<button class="bp ghost tpl-add-stage" id="tpl-add-stage">' + ic('plus', 13) + 'Добавить этап</button>' +
      '<div class="tpl-edit-foot"><span class="s">Владелец задачи: «Клиент» — делает ученик (видит и сдает), «EastSide» — делает команда. Стадии по порядку ложатся в этапы доски клиента.</span></div>' +
    '</div>';
    bindTemplateEditor(view);
  }
  function bindTemplateEditor(view) {
    var d = state._tplDraft;
    function rerender() { if (state.page === 'templates') renderView(); }
    Array.prototype.forEach.call(view.querySelectorAll('[data-f]'), function (f) {
      var ev = f.tagName === 'TEXTAREA' || f.tagName === 'INPUT' ? 'input' : 'change';
      f.addEventListener(ev, function () {
        var fid = f.getAttribute('data-f'), si = f.getAttribute('data-si'), ti = f.getAttribute('data-ti');
        if (ti !== null) d.stages[+si].tasks[+ti][fid] = f.value;
        else if (fid === 'name') d.name = f.value;
        else if (fid === 'id') d.id = f.value;
        else if (fid === 'segment') d.segment = f.value;
        else if (fid === 'description') d.description = f.value;
        else if (fid === 'stitle') d.stages[+si].title = f.value;
        else if (fid === 'sabout') d.stages[+si].about = f.value;
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.tpl-own-b'), function (b) {
      b.addEventListener('click', function () {
        d.stages[+b.getAttribute('data-si')].tasks[+b.getAttribute('data-ti')].owner = b.getAttribute('data-own');
        rerender();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-addtask]'), function (b) {
      b.addEventListener('click', function () {
        d.stages[+b.getAttribute('data-addtask')].tasks.push({ owner: 'client', title: '', description: '', how_to: '', tip: '', due_rule: '' });
        rerender();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-deltask]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-deltask').split('.'); d.stages[+p[0]].tasks.splice(+p[1], 1); rerender();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-delstage]'), function (b) {
      b.addEventListener('click', function () { d.stages.splice(+b.getAttribute('data-delstage'), 1); rerender(); });
    });
    var addSt = el('tpl-add-stage'); if (addSt) addSt.addEventListener('click', function () { d.stages.push({ title: '', about: '', tasks: [] }); rerender(); });
    var cancel = el('tpl-cancel'); if (cancel) cancel.addEventListener('click', function () { state._tplEdit = null; state._tplDraft = null; renderView(); });
    var save = el('tpl-save'); if (save) save.addEventListener('click', saveTemplate);
  }
  function saveTemplate() {
    var d = state._tplDraft;
    if (!d.name.trim()) { showToast('Введите название шаблона'); return; }
    if (state._tplEdit === 'new' && !d.id.trim()) { showToast('Введите slug (латиницей)'); return; }
    var body = {
      name: d.name, segment: d.segment, description: d.description,
      stages: d.stages.map(function (st) {
        return { title: st.title || 'Без названия', about: st.about,
          tasks: st.tasks.filter(function (tk) { return tk.title.trim(); }).map(function (tk) {
            return { owner: tk.owner, title: tk.title, description: tk.description, how_to: tk.how_to, tip: tk.tip, due_rule: tk.due_rule };
          }) };
      }),
    };
    var isNew = state._tplEdit === 'new';
    var path = '/admin/api/plan-templates' + (isNew ? '' : '/' + encodeURIComponent(state._tplEdit));
    body.id = d.id;
    apiSend(path, isNew ? 'POST' : 'PUT', body, function () {
      state._templates = null; state._tplEdit = null; state._tplDraft = null;
      showToast('Шаблон сохранён'); renderView();
    });
  }

  /* ── ТУЛБАР плана в секции «Поступление»: статус + публикация ──────────────
     Композер «AI собрать план» и раскатка шаблонов удалены: единственная точка
     входа — чат-помощник справа (он и собирает план с нуля, и правит точечно). */
  function planToolbar(id) {
    var pst = state.planStatus[id], pub = !!(pst && pst.published);
    return '<div class="rm-plan-tb">' +
        '<span class="rm-pub ' + (pub ? 'on' : 'off') + '"><i class="rm-pub-dot"></i>' +
          (pub ? 'Опубликовано ученику' : 'Черновик — ученику не виден') + '</span>' +
        '<div class="rm-plan-tb-act">' +
          '<button class="bp ghost sm" id="rm-pub-btn">' + (pub ? 'Снять публикацию' : 'Опубликовать') + '</button>' +
        '</div>' +
      '</div>' +
      aiReasonBlock(id);
  }

  /* ── ЧАТ ПРАВОК ПЛАНА: пристыкованная колонка справа от доски ──────────────
     Куратор говорит словами, что поправить; модель отвечает операциями по id задач,
     бэкенд применяет их сам и возвращает готовую доску (см. app/plan_ops.py).
     Точечно — потому что пересборка плана целиком стёрла бы прогресс ученика. */
  /* Правый столбец карточки лида: у «Поступления» — чат по плану, у «Витрины» — чат
     по продуктам. Один и тот же материал (.pchat), разные предметные области. */
  function hasSidePanel() {
    return state.modalSection === 'admission' || state.modalSection === 'offers';
  }

  function drawerChatPanel(id) {
    if (state.modalSection === 'admission') return planChatPanel(id);
    if (state.modalSection === 'offers') return offersChatPanel(id);
    return '';
  }

  function planChatPanel(id) {
    var msgs = PCHAT[id] || [];
    var emptyBoard = !(rmTasks(id) || []).length;
    var body;
    if (!PCHAT_LOADED[id]) {
      body = '<div class="pchat-empty">Загружаю…</div>';
    } else if (!msgs.length) {
      // подсказки зависят от состояния доски: пустая — собираем план, полная — правим
      var hints = emptyBoard
        ? ['Собери план по анкете и диагностике',
           'Собери план: сначала язык, вузы запасные',
           'Собери короткий план — только ближайшие шаги']
        : ['Сдвинь сроки документов на месяц',
           'Добавь задачу на экзамен по английскому',
           'Убери задачи по визе — до нее еще далеко'];
      body = '<div class="pchat-empty">' +
        '<div class="pchat-empty-t">' + (emptyBoard ? 'Плана еще нет' : 'Скажите, что поправить') + '</div>' +
        '<div class="pchat-empty-s">' + (emptyBoard
          ? 'Скажите — соберу с нуля по анкете, диагностике и требованиям вузов.'
          : 'Правлю точечно — статусы, комментарии и файлы ученика не трогаю.') + '</div>' +
        '<div class="pchat-hints">' +
          hints.map(function (h) {
            return '<button class="pchat-hint" data-hint="' + esc(h) + '">' + esc(h) + '</button>';
          }).join('') +
        '</div></div>';
    } else {
      body = msgs.map(function (m) {
        if (m.me) return '<div class="pchat-m me"><div class="pchat-b">' + esc(m.text) + '</div></div>';
        return '<div class="pchat-m ai"><div class="pchat-b">' + esc(m.text) + '</div>' +
          pchatReport(m.report) + '</div>';
      }).join('');
    }
    if (PCHAT_BUSY[id]) {
      // Модель думает до минуты. Спиннер на такой срок читается как «зависло», поэтому
      // показываем живой ход мысли: три точки + сменяющаяся строка, что он сейчас делает.
      body += '<div class="pchat-m ai"><div class="pchat-b pchat-wait">' +
        '<span class="pchat-dots"><i></i><i></i><i></i></span>' +
        '<span class="pchat-wait-t" id="pchat-wait-t">' +
          (PCHAT_BUSY[id] === 'build' ? 'Изучаю анкету и диагностику' : 'Читаю план') +
        '</span></div></div>';
    }
    return '<aside class="pchat" id="pchat">' +
      '<div class="pchat-head">' + ic('spark', 14) +
        '<span class="pchat-title">План с AI</span>' +
      '</div>' +
      '<div class="pchat-list" id="pchat-list">' + body + '</div>' +
      '<div class="pchat-foot">' +
        '<textarea class="pchat-in" id="pchat-in" rows="1" placeholder="' +
          (emptyBoard ? 'Какой план собрать?' : 'Что поправить в плане?') + '"' +
          (PCHAT_BUSY[id] ? ' disabled' : '') + '></textarea>' +
        '<button class="pchat-go" id="pchat-go" title="Отправить"' +
          (PCHAT_BUSY[id] ? ' disabled' : '') + '>' + ic('go', 14) + '</button>' +
      '</div>' +
    '</aside>';
  }

  /* Что именно AI сделал с доской. Куратору важно не «поправил задачу», а ЧТО стало
     другим — поэтому у правки показываем сам дифф «было → стало». Отклонённое
     показываем тоже: молчать о том, что правка не легла, нельзя. */
  var PCHAT_STAGE_RU = {
    intro: 'Знакомство', strategy: 'Стратегия', docs: 'Документы', submit: 'Подача',
    exam: 'Экзамены', result: 'Результат', visa: 'Виза', move: 'Переезд',
  };
  var PCHAT_FIELD_RU = {
    title: 'название', need: 'описание', due: 'срок', owner: 'кто делает',
    stage: 'этап', status: 'статус', how_to: 'инструкция', tip: 'совет',
    submit: 'ответ ученика',
  };
  var PCHAT_OWNER_RU = { client: 'клиент', team: 'мы', student: 'ученик', parent: 'родитель' };
  var PCHAT_STATUS_RU = { wait: 'ждет', doing: 'в работе', review: 'на проверке', done: 'готово', return: 'вернули' };

  function pchatVal(field, v) {
    if (v === null || v === undefined || v === '') return 'пусто';
    // Дата в диффе — голая (ДД.ММ.ГГ): fmtDue лепит «просрочено ·», а это не про «было».
    // Но в старых задачах due — свободный текст («к 20 октября»), его резать по позициям
    // нельзя: получится каша. Форматируем только настоящий ISO.
    if (field === 'due') {
      var s = String(v);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(2, 4) : s;
    }
    if (field === 'owner') return PCHAT_OWNER_RU[v] || v;
    if (field === 'status') return PCHAT_STATUS_RU[v] || v;
    if (field === 'stage') return PCHAT_STAGE_RU[v] || v;
    if (field === 'submit') return RM_SUBMIT_RU[v] || v;
    var s = String(v);
    return s.length > 42 ? s.slice(0, 42) + '…' : s;
  }

  function pchatReport(report) {
    if (!Array.isArray(report) || !report.length) return '';
    var VERB = { add: 'Добавил', edit: 'Поправил', remove: 'Удалил', stage: 'Переименовал' };
    var ok = report.filter(function (r) { return r.ok; });
    var bad = report.filter(function (r) { return !r.ok && r.why && r.why !== 'нечего менять'; });
    if (!ok.length && !bad.length) return '';

    var rows = ok.map(function (r) {
      var stage = r.stage ? '<span class="pchat-rw-st">' + esc(PCHAT_STAGE_RU[r.stage] || r.stage) + '</span>' : '';
      var diff = '';
      if (r.op === 'edit' && Array.isArray(r.changes) && r.changes.length) {
        diff = '<div class="pchat-diff">' + r.changes.map(function (c) {
          return '<div class="pchat-df"><span class="pchat-df-f">' + esc(PCHAT_FIELD_RU[c.field] || c.field) + '</span>' +
            '<span class="pchat-df-a">' + esc(pchatVal(c.field, c.from)) + '</span>' +
            '<span class="pchat-df-ar">→</span>' +
            '<span class="pchat-df-b">' + esc(pchatVal(c.field, c.to)) + '</span></div>';
        }).join('') + '</div>';
      }
      return '<div class="pchat-rw ' + esc(r.op) + '">' +
        '<div class="pchat-rw-h"><span class="pchat-rw-v">' + (VERB[r.op] || r.op) + '</span>' + stage + '</div>' +
        '<div class="pchat-rw-t">' + esc(r.title || r.key || '') + '</div>' + diff + '</div>';
    }).join('');

    // Отклонённое схлопываем в одну строку: три подряд «Не применил» — это шум,
    // куратору хватает факта и причины.
    var badRow = '';
    if (bad.length) {
      var why = bad.map(function (r) { return r.why; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      badRow = '<div class="pchat-rw bad"><div class="pchat-rw-h">' +
        '<span class="pchat-rw-v">Не применил</span>' +
        '<span class="pchat-rw-st">' + bad.length + '</span></div>' +
        '<div class="pchat-rw-t">' + esc(why.join('; ')) + '</div></div>';
    }
    return '<div class="pchat-rep">' + rows + badRow + '</div>';
  }

  function loadPlanChat(id) {
    if (PCHAT_LOADED[id]) return;
    api('/admin/api/leads/' + id + '/plan/chat').then(function (r) {
      PCHAT[id] = [];
      (r && r.messages || []).forEach(function (m) {
        PCHAT[id].push({ me: true, text: m.message });
        PCHAT[id].push({ me: false, text: m.reply, report: m.report });
      });
      PCHAT_LOADED[id] = true;
      if (state.drawerId === id && state.modalSection === 'admission') renderDrawer(true);
    }).catch(function () { PCHAT_LOADED[id] = true; });
  }

  /* Шиммер по изменённым задачам: id → true. Ставится после ответа чата,
     карточки получают класс rm-flash (переливающаяся полоска света). */
  var RM_FLASH = {};
  function pchatFlash(id, ids) {
    RM_FLASH = {};
    (ids || []).forEach(function (tid) { if (tid) RM_FLASH[tid] = true; });
    renderDrawer(true);
    var first = document.querySelector('.rm-task.rm-flash');
    if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(function () { RM_FLASH = {}; }, 3000);
  }

  function pchatSend(id, text) {
    if (!text || PCHAT_BUSY[id]) return;
    PCHAT[id] = PCHAT[id] || [];
    PCHAT[id].push({ me: true, text: text });
    var emptyBoard = !(rmTasks(id) || []).length;
    // Пустая доска: реплика уходит в ПОЛНУЮ сборку плана (plan/ai — с логикой трека,
    // этапами и reasoning), а не в чат-операции. Дальше — точечные правки чатом.
    if (emptyBoard) { pchatBuild(id, text); return; }
    PCHAT_BUSY[id] = true;
    renderDrawer(true);
    api('/admin/api/leads/' + id + '/plan/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    }).then(function (r) {
      PCHAT_BUSY[id] = false;
      PCHAT[id].push({ me: false, text: (r && r.reply) || 'Готово.', report: r && r.report });
      // Бэкенд применил правки и сохранил сам — забираем готовую доску, а не склеиваем.
      if (r && r.changed && Array.isArray(r.admission)) {
        RM[id] = r.admission; RM_LOADED[id] = true;
        if (Array.isArray(r.admission_stages)) RM_STAGES[id] = r.admission_stages;
        var l = findLead(id); if (l && l.crm) l.crm.admission = r.admission;
        var d = state.details[id]; if (d && d.crm) { d.crm.admission = r.admission; cacheSet(id, d); }
        var touched = (r.report || []).filter(function (x) { return x.ok && x.id; })
          .map(function (x) { return x.id; });
        pchatFlash(id, touched);
        return;
      }
      renderDrawer(true);
    }).catch(function (e) {
      PCHAT_BUSY[id] = false;
      if (!(e && e.message === '403')) {
        PCHAT[id].push({ me: false, text: 'Не получилось — AI не ответил. Попробуйте еще раз.' });
      }
      renderDrawer(true);
    });
  }

  /* Сборка плана с нуля из чата: та же кнопка «отправить», другой маршрут. */
  function pchatBuild(id, text) {
    PCHAT_BUSY[id] = 'build';
    renderDrawer(true);
    api('/admin/api/leads/' + id + '/plan/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text || '', mode: 'replace' }),
    }).then(function (res) {
      PCHAT_BUSY[id] = false;
      var tasks = res && res.tasks;
      if (!Array.isArray(tasks) || !tasks.length) throw new Error('empty');
      if (Array.isArray(res.stages) && res.stages.length) RM_STAGES[id] = res.stages;
      RM_REASON[id] = res.reasoning || null;
      rmSet(id, tasks);
      delete state.planStatus[id];
      var why = (res.reasoning && res.reasoning.why) || '';
      // Отчёт-простыню из 20+ «Добавил» не показываем: сборку целиком видно по доске
      // (шиммер) и по блоку «Как AI собрал этот план» над ней.
      PCHAT[id].push({ me: false,
        text: 'Собрал план: ' + tasks.length + ' задач. ' + why +
          ' Дальше правьте словами — меняю точечно. Логика сборки — над доской.' });
      pchatFlash(id, tasks.map(function (t) { return t.id; }));
    }).catch(function (e) {
      if (PCHAT_BUSY[id]) PCHAT_BUSY[id] = false;
      if (!(e && e.message === '403')) {
        PCHAT[id].push({ me: false, text: e && e.message === 'empty'
          ? 'Не собрал задачи — попробуйте еще раз или уточните, что важно.'
          : 'Не получилось — AI не ответил. Попробуйте еще раз.' });
      }
      renderDrawer(true);
    });
  }

  function bindPlanChat(id) {
    var inp = el('pchat-in'), go = el('pchat-go');
    var fire = function () {
      if (!inp) return;
      var v = (inp.value || '').trim();
      if (v) { inp.value = ''; pchatSend(id, v); }
    };
    if (go) go.addEventListener('click', fire);
    if (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire(); }
      });
      // поле растёт под текст, но не бесконечно
      inp.addEventListener('input', function () {
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 132) + 'px';
      });
      // без автофокуса: чат теперь открыт всегда, и перерисовка доски (чекбокс,
      // раскрытие задачи) не должна воровать фокус у того, что делает куратор
    }
    var list = el('pchat-list');
    if (list) list.scrollTop = list.scrollHeight;
    Array.prototype.forEach.call(document.querySelectorAll('.pchat-hint'), function (b) {
      b.addEventListener('click', function () { pchatSend(id, b.getAttribute('data-hint')); });
    });
    pchatWaitTicker(id);
  }

  /* Пока модель думает — строка меняется, чтобы ожидание читалось как работа, а не как
     зависший спиннер. Таймер живёт только пока висит его же узел. */
  function pchatWaitTicker(id) {
    var node = el('pchat-wait-t');
    if (!node) return;
    var steps = PCHAT_BUSY[id] === 'build'
      ? ['Изучаю анкету и диагностику', 'Подбираю вузы и сроки под профиль', 'Собираю этапы и задачи']
      : ['Читаю план', 'Сверяю со сроками и вузами', 'Собираю правки'];
    var i = 0;
    var t = setInterval(function () {
      var n = el('pchat-wait-t');
      if (!n || !PCHAT_BUSY[id]) { clearInterval(t); return; }
      i = Math.min(i + 1, steps.length - 1);
      n.textContent = steps[i];
    }, 4500);
  }

  /* Логика последней AI-сборки: почему такой трек, ключевые решения и какие этапы
     пропущены и почему. Без этого куратор видел готовый план и не понимал, откуда он. */
  function aiReasonBlock(id) {
    var r = RM_REASON[id];
    if (!r) return '';
    var TRACK = {
      guided: 'Полное сопровождение до зачисления', explore: 'Прогрев — сначала присмотреться',
      early: 'Ранний старт', service: 'Сервис — место уже есть', prep: 'Сначала язык и профиль',
    };
    var out = '<div class="rm-why"><div class="rm-why-h">' + ic('spark', 13) + 'Как AI собрал этот план</div>';
    if (r.track || r.why) {
      out += '<div class="rm-why-track">' +
        (r.track ? '<span class="rm-why-pill">' + esc(TRACK[r.track] || r.track) + '</span>' : '') +
        (r.why ? '<span class="rm-why-txt">' + esc(r.why) + '</span>' : '') + '</div>';
    }
    if (Array.isArray(r.decisions) && r.decisions.length) {
      out += '<ul class="rm-why-list">' + r.decisions.map(function (d) {
        return '<li>' + esc(d) + '</li>';
      }).join('') + '</ul>';
    }
    if (Array.isArray(r.skipped) && r.skipped.length) {
      out += '<div class="rm-why-sub">Этапы, которые AI сознательно пропустил</div>' +
        '<ul class="rm-why-list skip">' + r.skipped.map(function (s) {
          return '<li><b>' + esc(s.title || s.stage) + '</b>' + (s.why ? ' — ' + esc(s.why) : '') + '</li>';
        }).join('') + '</ul>';
    }
    if (Array.isArray(r.dropped) && r.dropped.length) {
      out += '<div class="rm-why-warn">' + ic('alert', 13) +
        'Не разобрал этап у ' + r.dropped.length + ' задач — они не попали в план: ' +
        esc(r.dropped.map(function (d) { return d.title; }).join('; ')) + '</div>';
    }
    return out + '</div>';
  }
  function ensurePlanStatus(id, force) {
    if (!force && state.planStatus[id] !== undefined) return;
    if (state.planStatus[id] === 'loading') return;
    state.planStatus[id] = state.planStatus[id] || 'loading';
    api('/admin/api/leads/' + id + '/plan').then(function (r) {
      // мета этапов (личные названия/описания от AI) — чтобы доска куратора показывала
      // те же заголовки, что видит ученик, а не сухой словарь
      var meta = {};
      ((r && r.plan && r.plan.stages) || []).forEach(function (s) {
        if (s && s.key) meta[s.key] = { title: s.title || '', about: s.about || '' };
      });
      state.planStatus[id] = { published: !!(r && r.published), meta: meta };
      if (state.drawerId === id && state.modalSection === 'admission') renderDrawer(true);
    }).catch(function () {
      if (state.planStatus[id] === 'loading') state.planStatus[id] = { published: false };
    });
  }
  function wirePlanToolbar(id) {
    var host = document.querySelector('#m-content') || document.getElementById('m-content');
    if (!host) return;
    var pubBtn = host.querySelector('#rm-pub-btn');
    if (pubBtn) pubBtn.addEventListener('click', function () {
      var pub = state.planStatus[id] && state.planStatus[id].published;
      doPublish(id, !pub);
    });
    // чат-помощник всегда открыт рядом с доской
    loadPlanChat(id);
    bindPlanChat(id);
  }
  function doPublish(id, on) {
    var rerender = function () { if (state.drawerId === id && state.modalSection === 'admission') renderDrawer(true); };
    api('/admin/api/leads/' + id + '/plan/' + (on ? 'publish' : 'unpublish'), { method: 'POST' })
      .then(function (r) {
        // Правда — ответ сервера, не локальный флип: кэш не разъезжается с бэком.
        state.planStatus[id] = { published: !!(r && r.published) };
        showToast(state.planStatus[id].published ? 'План опубликован ученику' : 'Публикация снята');
        rerender();
      })
      .catch(function (e) {
        if (e && e.message !== '403') showToast('Не сохранилось — проверь сеть');
        ensurePlanStatus(id, true); // пересинхронизировать реальный статус с бэка
        rerender();
      });
  }

  function pageAnim(view) {
    if (state._animPage === state.page) return;
    state._animPage = state.page;
    view.classList.remove('view-anim'); void view.offsetWidth; view.classList.add('view-anim');
  }

  /* ── ОБЗОР ────────────────────────────────────────────── */
  /* спокойная метрика-полоса вместо кричащих плиток */
  function statBar(items) {
    return '<div class="card statbar">' + items.map(function (s) {
      var foot = s.delta
        ? '<span class="kd ' + (s.deltaCls || '') + '">' + s.delta + '</span>'
        : (s.sub ? '<span class="smut">' + s.sub + '</span>' : '');
      return '<button class="stat' + (s.go ? ' go' : '') + '"' + (s.go ? ' data-go="' + s.go + '"' : '') + '>' +
        '<div class="sl">' + s.label + '</div>' +
        '<div class="sv num">' + s.value + '</div>' +
        '<div class="sd">' + foot + '</div>' +
      '</button>';
    }).join('') + '</div>';
  }

  /* отдельный блок задач: просрочено / сегодня / ближайшие */
  function tasksCard() {
    var g = groupTasks();
    var groups = [
      { key: 'over',  label: 'Просрочено', cls: 'over', rows: g.over },
      { key: 'today', label: 'Сегодня',    cls: '',     rows: g.today },
      { key: 'soon',  label: 'Ближайшие',  cls: '',     rows: g.soon },
    ].filter(function (gr) { return gr.rows.length; });

    var body;
    if (!g.total) {
      body = '<div class="tasks-empty"><span class="te-ic">' + ic('check', 16) + '</span>' +
        '<span>Открытых задач со сроком нет. Поставить задачу можно в карточке клиента.</span></div>';
    } else {
      body = groups.map(function (gr) {
        var rows = gr.rows.slice(0, 6).map(function (it) {
          var over = gr.key === 'over';
          return '<div class="tk-row' + (over ? ' over' : '') + '" data-id="' + it.lead.id + '">' +
            '<div class="tk-main"><div class="tk-txt">' + esc(it.task.text) + '</div>' +
            '<div class="tk-who">' + esc(leadName(it.lead)) + '</div></div>' +
            '<div class="tk-due ' + (over ? 'over' : gr.key === 'soon' ? 'soon' : '') + ' num">' + esc(fmtDue(it.task.due)) + '</div>' +
            '<div class="tk-go">' + ic('go', 13) + '</div></div>';
        }).join('');
        var more = gr.rows.length > 6 ? '<div class="tk-row" style="cursor:default;color:var(--ink-3)"><div class="tk-main tk-txt" style="font-weight:500;color:var(--ink-3)">+ ещё ' + (gr.rows.length - 6) + '</div></div>' : '';
        return '<div class="tk-group"><div class="tk-glabel ' + gr.cls + '">' + gr.label +
          '<span class="gn num">' + gr.rows.length + '</span></div>' + rows + more + '</div>';
      }).join('');
    }
    return '<div class="card tasks-card" style="overflow:hidden">' +
      '<div class="sec-head" style="padding:20px 24px 8px">' +
        '<span class="ic">' + ic('task', 14) + '</span>' +
        '<div><div class="t">Задачи</div><div class="s">что запланировано по клиентам — со сроками</div></div>' +
        (g.total ? '<span class="cnt num">' + g.total + '</span>' : '') + '</div>' +
      '<div' + (g.total ? ' style="border-top:1px solid var(--line);margin-top:6px"' : '') + '>' + body + '</div></div>';
  }

  /* ── премиум-скелетоны (шиммер) ── */
  function shimStat() {
    return '<div class="sk-stat"><div class="shim l"></div><div class="shim b"></div><div class="shim s"></div></div>';
  }
  function shimCard(lines) {
    var rows = '';
    for (var i = 0; i < (lines || 5); i++) rows += '<div class="sk-line"><div class="shim a"></div><div class="shim c"></div></div>';
    return '<div class="sk-card"><div class="sk-h"><div class="shim ic"></div><div class="shim tt"></div></div>' + rows + '</div>';
  }
  function dashSkeleton() {
    return '<div class="dash">' +
      '<div class="sk-statbar">' + shimStat() + shimStat() + shimStat() + shimStat() + '</div>' +
      '<div class="grid">' +
        '<div class="sp7">' + shimCard(6) + '</div>' +
        '<div class="sp5">' + shimCard(6) + '</div>' +
      '</div></div>';
  }

  function renderDash(view) {
    if (!can('clients')) { noClientsStub(view, 'dash'); return; }
    var P = state.dashPeriod;
    var c = dashCounts(P);
    var cAll = counts();
    var risks = allRisks();
    var convA = c.anketa ? Math.round(c.booked / c.anketa * 100) : 0;
    var convClient = c.booked ? Math.round(c.clients / c.booked * 100) : 0;

    /* «Сегодня — к действию» — горячие заявки + риски статусов (задачи теперь в своей карточке) */
    var acts = [];
    state.leads.forEach(function (l) {
      if (l.booking && l.crm.status === 'new') {
        acts.push({ sev: 3, cls: 'r-crit', pill: '<span class="sev s-hot">горячий</span>',
          lead: l, text: esc(leadName(l)), sub: 'заявка ждет связи' + ((l.booking || {}).slot ? ' · разбор: ' + esc(l.booking.slot) : ''),
          when: ago(l.booking.at || l.created_at) });
      }
    });
    risks.forEach(function (r) {
      if (r.label.indexOf('задача') !== -1 || (r.lead.booking && r.lead.crm.status === 'new')) return;
      acts.push({ sev: r.sev, cls: r.sev >= 2 ? 'r-crit' : 'r-mid',
        pill: '<span class="sev ' + (r.sev >= 2 ? 's-hot' : 's-contacted') + '">риск</span>',
        lead: r.lead, text: esc(leadName(r.lead)), sub: esc(r.label), when: '' });
    });
    acts.sort(function (a, b) { return b.sev - a.sev; });
    var actRows = acts.length ? acts.slice(0, 8).map(function (a) {
      return '<div class="trow ar-grid ' + a.cls + '" data-id="' + a.lead.id + '">' + a.pill +
        '<div class="t-cell"><div class="t-ttl">' + a.text + '</div><div class="t-sub">' + a.sub + '</div></div>' +
        '<div class="t-when num">' + esc(a.when) + '</div><div class="t-go">' + ic('go', 13) + '</div></div>';
    }).join('') : '<div class="empty">Горячих заявок и рисков нет. Спокойно.</div>';
    var actCard = '<div class="card" style="overflow:hidden">' +
      '<div class="sec-head" style="padding:20px 24px 14px">' +
        '<span class="ic">' + ic('flame', 14) + '</span><div><div class="t">Сегодня — к действию</div>' +
        '<div class="s">с чего начать: горячие заявки и риски по лидам в работе</div></div>' +
        '<span class="cnt num">' + acts.length + '</span></div>' +
      '<div style="border-top:1px solid var(--line)">' + actRows + '</div></div>';

    /* воронка продаж */
    var booked = state.leads.filter(function (l) { return l.booking; });
    var saleSteps = ['new', 'contacted', 'call_scheduled', 'call_done', 'offer_sent', 'client'];
    var saleCounts = saleSteps.map(function (s, i) {
      return booked.filter(function (l) { return l.crm.status !== 'rejected' && CRM[l.crm.status].order >= i; }).length;
    });
    var weakest = -1, weakRatio = 1;
    for (var j = 1; j < saleCounts.length; j++) {
      if (!saleCounts[j - 1]) continue;
      var ratio = saleCounts[j] / saleCounts[j - 1];
      if (ratio < weakRatio && saleCounts[j - 1] >= 2) { weakRatio = ratio; weakest = j; }
    }
    var convSale = saleCounts[0] ? Math.round(saleCounts[saleCounts.length - 1] / saleCounts[0] * 100) : 0;
    var saleRows = saleSteps.map(function (s, i) {
      var n = saleCounts[i];
      var w = saleCounts[0] ? Math.round(n / saleCounts[0] * 100) : 0;
      var conv = i && saleCounts[i - 1] ? Math.round(n / saleCounts[i - 1] * 100) + '%' : '';
      return '<div class="cvc-row' + (i === weakest ? ' weak' : '') + '">' +
        '<div class="cvc-nm">' + (i === 0 ? 'Заявки' : CRM[s].label) + '</div>' +
        '<div class="cvc-track"><div class="cvc-fill" style="width:' + Math.max(w, n ? 5 : 0) + '%"></div></div>' +
        '<div class="cvc-c num">' + n + '</div><div class="cvc-p num">' + conv + '</div></div>';
    }).join('');
    var funnelCard = '<div class="card" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('funnel', 14) + '</span><div class="t">Воронка продаж</div>' +
      '<span class="cnt num">' + convSale + '% в клиента</span></div>' +
      '<div class="cvc-rows" style="margin-top:12px">' + saleRows + '</div></div>';

    if (!can('path')) {
      /* ── без доступа к воронке/пути: компактный дашборд «что делать» ── */
      view.innerHTML = '<div class="dash">' +
        statBar([
          { tint: c.hot ? 'red' : '', label: 'Ждут связи', value: c.hot, go: 'queue', delta: c.hot ? 'написать сегодня' : '', deltaCls: 'bad', sub: c.hot ? '' : 'всё разобрано' },
          { tint: 'blue', label: 'Сессии' + (P ? '' : ' сегодня'), value: P ? c.all : c.today, sub: P ? DPERIOD_LABEL[P] : c.week + ' за неделю' },
          { tint: 'navy', label: 'В работе', value: c.queue, go: 'queue', sub: 'заявок веду' },
          { tint: 'green', label: 'Клиенты', value: c.clients, go: 'clients', sub: convClient ? convClient + '% из заявок' : '' },
        ]) +
        '<div class="grid">' +
          '<div class="sp7 vstack">' + actCard + tasksCard() + '</div>' +
          '<div class="sp5 vstack">' + funnelCard + '</div>' +
        '</div>' +
      '</div>';
    } else {
      /* ── ВЛАДЕЛЕЦ: картина бизнеса + где дыры ── */
      var days = [];
      for (var i = 13; i >= 0; i--) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ d: d, sessions: 0, booked: 0 }); }
      var total14 = 0;
      state.leads.forEach(function (l) {
        if (!l.created_at) return;
        var t = new Date(l.created_at); t.setHours(0, 0, 0, 0);
        days.forEach(function (day) { if (day.d.getTime() === t.getTime()) { day.sessions++; total14++; if (l.booking) day.booked++; } });
      });
      var maxS = Math.max(1, Math.max.apply(null, days.map(function (x) { return x.sessions; })));
      var chart = '<div class="chart">' + days.map(function (day) {
        var h1 = Math.round(day.sessions / maxS * 100), h2 = Math.round(day.booked / maxS * 100);
        return '<div class="ch-day" title="' + pad(day.d.getDate()) + '.' + pad(day.d.getMonth() + 1) + ': сессий ' + day.sessions + ', заявок ' + day.booked + '">' +
          (h2 ? '<div class="b2" style="height:' + h2 + '%"></div>' : '') +
          '<div class="b1" style="height:' + Math.max(3, h1 - h2) + '%"></div></div>';
      }).join('') + '</div>' +
      '<div class="ch-labels">' + days.map(function (day, idx) { return '<span class="num">' + (idx % 2 === 1 ? pad(day.d.getDate()) : '') + '</span>'; }).join('') + '</div>' +
      '<div class="ch-legend"><span><i style="background:#1C2B4A"></i>сессии</span><span><i style="background:#2F6BFF"></i>заявки</span></div>';
      var chartCard = '<div class="card sp7" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('chart', 14) + '</span><div><div class="t">Динамика 14 дней</div>' +
        '<div class="s">' + total14 + ' сессий · сколько дошло до заявки</div></div></div>' + chart + '</div>';

      /* где теряем людей — карточка с худшим шагом */
      var steps = funnelData('');
      var worst = worstStep(steps);
      var loseCard;
      if (worst) {
        var dropped = worst.step.dropped;
        var withC = dropped.filter(function (l) { return (l.booking || {}).contact || l.email; }).length;
        loseCard = '<div class="card sp5 clickcard" id="go-path" style="padding:22px 26px">' +
          '<div class="sec-head"><span class="ic warn">' + ic('path', 14) + '</span><div class="t">Где теряем людей</div>' +
          '<span class="lnk">Путь ' + ic('go', 13) + '</span></div>' +
          '<div class="lose-body">' +
            '<div class="lose-big"><b class="num">−' + Math.round(worst.pct * 100) + '%</b><span>на шаге «' + esc(worst.step.label) + '»</span></div>' +
            '<div class="lose-sub">' + dropped.length + ' ' + plural(dropped.length, 'человек', 'человека', 'человек') + ' ушли здесь' +
            (withC ? ' · у ' + withC + ' есть контакт — можно догнать' : '') + '</div></div></div>';
      } else {
        loseCard = '<div class="card sp5 clickcard" id="go-path" style="padding:22px 26px">' +
          '<div class="sec-head"><span class="ic">' + ic('path', 14) + '</span><div class="t">Путь по платформе</div>' +
          '<span class="lnk">Открыть ' + ic('go', 13) + '</span></div>' +
          '<div class="lose-body"><div class="lose-sub">Заметных дыр в воронке нет. В разделе «Путь» — путь людей по шагам платформы.</div></div></div>';
      }

      /* гео показываем только когда есть данные — иначе дыра в сетке */
      var geoHasData = state.leads.some(function (l) { return (l.geo || {}).city; });
      // loseCard(sp5)+dirs(sp7)=12 заполняют ряд; гео (если есть) — полной шириной ниже
      var dirs = dirsCard(7);
      var bottomRow = dirs + (geoHasData ? geoCard() : '');

      view.innerHTML = '<div class="dash">' +
        statBar([
          { tint: 'blue', label: 'Сессии' + (P ? '' : ' сегодня'), value: P ? c.all : c.today, sub: P ? DPERIOD_LABEL[P] : c.week + ' за 7 дней' },
          { tint: 'navy', label: 'Заявки на разбор', value: c.booked, delta: convA + '% из анкеты', deltaCls: convA >= 10 ? 'good' : 'mid' },
          { tint: 'green', label: 'Клиенты', value: c.clients, delta: convClient + '% из заявок', deltaCls: convClient > 0 ? 'good' : 'mid' },
          { tint: (cAll.hot + risks.length) ? 'red' : '', label: 'Требуют внимания', value: cAll.hot + risks.length, go: 'queue', sub: (cAll.hot + risks.length) ? 'разобрать' : 'чисто' },
        ]) +
        '<div class="grid">' +
          '<div class="sp7 vstack">' + actCard + '</div>' +
          '<div class="sp5 vstack">' + tasksCard() + '</div>' +
          '<div class="sp7 vstack">' + chartCard + '</div>' +
          '<div class="sp5 vstack">' + funnelCard + '</div>' +
          loseCard + bottomRow +
        '</div>' +
      '</div>';
    }

    Array.prototype.forEach.call(view.querySelectorAll('.trow[data-id]'), function (n) {
      n.addEventListener('click', function () { openDrawer(n.getAttribute('data-id'), acts.map(function (a) { return a.lead.id; })); });
      n.addEventListener('mouseenter', function () { warm(n.getAttribute('data-id')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.tk-row[data-id]'), function (n) {
      n.addEventListener('click', function () { openDrawer(n.getAttribute('data-id')); });
      n.addEventListener('mouseenter', function () { warm(n.getAttribute('data-id')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.stat[data-go]'), function (b) {
      b.addEventListener('click', function () { var g = b.getAttribute('data-go'); if (g === 'clients') { state.seg = 'clients'; saveUi(); } setPage(g === 'clients' ? 'leads' : g); });
    });
    var gp = el('go-path');
    if (gp) gp.addEventListener('click', function () { setPage('path'); });
    animBars(view);
  }

  var DONUT_COLORS = ['#2F6BFF', '#1C2B4A', '#7EA4FF', '#E0922F', '#A6ABB8'];
  function topCount(items) {
    var map = {};
    items.forEach(function (k) { if (k) map[k] = (map[k] || 0) + 1; });
    return Object.keys(map).map(function (k) { return { label: k, n: map[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
  }
  /* «Направления» — что спрашивают в анкете (донат как в референсе) */
  function dirsCard(span) {
    var all = [];
    state.leads.forEach(function (l) {
      var d = l.directions;
      if (Array.isArray(d)) d.forEach(function (x) { all.push(x); });
      else if (d) all.push(d);
    });
    var top = topCount(all);
    if (!top.length) return '';
    var parts = top.slice(0, 4);
    var rest = top.slice(4).reduce(function (s, p) { return s + p.n; }, 0);
    if (rest) parts.push({ label: 'Другое', n: rest });
    var total = all.length;
    var acc = 0;
    var grad = parts.map(function (p, i) {
      var from = acc / total * 100;
      acc += p.n;
      var to = acc / total * 100;
      return DONUT_COLORS[i] + ' ' + from + '% ' + to + '%';
    }).join(', ');
    var legend = parts.map(function (p, i) {
      return '<div class="r"><span class="dd2" style="background:' + DONUT_COLORS[i] + '"></span>' +
        '<span class="dnm">' + esc(p.label) + '</span>' +
        '<span class="dcount num">' + p.n + '</span>' +
        '<span class="dpc num">' + Math.round(p.n / total * 100) + '%</span></div>';
    }).join('');
    return '<div class="card sp' + (span || 7) + '" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('pie', 14) + '</span>' +
      '<div><div class="t">Направления</div><div class="s">что выбирают в анкете — куда хотят поступать</div></div></div>' +
      '<div class="distr-body"><div class="dwrap"><div class="dpie" style="background:conic-gradient(' + grad + ')"></div>' +
      '<div class="dctr"><div><div class="dn num">' + total + '</div><div class="ds">выборов</div></div></div></div>' +
      '<div class="dleg">' + legend + '</div></div></div>';
  }
  /* «География» — откуда заходят (по IP с платформы) */
  function geoCard() {
    var cities = topCount(state.leads.map(function (l) { return (l.geo || {}).city; }));
    var inner;
    if (cities.length) {
      var totalGeo = cities.reduce(function (s, c) { return s + c.n; }, 0);
      var max = cities[0].n;
      inner = '<div class="cvc-rows" style="margin-top:12px">' + cities.slice(0, 6).map(function (c) {
        return '<div class="cvc-row">' +
          '<div class="cvc-nm">' + esc(c.label) + '</div>' +
          '<div class="cvc-track"><div class="cvc-fill" style="width:' + Math.max(6, Math.round(c.n / max * 100)) + '%"></div></div>' +
          '<div class="cvc-c num">' + c.n + '</div>' +
          '<div class="cvc-p num">' + Math.round(c.n / totalGeo * 100) + '%</div>' +
        '</div>';
      }).join('') + '</div>';
    } else {
      inner = '<div class="empty" style="padding:30px 10px">География собирается с новых сессий на платформе — карточка наполнится сама.</div>';
    }
    return '<div class="card sp12" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('pin', 14) + '</span>' +
      '<div><div class="t">География</div><div class="s">откуда заходят на диагностику</div></div></div>' +
      inner + '</div>';
  }

  /* ── ЛИДЫ — тулбар + тело (таблица/канбан) в одном контейнере ── */
  function renderLeads(view) {
    view.innerHTML = '<div class="card listcard">' + leadsToolbar() + '<div class="list-body" id="list-body"></div></div>';
    attachToolbarHandlers();
    renderListBody();
  }
  function renderListBody() {
    var host = el('list-body');
    if (!host) return;
    if (!state.loaded) return fillSkeleton(host);
    if (state.viewMode === 'kanban' && !mqMobile.matches) return fillKanban(host);
    fillTable(host);
  }
  /* премиум-скелетон таблицы на время загрузки */
  function fillSkeleton(host) {
    var widths = ['w60', 'w80', 'w40', 'w60', 'w80', 'w40', 'w60', 'w80'];
    host.innerHTML = '<div class="sk-list">' + widths.map(function (w) {
      return '<div class="sk-row">' +
        '<span class="shim sk-cell pill"></span>' +
        '<span class="shim sk-cell ' + w + '"></span>' +
        '<span class="shim sk-cell hidem w40"></span>' +
        '<span class="shim sk-cell hidem w60"></span>' +
        '<span class="shim sk-cell hidem w40"></span>' +
        '<span class="shim sk-cell hidem w40"></span></div>';
    }).join('') + '</div>';
  }

  /* Заметка о свернутых пустых заходах. Не прячем их насовсем: менеджеру важно видеть,
     что трафик есть, а строки открывать незачем — поэтому цифра и раскрытие. Стоит НАД
     таблицей: под списком в пятьсот строк ее не увидел бы никто. */
  function blankNote() {
    var n = counts().blank;
    if (!n || state.seg !== 'all') return '';
    var word = plural(n, 'пустой заход', 'пустых захода', 'пустых заходов');
    return '<div class="list-foot">' +
      '<span class="lf-ic">' + ic('funnel', 13) + '</span>' +
      '<span class="lf-t">' + (state.showBlank ? 'Показаны' : 'Свернуто') + ' <b class="num">' + n + '</b> ' + word +
        ' — открыли платформу и ушли, не оставив о себе ничего. Они учтены в разделе «Путь».</span>' +
      '<button class="lf-btn" id="lf-blank">' + (state.showBlank ? 'Свернуть' : 'Показать') + '</button>' +
    '</div>';
  }
  function attachBlankNote(host) {
    var b = host.querySelector('#lf-blank');
    if (b) b.addEventListener('click', function () { state.showBlank = !state.showBlank; renderAll(); });
  }
  function fillTable(host) {
    var arr = segLeads(state.seg);
    if (!arr.length) {
      host.innerHTML = blankNote() + emptyState();
      var lc = el('le-clear');
      if (lc) lc.addEventListener('click', function () { state.q = ''; state.quick = ''; renderView(); });
      attachBlankNote(host);
      return;
    }
    var rows = arr.map(function (l) {
      var tone = l.score != null ? scoreTone(l.score) : null;
      /* почта аккаунта — тоже способ связаться: без нее у зарегистрировавшихся без
         записи на разбор колонка стояла пустой, хотя контакт у нас был */
      var contact = (l.booking || {}).contact || l.email;
      var act = contactAction(contact);
      var profileBits = [l.grade, l.target_year ? 'поступление ' + l.target_year : null, (l.geo || {}).city]
        .filter(Boolean).map(esc);
      var openTasks = (l.crm.tasks || []).filter(function (t) { return !t.done; });
      var overdue = openTasks.some(function (t) { return t.due && t.due < todayISO(0); });
      var risks = leadRisks(l);
      var hot = l.booking && l.crm.status === 'new';
      return '<div class="trow lr-grid' + (hot ? ' r-crit' : '') + '" data-id="' + l.id + '">' +
        '<span class="pill-st" data-stop="1" data-pid="' + l.id + '">' + sevPill(l) + '</span>' +
        '<div class="t-cell"><div class="t-ttl' + (l.name ? '' : ' anon') + '">' +
          (isNewLead(l) ? '<span class="nveo"></span>' : '') + esc(leadName(l)) +
          (risks.length ? '<span class="minib warn" title="' + esc(risks[0].label) + '">' + ic('flame', 9) + '</span>' : '') +
          (openTasks.length ? '<span class="minib' + (overdue ? ' warn' : '') + '">' + ic('task', 10) + openTasks.length + '</span>' : '') +
        '</div>' +
          '<div class="t-sub">' + (profileBits.join(' · ') || FUNNEL[l.status]) + (l.crm.note ? ' · ' + esc(l.crm.note) : '') + '</div></div>' +
        '<div class="score hidem">' + (l.score != null
          ? '<b class="num" style="color:' + tone.c + '">' + l.score + '</b>' +
            '<span class="strack"><i style="width:' + l.score + '%; background:' + tone.c + '"></i></span>'
          : '<span style="color:var(--ink-3)">—</span>') + '</div>' +
        '<div class="t-contact hidem">' + (contact
          ? (act ? '<a href="' + esc(act.href) + '" target="_blank" rel="noopener" data-stop="1">' + esc(contact) + '</a>' : esc(contact))
          : '<span class="none">—</span>') + '</div>' +
        '<div class="t-when num' + (isToday(l.created_at) ? ' today' : '') + '">' + fmtWhen(l.created_at) + '</div>' +
        '<div class="t-go hidem">' + ic('go', 13) + '</div>' +
      '</div>';
    }).join('');

    host.innerHTML = blankNote() +
      '<div class="trow lr-grid thead">' +
        thCell('crm', 'Статус', '') +
        thCell('name', 'Лид', '') +
        thCell('score', 'Балл', ' hidem') +
        '<span class="th hidem">Контакт</span>' +
        thCell('created', 'Пришел', ' r') +
        '<span class="th hidem"></span>' +
      '</div>' + rows;
    attachBlankNote(host);

    Array.prototype.forEach.call(host.querySelectorAll('.th.sortable'), function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-sort');
        var first = { name: 1, score: -1, crm: 1, created: -1 }[col] || -1;
        if (state.sort && state.sort.col === col) {
          state.sort = state.sort.dir === first ? { col: col, dir: -first } : null;
        } else {
          state.sort = { col: col, dir: first };
        }
        renderListBody();
      });
    });
    var ids = arr.map(function (l) { return l.id; });
    Array.prototype.forEach.call(host.querySelectorAll('.trow[data-id]'), function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('[data-stop]')) return;
        openDrawer(tr.getAttribute('data-id'), ids);
      });
      tr.addEventListener('mouseenter', function () { warm(tr.getAttribute('data-id')); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.pill-st'), function (p) {
      p.addEventListener('click', function (e) {
        e.stopPropagation();
        var lead = findLead(p.getAttribute('data-pid'));
        if (lead) openSmenu(lead, p);
      });
    });
    arr.slice(0, 8).forEach(function (l, i) { setTimeout(function () { warm(l.id); }, 200 + i * 160); });
  }

  /* канбан */
  var dragId = null;
  function fillKanban(host) {
    var arr = segLeads(state.seg);
    var base = arr.filter(function (l) { return l.booking || l.crm.status !== 'new'; });
    if (state.seg === 'all') base = arr.filter(function (l) { return !!l.booking; });
    if (!base.length) {
      host.innerHTML = '<div class="list-empty"><span class="le-ic">' + ic('kanban', 22) + '</span>' +
        '<div class="le-t">Канбан пуст</div>' +
        '<div class="le-s">Оживет с первой записью на разбор — карточки появятся в колонках.</div></div>';
      return;
    }
    var ids = base.map(function (l) { return l.id; });
    var cols = Object.keys(CRM).map(function (s) {
      var leads = base.filter(function (l) { return l.crm.status === s; })
        .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      var cards = leads.map(function (l) {
        var tone = l.score != null ? scoreTone(l.score) : null;
        return '<div class="kb-card" draggable="true" data-id="' + l.id + '">' +
          '<div class="kb-name' + (l.name ? '' : ' anon') + '">' + (isNewLead(l) ? '<span class="nveo"></span>' : '') + esc(leadName(l)) + '</div>' +
          '<div class="kb-meta">' +
            (tone ? '<span class="kb-score num" style="color:' + tone.c + '">' + l.score + '</span>' : '') +
            ((l.booking || {}).contact ? '<span>' + esc(l.booking.contact) + '</span>' : '') +
            '<span class="kb-when num">' + ago(l.created_at) + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
      return '<div class="kb-col" data-s="' + s + '">' +
        '<div class="kb-head"><span class="dt" style="width:8px;height:8px;border-radius:50%;background:' + CRM[s].dot + '"></span>' +
        '<span class="kb-title">' + CRM[s].label + '</span><span class="kb-n num">' + leads.length + '</span></div>' +
        '<div class="kb-cards">' + cards + '</div>' +
      '</div>';
    }).join('');
    host.innerHTML = '<div class="kb-wrap">' + cols + '</div>';

    Array.prototype.forEach.call(host.querySelectorAll('.kb-card'), function (cardEl) {
      var id = cardEl.getAttribute('data-id');
      cardEl.addEventListener('click', function () { openDrawer(id, ids); });
      cardEl.addEventListener('mouseenter', function () { warm(id); });
      cardEl.addEventListener('dragstart', function (e) {
        dragId = id; cardEl.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
      });
      cardEl.addEventListener('dragend', function () { dragId = null; cardEl.classList.remove('dragging'); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.kb-col'), function (colEl) {
      colEl.addEventListener('dragover', function (e) { e.preventDefault(); colEl.classList.add('dragover'); });
      colEl.addEventListener('dragleave', function () { colEl.classList.remove('dragover'); });
      colEl.addEventListener('drop', function (e) {
        e.preventDefault(); colEl.classList.remove('dragover');
        var id = dragId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : null);
        var s = colEl.getAttribute('data-s');
        var lead = id && findLead(id);
        if (lead && lead.crm.status !== s) patch(id, { status: s });
      });
    });
  }

  /* ── ПУТЬ ─────────────────────────────────────────────── */
  function renderPath(view) {
    if (!can('clients')) { noClientsStub(view, 'path'); return; }
    var steps = funnelData(state.pathPeriod);
    if (!steps[0].n) {
      view.innerHTML = '<div class="card"><div class="empty">За этот период данных нет.</div></div>';
      return;
    }
    var worst = worstStep(steps);
    var first = steps[0].n;

    var ladder = steps.map(function (s, i) {
      var w = first ? Math.round(s.n / first * 100) : 0;
      var conv = i ? (steps[i - 1].n ? Math.round(s.n / steps[i - 1].n * 100) : 0) : 100;
      var drop = s.dropped.length;
      return '<div class="lad-row' + (worst && worst.i === i ? ' worst' : '') + (state.pathSel === s.key ? ' sel' : '') + '" data-k="' + s.key + '">' +
        '<div class="lad-nm">' + s.label + '<small>' + s.hint + '</small></div>' +
        '<div class="lad-track"><div class="lad-fill" style="width:' + Math.max(w, s.n ? 4 : 0) + '%"></div></div>' +
        '<div class="lad-n num">' + s.n + '</div>' +
        '<div class="lad-right">' +
          '<span class="lad-conv num">' + (i ? conv + '% с шага' : 'все') + '</span>' +
          (i ? '<span class="lad-drop' + (drop ? '' : ' zero') + ' num">' + (drop ? '− ' + drop + ' здесь' : 'без потерь') + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    /* под-воронка анкеты */
    var anketaHtml = '';
    var base = state.leads.filter(function (l) { return inPeriod(l, state.pathPeriod); });
    var withSteps = base.filter(function (l) { return (l.anketa_max_step || 0) > 0 || l.status !== 'visited'; });
    var anyStepData = base.some(function (l) { return (l.anketa_max_step || 0) > 0; });
    if (anyStepData) {
      var stepsN = ANKETA_STEP_NAMES.map(function (name, i) {
        var k = i + 1;
        var n = withSteps.filter(function (l) { return l.status !== 'visited' || (l.anketa_max_step || 0) >= k; }).length;
        return { name: name, n: n };
      });
      var maxA = Math.max(1, stepsN[0].n);
      var minIdx = 0;
      stepsN.forEach(function (s, i) { if (s.n < stepsN[minIdx].n) minIdx = i; });
      anketaHtml = '<div class="card sp5" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('rows', 14) + '</span>' +
        '<div><div class="t">Внутри анкеты</div><div class="s">до какого шага доходят</div></div></div>' +
        '<div class="mini-funnel">' + stepsN.map(function (s, i) {
          return '<div class="fcol"><span class="vn num">' + s.n + '</span>' +
            '<div class="bar' + (i === minIdx && s.n < maxA ? ' on' : '') + '" style="height:' + Math.max(6, Math.round(s.n / maxA * 64)) + 'px"></div>' +
            '<span class="lb">' + s.name + '</span></div>';
        }).join('') + '</div></div>';
    }
    /* нет данных по шагам анкеты — не показываем пустую карточку (иначе дыра рядом с лестницей) */
    var ladderSpan = anyStepData ? 7 : 12;

    /* отвалившиеся на выбранном шаге */
    var dropHtml = '';
    var selStep = state.pathSel && steps.filter(function (s) { return s.key === state.pathSel; })[0];
    if (selStep) {
      var list = selStep.dropped.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      var ids = list.map(function (l) { return l.id; });
      var rows = list.length ? list.slice(0, 40).map(function (l) {
        var contact = (l.booking || {}).contact || l.email;
        return '<div class="trow dl-grid" data-id="' + l.id + '">' +
          '<div class="t-cell"><div class="t-ttl' + (l.name ? '' : ' anon') + '">' + esc(leadName(l)) + '</div>' +
          '<div class="t-sub">' + ([l.grade, l.target_year].filter(Boolean).map(esc).join(' · ') || FUNNEL[l.status]) + '</div></div>' +
          '<div class="t-contact hidem">' + (contact ? esc(contact) : '<span class="none">контакта нет</span>') + '</div>' +
          '<div class="t-when num">' + fmtWhen(l.created_at) + '</div>' +
          '<div class="t-go hidem">' + ic('go', 13) + '</div>' +
        '</div>';
      }).join('') : '<div class="empty">Никто не отвалился на этом шаге — отлично.</div>';
      var withContact = list.filter(function (l) { return (l.booking || {}).contact || l.email; }).length;
      dropHtml = '<div class="card sp12" style="overflow:hidden">' +
        '<div class="sec-head" style="padding:20px 24px 16px">' +
          '<span class="ic" style="background:var(--coral-soft); color:var(--coral)">' + ic('flame', 14) + '</span>' +
          '<div><div class="t">Ушли на шаге «' + esc(selStep.label) + '»</div>' +
          '<div class="s">' + list.length + ' ' + plural(list.length, 'человек', 'человека', 'человек') +
          (withContact ? ' · у ' + withContact + ' есть контакт — можно догнать' : '') + '</div></div></div>' +
        '<div style="border-top:1px solid var(--line)">' + rows + '</div></div>';
    }

    view.innerHTML = '<div class="grid">' +
      '<div class="card sp' + ladderSpan + '" style="overflow:hidden">' +
        '<div class="sec-head" style="padding:20px 24px 16px">' +
          '<span class="ic">' + ic('path', 14) + '</span>' +
          '<div><div class="t">Шаги платформы</div><div class="s">клик по шагу — кто ушел именно здесь</div></div></div>' +
        '<div style="border-top:1px solid var(--line)">' + ladder + '</div>' +
      '</div>' +
      anketaHtml + dropHtml + '</div>';

    Array.prototype.forEach.call(view.querySelectorAll('.lad-row'), function (n) {
      n.addEventListener('click', function () {
        var k = n.getAttribute('data-k');
        state.pathSel = state.pathSel === k ? null : k;
        renderView();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.trow[data-id]'), function (n) {
      var listIds = selStep ? selStep.dropped.map(function (l) { return l.id; }) : [];
      n.addEventListener('click', function () { openDrawer(n.getAttribute('data-id'), listIds); });
      n.addEventListener('mouseenter', function () { warm(n.getAttribute('data-id')); });
    });
    animBars(view);
  }

  function sortMark(col) {
    if (!state.sort || state.sort.col !== col) return '';
    return '<span class="dir' + (state.sort.dir > 0 ? ' up' : '') + '">' +
      '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v11M5.5 10.5L10 15l4.5-4.5"/></svg></span>';
  }
  /* ячейка-заголовок с сортировкой и svg-индикатором */
  function thCell(col, label, extraCls) {
    var act = state.sort && state.sort.col === col;
    return '<span class="th sortable' + (extraCls || '') + (act ? ' act' : '') + '" data-sort="' + col + '" ' +
      'title="Сортировать по: ' + esc(label) + '">' + esc(label) + sortMark(col) + '</span>';
  }
  /* премиум пустое состояние списка */
  function emptyState() {
    if (state.q) {
      return '<div class="list-empty"><span class="le-ic">' + ic('leads', 22) + '</span>' +
        '<div class="le-t">Ничего не нашлось</div>' +
        '<div class="le-s">По запросу «' + esc(state.q) + '» нет совпадений. Проверь написание или сбрось поиск.</div>' +
        '<button class="le-btn" id="le-clear">' + ic('x', 13) + 'Сбросить поиск</button></div>';
    }
    if (state.quick) {
      var ql = (QUICK[state.quick] || {}).label || 'срез';
      return '<div class="list-empty"><span class="le-ic">' + ic('filter', 22) + '</span>' +
        '<div class="le-t">В срезе «' + esc(ql) + '» пусто</div>' +
        '<div class="le-s">Сейчас сюда никто не попадает. Сними срез, чтобы увидеть всех.</div>' +
        '<button class="le-btn" id="le-clear">' + ic('x', 13) + 'Снять срез</button></div>';
    }
    var map = {
      queue: ['Очередь пуста', 'По всем заявкам есть движение — горячих на связь нет.', 'check'],
      clients: ['Клиентов пока нет', 'Будут — как только первая заявка дойдет до оплаты.', 'card'],
      rejected: ['Отказов нет', 'Никто пока не закрыт отказом. Так держать.', 'check'],
      all: ['Лидов пока нет', 'Появятся после первых прохождений диагностики на платформе.', 'leads'],
    };
    var m = map[state.seg] || map.all;
    return '<div class="list-empty"><span class="le-ic">' + ic(m[2], 22) + '</span>' +
      '<div class="le-t">' + m[0] + '</div><div class="le-s">' + m[1] + '</div></div>';
  }

  /* ── ФИНАНСЫ ────────────────────────────────────────────── */
  var MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function finMoney(n) { return fmtMoney(n); }
  function ymLabel(ym) { var m = parseInt(String(ym).slice(5, 7), 10) - 1; return MONTHS_RU[m] || ym; }
  function indexBy(ids) { var m = {}; (ids || []).forEach(function (id) { m[id] = true; }); return m; }
  function finPeriodFrom() {
    if (state.finPeriod === 'month') { var d = new Date(); d.setDate(d.getDate() - 29); d.setHours(0, 0, 0, 0); return d; }
    if (state.finPeriod === 'year') { var y = new Date(); y.setMonth(y.getMonth() - 11, 1); y.setHours(0, 0, 0, 0); return y; }
    return null;
  }
  function payConvLocal(payingIds) {
    var booked = 0, paying = 0;
    state.leads.forEach(function (l) {
      if (l.booking) booked++;
      var pays = payingIds ? payingIds[l.id] : (!!l.paid);
      if (pays) paying++;
    });
    return { booked: booked, paying: paying, pct: booked ? Math.round(paying / booked * 100) : 0 };
  }
  /* нормализация агрегата из деталей (клиентский fallback) */
  function aggregatePayments(items) {
    var from = finPeriodFrom();
    var paid = 0, pending = 0, refunded = 0, paidCount = 0;
    var byMonth = {}, byProduct = {}, byClient = {};
    items.forEach(function (it) {
      (it.payments || []).forEach(function (p) {
        var when = p.paid_at || p.created_at;
        if (from && when && new Date(when) < from) return;
        var amt = p.amount_rub || 0;
        if (p.status === 'paid') {
          paid += amt; paidCount++;
          var ym = (p.paid_at || p.created_at || '').slice(0, 7);
          if (ym) byMonth[ym] = (byMonth[ym] || 0) + amt;
          var key = (p.title || 'Без названия').trim();
          if (!byProduct[key]) byProduct[key] = { title: key, amount: 0, count: 0 };
          byProduct[key].amount += amt; byProduct[key].count++;
          if (!byClient[it.lead_id]) byClient[it.lead_id] = { lead_id: it.lead_id, name: it.name || 'Без имени', amount: 0, count: 0 };
          byClient[it.lead_id].amount += amt; byClient[it.lead_id].count++;
        } else if (p.status === 'refunded') { refunded += amt; }
        else { pending += amt; }
      });
    });
    var months = Object.keys(byMonth).sort().map(function (ym) { return { ym: ym, label: ymLabel(ym), amount: byMonth[ym] }; });
    var products = Object.keys(byProduct).map(function (k) { return byProduct[k]; }).sort(function (a, b) { return b.amount - a.amount; });
    var clients = Object.keys(byClient).map(function (k) { return byClient[k]; }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, 8);
    return {
      paid_total: paid, pending_total: pending, refunded_total: refunded,
      paid_count: paidCount, avg_check: paidCount ? Math.round(paid / paidCount) : 0,
      by_status: [
        { key: 'paid', label: 'Оплачено', amount: paid },
        { key: 'pending', label: 'Ожидается', amount: pending },
        { key: 'refunded', label: 'Возвраты', amount: refunded },
      ],
      by_month: months, by_product: products, top_clients: clients,
    };
  }
  function fetchFinance(force, cb) {
    if (state.finLoading) { return; }  // уже грузится — не дёргаем cb (иначе рекурсия renderView→renderFinance)
    if (!force && state.finance && state.finance.period === state.finPeriod) { if (cb) cb(); return; }
    state.finLoading = true;
    var qp = state.finPeriod ? ('?period=' + encodeURIComponent(state.finPeriod)) : '';
    api('/admin/api/finance' + qp).then(function (r) {
      var T = r.totals || r;  // бэк отдаёт nested {totals}, нормализуем в плоское
      var bm = (r.by_month || []).map(function (m) {
        return { ym: m.ym || m.month, label: m.label || ymLabel(m.ym || m.month || ''), amount: m.amount != null ? m.amount : (m.sum_rub || 0) };
      });
      var bp = (r.by_product || []).map(function (x) {
        return { title: x.title || x.name, amount: x.amount != null ? x.amount : (x.sum_rub || 0), count: x.count || 0 };
      });
      var tc = (r.top_clients || []).map(function (x) {
        return { lead_id: x.lead_id || x.session_id, name: x.name, amount: x.amount != null ? x.amount : (x.sum_rub || 0), count: x.count || 0 };
      });
      var paidTotal = T.paid != null ? T.paid : (r.paid_total || 0);
      var paidCount = T.count_paid != null ? T.count_paid : (r.paid_count || 0);
      var fin = {
        source: 'api', period: state.finPeriod,
        paid_total: paidTotal,
        pending_total: T.pending != null ? T.pending : (r.pending_total || 0),
        refunded_total: T.refunded != null ? T.refunded : (r.refunded_total || 0),
        paid_count: paidCount,
        avg_check: T.avg_check_rub != null ? T.avg_check_rub : (r.avg_check || (paidCount ? Math.round(paidTotal / paidCount) : 0)),
        by_status: [
          { key: 'paid', label: 'Оплачено', amount: T.paid != null ? T.paid : (r.paid_total || 0) },
          { key: 'pending', label: 'Ожидается', amount: T.pending != null ? T.pending : (r.pending_total || 0) },
          { key: 'refunded', label: 'Возвраты', amount: T.refunded != null ? T.refunded : (r.refunded_total || 0) },
        ],
        by_month: bm, by_product: bp, top_clients: tc,
        pay_conv: payConvLocal(r.paying_lead_ids ? indexBy(r.paying_lead_ids) : null),
      };
      state.finance = fin; state.finLoading = false;
      if (cb) cb();
    }).catch(function (e) {
      if (e.message === '403') { state.finLoading = false; return; }
      fetchFinanceLocal(function () { state.finLoading = false; if (cb) cb(); });
    });
  }
  /* fallback: тянем детали лидов-клиентов, агрегируем платежи на клиенте */
  function fetchFinanceLocal(done) {
    var cand = state.leads.filter(function (l) { return !!l.paid; });
    var pending = cand.length;
    var items = [];
    function finish() {
      var agg = aggregatePayments(items);
      agg.source = 'local'; agg.period = state.finPeriod;
      agg.pay_conv = payConvLocal(null);
      state.finance = agg;
      if (done) done();
    }
    if (!pending) { finish(); return; }
    cand.forEach(function (l) {
      fetchDetail(l.id, function (d) {
        if (d && d.payments && d.payments.length) {
          items.push({ lead_id: l.id, name: l.name || (d && d.name) || 'Без имени', payments: d.payments });
        }
        if (--pending === 0) finish();
      });
    });
  }

  function renderFinance(view) {
    var f = state.finance;
    if (!f) {
      view.innerHTML = dashSkeleton();
      fetchFinance(false, function () { if (state.page === 'finance') { renderHead(); renderView(); } });
      return;
    }
    var banner = f.source === 'local'
      ? '<div class="fin-banner">' + ic('spark', 14) + '<span>Оценка по клиентам — точные цифры по всем платежам появятся с обновлением бэка.</span></div>'
      : '';

    var bar = statBar([
      { tint: 'green', label: 'Выручка (оплачено)', value: fmtMoney(f.paid_total) + ' ₽',
        sub: f.paid_count + ' ' + plural(f.paid_count, 'платеж', 'платежа', 'платежей') },
      { tint: 'amber', label: 'Ожидается', value: fmtMoney(f.pending_total) + ' ₽',
        sub: f.pending_total ? 'выставлено, не оплачено' : 'всё оплачено' },
      { tint: (f.refunded_total ? 'red' : ''), label: 'Возвраты', value: fmtMoney(f.refunded_total) + ' ₽',
        sub: f.refunded_total ? 'вернули клиентам' : 'возвратов нет' },
      { tint: 'blue', label: 'Средний чек', value: fmtMoney(f.avg_check) + ' ₽',
        sub: f.pay_conv && f.pay_conv.booked ? f.pay_conv.pct + '% заявок платят' : '' },
    ]);

    var totalAll = Math.max(1, f.paid_total + f.pending_total + f.refunded_total);
    var stColor = { paid: '#18A957', pending: '#E0922F', refunded: '#E5484D' };
    var stack = '<div class="fin-stack">' + f.by_status.map(function (s) {
      var w = Math.round(s.amount / totalAll * 100);
      return s.amount ? '<i class="' + s.key + '" style="width:' + w + '%"></i>' : '';
    }).join('') + '</div>';
    var leg = '<div class="fin-leg">' + f.by_status.map(function (s) {
      return '<div class="r"><span class="dd2" style="background:' + stColor[s.key] + '"></span>' +
        '<span class="nm">' + esc(s.label) + '</span>' +
        '<span class="am' + (s.amount ? '' : ' muted') + '">' + fmtMoney(s.amount) + ' ₽</span></div>';
    }).join('') + '</div>';
    var statusCard = '<div class="card sp5" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('wallet', 14) + '</span>' +
      '<div><div class="t">Деньги по статусам</div><div class="s">сколько получено, ждем и вернули</div></div></div>' +
      stack + leg + '</div>';

    var monthsCard;
    if (f.by_month.length) {
      var maxM = Math.max.apply(null, f.by_month.map(function (m) { return m.amount; })) || 1;
      var peakI = 0; f.by_month.forEach(function (m, i) { if (m.amount > f.by_month[peakI].amount) peakI = i; });
      var bars = '<div class="fin-months">' + f.by_month.map(function (m, i) {
        var h = Math.max(3, Math.round(m.amount / maxM * 100));
        return '<div class="fin-mcol" title="' + esc(m.label) + ': ' + fmtMoney(m.amount) + ' ₽">' +
          '<div class="bar' + (i === peakI ? ' peak' : '') + '" style="height:' + h + '%"></div></div>';
      }).join('') + '</div>' +
      '<div class="fin-mlabels">' + f.by_month.map(function (m) { return '<span>' + esc(m.label) + '</span>'; }).join('') + '</div>';
      monthsCard = '<div class="card sp7" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('chart', 14) + '</span>' +
        '<div><div class="t">Динамика выручки</div><div class="s">оплаченное по месяцам</div></div>' +
        '<span class="cnt num">' + fmtMoney(f.paid_total) + ' ₽</span></div>' + bars + '</div>';
    } else {
      monthsCard = '<div class="card sp7" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('chart', 14) + '</span>' +
        '<div><div class="t">Динамика выручки</div><div class="s">оплаченное по месяцам</div></div></div>' +
        '<div class="empty">Оплат за период пока нет — график наполнится с первыми платежами.</div></div>';
    }

    var prodCard = finDonut(f.by_product);

    var clientsCard;
    if (f.top_clients.length) {
      var maxC = f.top_clients[0].amount || 1;
      var rows = f.top_clients.map(function (cl) {
        var w = Math.max(5, Math.round(cl.amount / maxC * 100));
        return '<div class="fin-client" data-id="' + esc(cl.lead_id) + '">' +
          '<div class="fc-l"><div class="fc-nm">' + esc(cl.name) + '</div>' +
            '<div class="fc-track"><i style="width:' + w + '%"></i></div></div>' +
          '<div class="fc-am"><div class="fc-sum num">' + fmtMoney(cl.amount) + ' ₽</div>' +
            '<div class="fc-cnt num">' + cl.count + ' ' + plural(cl.count, 'платеж', 'платежа', 'платежей') + '</div></div>' +
          '</div>';
      }).join('');
      clientsCard = '<div class="card sp5" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('leads', 14) + '</span>' +
        '<div><div class="t">Топ-клиенты</div><div class="s">кто принес больше всего</div></div></div>' +
        '<div style="margin-top:6px">' + rows + '</div></div>';
    } else {
      clientsCard = '<div class="card sp5" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('leads', 14) + '</span>' +
        '<div><div class="t">Топ-клиенты</div><div class="s">кто принес больше всего</div></div></div>' +
        '<div class="empty">Платящих клиентов пока нет.</div></div>';
    }

    view.innerHTML = '<div class="dash">' + banner + bar +
      '<div class="grid">' + statusCard + monthsCard + prodCard + clientsCard + '</div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('.fin-client[data-id]'), function (n) {
      n.addEventListener('click', function () { openDrawer(n.getAttribute('data-id'), [n.getAttribute('data-id')]); });
      n.addEventListener('mouseenter', function () { warm(n.getAttribute('data-id')); });
    });
  }
  /* донат по продуктам (на базе DONUT_COLORS, но по суммам) */
  function finDonut(products) {
    if (!products || !products.length) {
      return '<div class="card sp7" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('pie', 14) + '</span>' +
        '<div><div class="t">Выручка по услугам</div><div class="s">за что платят</div></div></div>' +
        '<div class="empty">Платежей пока нет.</div></div>';
    }
    var parts = products.slice(0, 4).map(function (p) { return { label: p.title, n: p.amount }; });
    var rest = products.slice(4).reduce(function (s, p) { return s + p.amount; }, 0);
    if (rest) parts.push({ label: 'Другое', n: rest });
    var total = parts.reduce(function (s, p) { return s + p.n; }, 0) || 1;
    var acc = 0;
    var grad = parts.map(function (p, i) {
      var from = acc / total * 100; acc += p.n; var to = acc / total * 100;
      return DONUT_COLORS[i] + ' ' + from + '% ' + to + '%';
    }).join(', ');
    var legend = parts.map(function (p, i) {
      return '<div class="r"><span class="dd2" style="background:' + DONUT_COLORS[i] + '"></span>' +
        '<span class="dnm">' + esc(p.label) + '</span>' +
        '<span class="dcount num">' + fmtMoney(p.n) + ' ₽</span>' +
        '<span class="dpc num">' + Math.round(p.n / total * 100) + '%</span></div>';
    }).join('');
    return '<div class="card sp7" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('pie', 14) + '</span>' +
      '<div><div class="t">Выручка по услугам</div><div class="s">за что платят — доля каждой услуги</div></div></div>' +
      '<div class="distr-body"><div class="dwrap"><div class="dpie" style="background:conic-gradient(' + grad + ')"></div>' +
      '<div class="dctr"><div><div class="dn num" style="font-size:20px">' + fmtMoney(total) + '</div><div class="ds">₽ всего</div></div></div></div>' +
      '<div class="dleg">' + legend + '</div></div></div>';
  }

  /* ════ ОМНИКАНАЛЬНЫЙ БОТ — диалоги + аналитика ════ */
  /* Реальные диалоги из eastside-bot через /admin/api/bot/*; бот не настроен → демо на лидах. */
  var CHANNELS = {
    telegram: { label: 'Telegram',  icon: 'send', c: '#2AABEE' },
    whatsapp: { label: 'WhatsApp',  icon: 'wa',   c: '#25D366' },
    vk:       { label: 'VK',        icon: 'vk',   c: '#0077FF' },
    max:      { label: 'Макс',      icon: 'max',  c: '#7B61FF' },
    site:     { label: 'Сайт',      icon: 'ext',  c: '#2F6BFF' },
    platform: { label: 'Платформа', icon: 'bolt', c: '#1C2B4A' },
  };
  var CHAN_ORDER = ['telegram', 'whatsapp', 'vk', 'max', 'site', 'platform'];
  function hashId(id) { var h = 0, sx = String(id); for (var i = 0; i < sx.length; i++) h = (h * 31 + sx.charCodeAt(i)) | 0; return Math.abs(h); }
  function botChannel(l) {
    var c = ((l.booking || {}).channel || '').toString().toLowerCase();
    if (CHANNELS[c]) return c;
    return CHAN_ORDER[hashId(l.id) % CHAN_ORDER.length];
  }
  /* демо-переписка (пока бот не подключён) */
  function mockDialog(l) {
    var ch = botChannel(l);
    var nm = leadName(l);
    var dir = Array.isArray(l.directions) ? l.directions[0] : (l.directions || 'поступление в Китай');
    var t0 = new Date(l.created_at || Date.now()).getTime();
    var at = function (m) { return new Date(t0 + m * 60000).toISOString(); };
    var msgs = [];
    msgs.push({ from: 'bot', text: 'Здравствуйте! Это EastSide — помогаем поступить в вузы Китая. Вы для себя или для ребёнка?', at: at(0) });
    msgs.push({ from: 'client', text: nm !== 'Без имени' ? 'Для ребёнка' : 'Для себя', at: at(2) });
    msgs.push({ from: 'bot', text: 'Понял! Какое направление интересно' + (l.grade ? ' и в каком классе сейчас?' : '?'), at: at(2) });
    msgs.push({ from: 'client', text: String(dir) + (l.grade ? ', ' + l.grade : ''), at: at(5) });
    msgs.push({ from: 'bot', text: 'Отлично. Предлагаю бесплатную AI-диагностику — за 5 минут покажет шансы и подберёт вузы. Запускаем?', at: at(6) });
    if (l.status !== 'visited') msgs.push({ from: 'client', text: 'Давайте', at: at(8) });
    if (l.booking) {
      msgs.push({ from: 'bot', text: 'Диагностика готова! Записал вас на разбор' + (l.booking.slot ? ' — ' + l.booking.slot : '') + '. Подтверждаете?', at: at(20) });
      msgs.push({ from: 'client', text: 'Да, подтверждаю', at: at(22) });
    }
    var handed = ['call_scheduled', 'call_done', 'offer_sent', 'client'].indexOf(l.crm.status) !== -1;
    if (handed) msgs.push({ from: 'manager', text: 'Здравствуйте! На связи менеджер EastSide — давайте обсудим разбор.', at: at(30) });
    var handoff = !handed && hashId(l.id) % 6 === 0;
    if (handoff) msgs.push({ from: 'client', text: 'А можно поговорить с менеджером?', at: at(35) });
    var botN = msgs.filter(function (m) { return m.from === 'bot'; }).length;
    var tokens = botN * 620 + hashId(l.id) % 400;
    return { channel: ch, ai_on: !handed, handed: handed, handoff_req: handoff, messages: msgs, msgs: msgs.length,
             tokens: tokens, cost_rub: Math.max(2, Math.round(tokens / 900)), last: msgs[msgs.length - 1] };
  }
  function getDialog(l) {
    if (!state.dialogs[l.id]) state.dialogs[l.id] = mockDialog(l);
    var dlg = state.dialogs[l.id];
    if (state.dialogAi[l.id] != null) dlg.ai_on = state.dialogAi[l.id];
    return dlg;
  }
  function chBadge(ch) {
    var c = CHANNELS[ch] || CHANNELS.site;
    return '<span class="ch-badge" style="--c:' + c.c + '">' + ic(c.icon, 12) + c.label + '</span>';
  }
  function chMeta(ch) { return CHANNELS[ch] || CHANNELS.site; }

  /* сколько диалогов «просят менеджера» — для бейджа в меню (api или демо) */
  function botHandoffCount() {
    if (state.bot.source === 'api' && state.bot.list) {
      return state.bot.list.filter(function (c) { return c.handoff_requested; }).length;
    }
    return 0;
  }
  /* сколько всего ждет ответа в «Диалогах» — обе вкладки вместе (бейдж в наве) */
  function inboxAttention() {
    return botHandoffCount() + (can('clients') ? threadsAttention() : 0);
  }
  /* фоновое обновление диалогов бота (поллинг) — чтобы хэндофф всплывал сам */
  function refreshBot(cb) {
    api('/admin/api/bot/conversations').then(function (r) {
      state.bot = { source: 'api', loaded: true, list: r.conversations || [], msgs: state.bot.msgs || {} };
      if (cb) cb();
    }).catch(function () {
      state.bot = { source: 'none', loaded: true, list: [], msgs: state.bot.msgs || {} };
      if (cb) cb();
    });
  }
  /* ── КОМПОЗЕР ИНБОКСА ─────────────────────────────────────────────────────────
     Менеджер печатает, а инбокс в это время живёт своей жизнью: каждые 6с приходит
     поллинг, клиент присылает реплику, тумблер бота перерисовывает шапку. Любая из этих
     перерисовок пересобирала поле ввода — набранный текст исчезал на полуслове, и
     сообщения уходили клиенту обрывками («Добрый день» отдельно, остальное заново).
     Поэтому черновик живёт в state (свой на каждый диалог), а не в DOM: перерисовка
     восстанавливает и текст, и каретку, и фокус. Переключение диалогов черновики хранит. */
  function composerSave() {
    if (state._composerRendering) return;   // идёт перерисовка — читать новое пустое поле нельзя
    var inp = el('tg-input'); if (!inp) return;
    // диалог берём с самого поля, а не из state.inboxSel: при переключении чата выбор
    // меняется РАНЬШЕ перерисовки, и черновик уехал бы в чужую переписку
    var cid = inp.getAttribute('data-conv'); if (!cid) return;
    state.drafts[cid] = inp.value;
    state.composer = { id: cid, focus: document.activeElement === inp, caret: inp.selectionStart };
  }
  function composerGrow(inp) {   // высота по содержимому: одна строка → до пяти, дальше скролл
    if (!inp) return;
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 128) + 'px';
  }
  function composerRestore(convId) {
    var inp = el('tg-input'); if (!inp) return;
    inp.value = state.drafts[convId] || '';
    composerGrow(inp);
    var c = state.composer || {};
    if (c.focus && String(c.id) === String(convId)) {
      inp.focus();
      var p = c.caret == null ? inp.value.length : Math.min(c.caret, inp.value.length);
      try { inp.setSelectionRange(p, p); } catch (e) {}
    }
  }
  /* менеджер сейчас в поле ввода или у него набран текст — полную пересборку инбокса откладываем */
  function composerBusy() {
    var inp = el('tg-input');
    return !!(inp && (inp.value || document.activeElement === inp));
  }
  /* Только что отправленные менеджером сообщения бэк ещё не отдаёт (он пишет их в историю
     после доставки). Переносим их в свежий ответ, пока не увидим там свой же текст, —
     иначе пузырь мигает: появился, исчез на следующем поллинге, появился снова. */
  function mergeLocalMsgs(old, fresh) {
    var msgs = (fresh && fresh.messages) || [];
    var locals = ((old && old.messages) || []).filter(function (m) { return m._local; });
    if (!locals.length) return msgs;
    var used = {};
    var pending = locals.filter(function (lm) {
      for (var i = msgs.length - 1; i >= 0; i--) {
        if (used[i] || msgs[i].sender !== 'manager' || msgs[i].text !== lm.text) continue;
        used[i] = 1; return false;   // бэк это сообщение уже знает — локальный дубль убираем
      }
      return true;
    });
    return msgs.concat(pending);
  }

  /* РЕАЛТАЙМ: тихий фоновый опрос открытого инбокса — список + сообщения текущего чата.
     Перерисовываем только если что-то реально изменилось (без мельканий/скелетона). */
  function pollInboxLive() {
    api('/admin/api/bot/conversations').then(function (r) {
      var fresh = r.conversations || [];
      // список: обновляем данные и сортировку; перерисовываем только если состав/порядок/последнее сообщение изменились
      var prev = state.bot.list || [];
      var changed = fresh.length !== prev.length;
      if (!changed) {
        for (var i = 0; i < fresh.length; i++) {
          if (String(fresh[i].user_id) !== String((prev[i]||{}).user_id) ||
              (fresh[i].last_text || '') !== ((prev[i]||{}).last_text || '') ||
              !!fresh[i].unread !== !!(prev[i]||{}).unread ||
              !!fresh[i].handoff_requested !== !!(prev[i]||{}).handoff_requested ||
              (fresh[i].ai_enabled) !== ((prev[i]||{}).ai_enabled)) { changed = true; break; }
        }
      }
      state.bot.list = fresh;
      // НЕ затираем свежий тумблер бэкенд-данными, пока бэк не подтвердит наше значение:
      // иначе реалтайм-полл откатывает переключение, пока POST ещё в пути — выглядит как
      // «тумблер не работает». Держим до совпадения (а не фиксированные 5с: ответ бывает
      // и медленнее), но не дольше 30с — чтобы залипшее значение не врало вечно.
      var now = Date.now();
      (fresh || []).forEach(function (c) {
        var p = (state._aiToggle || {})[c.user_id];
        if (!p) return;
        if (c.ai_enabled === p.val || now - p.at > 30000) { delete state._aiToggle[c.user_id]; return; }
        c.ai_enabled = p.val; c.taken_by = p.val ? null : c.taken_by;
      });
      // сообщения открытого чата — тянем только если чат выбран и уже загружен (без скелетона)
      var sel = state.inboxSel;
      if (sel && state.bot.msgs[sel]) {
        api('/admin/api/bot/conversations/' + sel + '/messages').then(function (d) {
          var old = state.bot.msgs[sel];
          var oldN = (old && old.messages) ? old.messages.length : -1;
          // сохраняем актуальные флаги (могли поменяться тумблером) + новые сообщения
          d.messages = mergeLocalMsgs(old, d);
          var newN = d.messages.length;
          state.bot.msgs[sel] = d;
          if (newN !== oldN) { refreshOpenThread(true); }       // появились новые — дорисуем, докрутим вниз
          else if (changed) { refreshOpenThread(false); }
        }).catch(function () {});
      } else if (changed && !composerBusy()) {
        // полную пересборку делаем только когда менеджер не в поле ввода — иначе она
        // вырвала бы поле из-под рук (черновик переживёт, но каретка и скролл дёрнутся)
        renderSide();
        var host = el('tg-rows');
        if (host && state.bot.loaded) { renderInbox(el('view')); }
      }
      renderSide();
    }).catch(function () {});
  }
  /* точечно перерисовать ТОЛЬКО тред открытого чата (без композера/шапки — не сбрасывает ввод);
     докрутить скролл, если пользователь был внизу. */
  function refreshOpenThread(scrollDown) {
    if (state.page !== 'inbox' || !state.inboxSel) return;
    var th = el('tg-thread'); if (!th) return;
    var wasNearBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 120;
    var list = inboxConvos();
    var c = list.filter(function (x) { return String(x.id) === String(state.inboxSel); })[0];
    if (!c) return;
    th.innerHTML = buildThread(convoMessages(c));
    // перепривязываем удаление сообщений
    Array.prototype.forEach.call(th.querySelectorAll('.tg-del[data-del]'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var mid = b.getAttribute('data-del');
        var d = state.bot.msgs[c.id];
        if (d && d.messages) d.messages = d.messages.filter(function (m) { return String(m.id) !== String(mid); });
        apiSend('/admin/api/bot/conversations/' + c.id + '/messages/' + mid, 'DELETE', null, function () {});
        refreshOpenThread(false);
      });
    });
    if (scrollDown && wasNearBottom) th.scrollTop = th.scrollHeight;
  }

  /* загрузка реальных диалогов из бота (без мока — реально или пусто) */
  function loadBotData(cb) {
    if (state.bot.loaded) { if (cb) cb(); return; }
    refreshBot(cb);
  }

  /* список диалогов для инбокса — только реальные из бота */
  function inboxConvos() {
    if (state.bot.source !== 'api') return [];
    return (state.bot.list || []).map(function (c) {
      return { id: c.user_id, api: true, channel: c.channel, name: c.name, anon: !c.username,
        last_text: (c.last_text || '').replace(/<[^>]+>/g, ''), last_role: c.last_role, last_at: c.last_at,
        unread: c.unread, ai_on: c.ai_enabled, handoff: c.handoff_requested, taken_by: c.taken_by, msgs: c.msgs };
    });
  }

  /* нормализуем сообщения диалога в {who, text, at} */
  function convoMessages(c) {
    if (c.api) {
      var d = state.bot.msgs[c.id];
      if (!d) return null; // ещё не загружены
      return (d.messages || []).map(function (m) {
        var who = m.role === 'user' ? 'client' : (m.sender === 'manager' ? 'manager' : 'bot');
        return { who: who, text: m.text, at: m.at, id: m.id, undelivered: m.undelivered, reason: m.reason };
      });
    }
    var dlg = getDialog(c.lead);
    return dlg.messages.map(function (m) { return { who: m.from, text: m.text, at: m.at }; });
  }
  /* HTML треда по массиву сообщений (или скелетон, если msgs === null). Вынесено, чтобы
     реалтайм-опрос мог обновить ТОЛЬКО тред, не трогая композер (не сбрасывая ввод). */
  function buildThread(msgs) {
    if (msgs === null) {
      return '<div class="tg-sk">' +
        '<span class="shim tg-skb in" style="width:58%"></span>' +
        '<span class="shim tg-skb in" style="width:40%"></span>' +
        '<span class="shim tg-skb out" style="width:52%"></span>' +
        '<span class="shim tg-skb in" style="width:66%"></span>' +
        '<span class="shim tg-skb out" style="width:44%"></span>' +
        '<span class="shim tg-skb in" style="width:36%"></span>' +
      '</div>';
    }
    var lastDay = null;
    return msgs.map(function (m) {
      var side = m.who === 'client' ? 'in' : 'out';
      var by = m.who === 'bot' ? 'AI' : (m.who === 'manager' ? 'Менеджер' : '');
      var sep = '';
      var dk = m.at ? String(m.at).slice(0, 10) : '';
      if (dk && dk !== lastDay) { lastDay = dk; sep = '<div class="tg-day"><span>' + dayLabel(m.at) + '</span></div>'; }
      var foot = m.undelivered
        ? '<span class="tg-by warn" title="' + esc(m.reason || '') + '">' + ic('alert', 9) + 'не доставлено клиенту</span>'
        : (by ? '<span class="tg-by">' + (m.who === 'bot' ? ic('bot', 9) : ic('hand', 9)) + by + '</span>' : '');
      return sep + '<div class="tg-msg ' + side + (m.who === 'manager' ? ' mgr' : m.who === 'bot' ? ' ai' : '') + (m.undelivered ? ' undelivered' : '') + '">' +
        '<div class="tg-bub">' + mdMsg(m.text) + '<span class="tg-mt num">' + fmtTime(m.at) + '</span>' +
          (m.id ? '<button class="tg-del" data-del="' + m.id + '" title="Удалить сообщение">' + ic('x', 11) + '</button>' : '') +
        '</div>' + foot + '</div>';
    }).join('');
  }
  /* единый бейдж статуса диалога (список + точечное обновление при тумблере) */
  function inboxTag(c) {
    return c.handoff ? '<span class="tg-tag wait">' + ic('hand', 10) + 'просит менеджера</span>'
      : (c.ai_on === false) ? '<span class="tg-tag mgr">' + ic('hand', 10) + (c.taken_by ? esc(c.taken_by) : 'ведёт менеджер') + '</span>'
      : '<span class="tg-tag ai">' + ic('bot', 10) + 'AI</span>';
  }
  /* Когда бот сам подхватит диалог. Правило на стороне бота: AI_RESUME_AFTER_H часов тишины —
     не писал НИКТО, ни клиент, ни менеджер (app/handoff.py). Показываем точное время, а не
     «через 20 минут»: подсказка живёт до следующей перерисовки и обратный отсчёт протух бы. */
  var AI_RESUME_H = 2;
  function aiResumeAt(c) {
    var t = c && c.last_at ? Date.parse(c.last_at) : NaN;
    return t ? new Date(t + AI_RESUME_H * 3600000) : null;
  }
  function resumeNote(c) {
    var at = aiResumeAt(c);
    if (!at) return '.';
    return at - Date.now() > 0
      ? '; сам он подхватит в ' + fmtTime(at.toISOString()) + ', если до тех пор никто не напишет.'
      : '; тишина уже больше ' + AI_RESUME_H + ' часов — следующее сообщение бот возьмёт на себя.';
  }

  /* Тумблер обязан показывать РЕАЛЬНОЕ положение дел: по нему менеджер решает, писать ему
     самому или бот справится. Поэтому переключение оптимистичное, но не «на веру» — если
     запрос не прошёл, откатываем в исходное состояние и говорим об этом вслух. */
  function inboxSetAi(c, on) {
    if (c.api) {
      var was = { ai: c.ai_on !== false, ho: c.handoff, by: c.taken_by };
      // вкл → бот снова сам отвечает, снимаем «ведёт менеджер»; выкл → диалог за менеджером
      function put(ai, ho, by) {
        function apply(o) { if (!o) return; o.ai_enabled = ai; o.handoff_requested = ho; o.taken_by = by; }
        apply(state.bot.msgs[c.id]);
        apply((state.bot.list || []).filter(function (x) { return String(x.user_id) === String(c.id); })[0]);
        c.ai_on = ai; c.handoff = ho; c.taken_by = by;
        // точечно: перерисовываем только чат + бейдж строки, без пересборки списка (без дёрганья)
        if (state.page === 'inbox') {
          renderInboxChat([c]);
          var r3 = document.querySelector('.tg-row[data-id="' + c.id + '"] .tg-r3');
          if (r3) r3.innerHTML = inboxTag(c);
        }
        renderSide();
      }
      state._aiToggle = state._aiToggle || {};
      state._aiToggle[c.id] = { val: on, at: Date.now() };
      put(on, on ? false : was.ho, on ? null : state.userName);
      api('/admin/api/bot/conversations/' + c.id + '/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: on }),
      }).then(function () {
        showToast(on ? 'Бот снова отвечает сам' : 'Бот выключен — диалог ведёшь ты');
      }).catch(function (e) {
        delete state._aiToggle[c.id];
        put(was.ai, was.ho, was.by);
        // 403 — сессия истекла, api() уже увёл на экран входа: тост поверх него лишний
        if (!e || e.message !== '403') {
          showToast('Не переключилось — бот остался ' + (on ? 'выключенным' : 'включенным'));
        }
      });
    } else {
      state.dialogAi[c.id] = on; var dl = getDialog(c.lead); if (on) dl.handoff_req = false; else dl.handed = false;
      renderView(); renderSide();
      showToast(on ? 'Бот снова отвечает сам' : 'Бот выключен — диалог ведёшь ты');
    }
  }
  function inboxMarkSeen(c) {
    if (c.api) apiSend('/admin/api/bot/conversations/' + c.id + '/seen', 'POST', null, function () {});
    else state.dialogSeen[c.id] = 1;
  }

  /* отправить сообщение менеджером (демо — локально; реал — POST).
     Перерисовываем ТОЛЬКО тред: менеджер часто шлёт очередь коротких сообщений подряд,
     и полная пересборка вью между ними стирала бы то, что он уже набирает дальше. */
  function inboxSend(c, text) {
    text = (text || '').trim(); if (!text) return;
    var nowISO = new Date().toISOString();
    if (c.api) {
      var d = state.bot.msgs[c.id];
      var tmp = { role: 'assistant', sender: 'manager', text: text, at: nowISO, _local: true };
      if (d) d.messages = (d.messages || []).concat([tmp]);
      // строка в списке слева тоже должна сразу показать новое последнее сообщение
      var row = (state.bot.list || []).filter(function (x) { return String(x.user_id) === String(c.id); })[0];
      if (row) { row.last_text = text; row.last_role = 'assistant'; row.last_at = nowISO; row.unread = false; }
      if (c.ai_on !== false) inboxSetAi(c, false);   // менеджер перехватил диалог у бота
      refreshOpenThread(true);
      // реальная доставка. Бэк отвечает {delivered, reason}: не ушло клиенту — помечаем пузырь
      // (не удаляем — менеджер видит свой текст и причину), сетевой сбой — откатываем.
      api('/admin/api/bot/conversations/' + c.id + '/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }),
      }).then(function (res) {
        if (res && res.delivered === false) {
          tmp.undelivered = true; tmp.reason = res.reason || '';
          showToast(res.reason ? ('Не доставлено клиенту: ' + res.reason) : 'Сообщение не доставлено клиенту');
          refreshOpenThread(false);
        }
      }).catch(function () {
        var dd = state.bot.msgs[c.id];
        if (dd && dd.messages) dd.messages = dd.messages.filter(function (m) { return m !== tmp; });
        showToast('Сообщение не отправлено — проверь связь с ботом');
        refreshOpenThread(false);
      });
    } else {
      var dlg = getDialog(c.lead);
      dlg.messages.push({ from: 'manager', text: text, at: nowISO });
      dlg.last = dlg.messages[dlg.messages.length - 1]; dlg.msgs = dlg.messages.length;
      if (dlg.ai_on) { state.dialogAi[c.id] = false; }
      renderView();
    }
  }

  /* тумблер поверхностей инбокса: переписки бота ↔ обсуждения по задачам */
  function inboxSwitch() {
    if (!can('clients')) return '';   // нет доступа к клиентам → обсуждений нет, тумблер не нужен
    var ho = botHandoffCount(), ta = threadsAttention();
    function seg(mode, label, n) {
      return '<button class="ibsw-b' + (state.inboxMode === mode ? ' on' : '') + '" data-m="' + mode + '">' +
        '<span>' + label + '</span>' + (n ? '<span class="ibsw-n num">' + n + '</span>' : '') + '</button>';
    }
    return '<div class="ibsw">' + seg('bot', 'Диалоги', ho) + seg('threads', 'Обсуждения', ta) + '</div>';
  }
  function bindInboxSwitch(scope) {
    if (!scope) return;
    Array.prototype.forEach.call(scope.querySelectorAll('.ibsw-b'), function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-m');
        if (m === state.inboxMode) return;
        state.inboxMode = m;
        renderView(); renderSide(); renderTopbar();
      });
    });
  }
  /* пустой/служебный экран инбокса — с тумблером сверху, чтобы можно было уйти на вторую вкладку */
  function inboxBlank(inner) {
    return '<div class="tg"><div class="ib-solo">' + inboxSwitch() + '<div class="tg-blank">' + inner + '</div></div></div>';
  }

  function renderInbox(view) {
    if (!state.bot.loaded) {
      // скелетон инбокса: список-плейсхолдеры + пустая панель чата (не три точки)
      var skRows = ''; for (var i = 0; i < 7; i++) skRows += '<div class="tg-skrow"><span class="shim tg-skava"></span><span class="tg-skrb"><span class="shim tg-skl w50"></span><span class="shim tg-skl w30"></span></span></div>';
      view.innerHTML = '<div class="tg show-chat"><aside class="tg-list">' + inboxSwitch() + '<div class="tg-search"><span class="searchwrap"><span class="shim" style="width:100%;height:34px;border-radius:9px;display:block"></span></span></div><div class="tg-rows">' + skRows + '</div></aside><main class="tg-chat"><div class="tg-sk">' +
        '<span class="shim tg-skb in" style="width:48%"></span><span class="shim tg-skb out" style="width:40%"></span><span class="shim tg-skb in" style="width:60%"></span></div></main></div>';
      bindInboxSwitch(view);
      loadBotData(function () { if (state.page === 'inbox') renderView(); });
      return;
    }
    if (state.bot.source !== 'api') {
      view.innerHTML = inboxBlank('<div class="tg-blank-ic">' + ic('chat', 26) + '</div>' +
        '<div style="font-weight:600;color:var(--ink)">Бот ещё не подключён к CRM</div>' +
        '<div style="max-width:360px;text-align:center;line-height:1.5">Как только бэкенд получит доступ к базе бота, сюда поедут реальные переписки из Telegram. Демо-данных больше нет.</div>' +
        '<button class="bp" id="ib-retry">' + ic('refresh', 14) + 'Проверить снова</button>');
      bindInboxSwitch(view);
      var rb = el('ib-retry'); if (rb) rb.addEventListener('click', function () { state.bot.loaded = false; renderInbox(view); });
      return;
    }
    var convos = inboxConvos();
    // сортировка строго по дате последнего сообщения (стабильно — клик не двигает список)
    convos.sort(function (a, b) { return new Date(b.last_at || 0) - new Date(a.last_at || 0); });
    var counts = {}; CHAN_ORDER.forEach(function (k) { counts[k] = 0; });
    convos.forEach(function (c) { counts[c.channel] = (counts[c.channel] || 0) + 1; });

    var q = (state.inboxQ || '').toLowerCase();
    var list = convos.filter(function (c) {
      if (state.inboxCh && c.channel !== state.inboxCh) return false;
      if (q && ((c.name || '') + ' ' + (c.last_text || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (!state.inboxSel || !list.some(function (c) { return String(c.id) === String(state.inboxSel); })) {
      state.inboxSel = list[0] ? list[0].id : null;
    }

    var chips = '<button class="tg-fch' + (!state.inboxCh ? ' on' : '') + '" data-ch="">Все</button>' +
      CHAN_ORDER.map(function (k) {
        if (!counts[k]) return '';
        return '<button class="tg-fch' + (state.inboxCh === k ? ' on' : '') + '" data-ch="' + k + '" style="--c:' + CHANNELS[k].c + '">' +
          ic(CHANNELS[k].icon, 12) + '<span class="tg-fn num">' + counts[k] + '</span></button>';
      }).join('');

    function rowHtml(c) {
      var cm = chMeta(c.channel);
      var st = inboxTag(c);
      return '<button class="tg-row' + (String(c.id) === String(state.inboxSel) ? ' on' : '') + (c.unread ? ' unread' : '') + '" data-id="' + esc(c.id) + '">' +
        '<span class="tg-ava" style="--c:' + cm.c + '">' + esc(initials(c.name)) +
          '<span class="tg-ch" style="background:' + cm.c + '">' + ic(cm.icon, 8) + '</span></span>' +
        '<span class="tg-rb"><span class="tg-r1"><span class="tg-nm' + (c.anon ? ' anon' : '') + '">' + esc(c.name) + '</span>' +
          '<span class="tg-tm num">' + fmtWhen(c.last_at) + '</span></span>' +
          '<span class="tg-r2"><span class="tg-pv">' + esc((c.last_text || '').replace(/<[^>]+>/g, '').slice(0, 60)) + '</span>' +
          (c.unread ? '<span class="tg-badge' + (c.handoff ? ' wait' : '') + '"></span>' : '') + '</span>' +
          '<span class="tg-r3">' + st + '</span></span>' +
      '</button>';
    }
    var rows = list.length ? list.map(rowHtml).join('') : '<div class="tg-empty-list">Ничего не найдено</div>';

    view.innerHTML =
      '<div class="tg' + (state.inboxSel ? ' show-chat' : '') + '" id="tg">' +
        '<aside class="tg-list">' + inboxSwitch() +
          '<div class="tg-search"><span class="searchwrap">' + ic('leads', 15) + '<input id="tg-q" class="search" type="search" placeholder="Поиск диалога" autocomplete="off"></span></div>' +
          '<div class="tg-fchips">' + chips + '</div>' +
          '<div class="tg-rows" id="tg-rows">' + rows + '</div>' +
        '</aside>' +
        '<main class="tg-chat" id="tg-chat"></main>' +
      '</div>';

    bindInboxSwitch(view);
    var qi = el('tg-q');
    if (qi) {
      qi.value = state.inboxQ || '';
      qi.addEventListener('input', function () {
        state.inboxQ = this.value.trim();
        // перерисовываем только список строк (не теряя фокус инпута)
        var host = el('tg-rows'); if (!host) return;
        var f = convos.filter(function (c) {
          if (state.inboxCh && c.channel !== state.inboxCh) return false;
          var qq = state.inboxQ.toLowerCase();
          return !qq || ((c.name || '') + ' ' + (c.last_text || '')).toLowerCase().indexOf(qq) !== -1;
        });
        host.innerHTML = f.length ? f.map(rowHtml).join('') : '<div class="tg-empty-list">Ничего не найдено</div>';
        bindRows(host, f);
      });
    }
    Array.prototype.forEach.call(view.querySelectorAll('.tg-fch'), function (b) {
      b.addEventListener('click', function () { state.inboxCh = b.getAttribute('data-ch'); state.inboxSel = null; renderInbox(view); });
    });
    function bindRows(host, lst) {
      Array.prototype.forEach.call(host.querySelectorAll('.tg-row[data-id]'), function (n) {
        n.addEventListener('click', function () {
          state.inboxSel = n.getAttribute('data-id');
          syncHash(state.inboxSel, 'dialog');   // адрес показывает открытый диалог — ссылку можно скопировать
          // выделение без пересборки списка (без прыжков)
          Array.prototype.forEach.call(host.querySelectorAll('.tg-row'), function (x) { x.classList.remove('on'); });
          n.classList.add('on'); n.classList.remove('unread');
          var bdg = n.querySelector('.tg-badge'); if (bdg) bdg.remove();
          el('tg').classList.add('show-chat');
          renderInboxChat(lst);
        });
      });
    }
    bindRows(el('tg-rows'), list);
    renderInboxChat(list);
  }

  function renderInboxChat(list) {
    var host = el('tg-chat'); if (!host) return;
    composerSave();   // всё, что менеджер уже набрал, забираем в state ДО пересборки панели
    var c = (list || []).filter(function (x) { return String(x.id) === String(state.inboxSel); })[0];
    if (!c) {
      host.innerHTML = '<div class="tg-blank"><div class="tg-blank-ic">' + ic('chat', 26) + '</div><div>Выбери диалог слева</div></div>';
      return;
    }
    inboxMarkSeen(c);
    var cm = chMeta(c.channel);
    var aiOn = c.ai_on !== false;  // источник правды — ai_enabled; taken_by = просто «кто вёл»
    var msgs = convoMessages(c);
    if (msgs === null) {
      // скелетон ВСЕЙ панели чата (шип-заголовок + пузыри), пока грузятся сообщения —
      // консистентно со скелетоном списка, не «сразу шапка + пустые пузыри»
      host.innerHTML =
        '<div class="tg-chead sk">' +
          '<span class="shim tg-skava sm"></span>' +
          '<span class="shim tg-skl" style="width:140px;height:14px"></span>' +
        '</div>' +
        '<div class="tg-thread"><div class="tg-sk">' +
          '<span class="shim tg-skb in" style="width:58%"></span>' +
          '<span class="shim tg-skb out" style="width:44%"></span>' +
          '<span class="shim tg-skb in" style="width:66%"></span>' +
          '<span class="shim tg-skb out" style="width:38%"></span>' +
          '<span class="shim tg-skb in" style="width:50%"></span>' +
        '</div></div>';
      api('/admin/api/bot/conversations/' + c.id + '/messages').then(function (d) {
        state.bot.msgs[c.id] = d; if (state.page === 'inbox' && String(state.inboxSel) === String(c.id)) renderInboxChat(list);
      }).catch(function () {});
      return;
    }
    var thread = buildThread(msgs);

    var statusLine = c.handoff ? '<span class="tg-st hot">' + ic('hand', 11) + 'просит менеджера</span>'
      : aiOn ? '<span class="tg-st ai">' + ic('bot', 11) + 'AI ведёт</span>'
      : '<span class="tg-st mgr">' + ic('hand', 11) + (c.taken_by ? 'ведёт ' + esc(c.taken_by) : 'ведёт менеджер') + '</span>';

    state._composerRendering = true;
    host.innerHTML =
      '<div class="tg-chead">' +
        '<button class="tg-back" id="tg-back">' + ic('go', 14) + '</button>' +
        '<span class="tg-ava sm" style="--c:' + cm.c + '">' + esc(initials(c.name)) + '</span>' +
        '<div class="tg-ci"><div class="tg-cn">' + esc(c.name) + '</div><div class="tg-cs">' + chBadge(c.channel) + statusLine + '</div></div>' +
        '<button class="ai-toggle' + (aiOn ? ' on' : '') + '" id="tg-ai" title="' + (aiOn ? 'Бот отвечает автоматически — нажми, чтобы вести самому' : 'Бот выключен — нажми, чтобы он снова отвечал') + '">' +
          '<span class="ait-dot"></span>' + (aiOn ? 'Бот отвечает' : 'Бот выключен') + '</button>' +
      '</div>' +
      (c.handoff ? '<div class="handoff-banner"><span>' + ic('hand', 14) + '</span><div><b>Клиент просит менеджера</b><span>напиши ответ ниже — бот сам замолчит в этом диалоге, и он перейдёт к тебе.</span></div></div>' : '') +
      '<div class="tg-thread" id="tg-thread">' + thread + '</div>' +
      '<div class="tg-hint ' + (aiOn ? 'ai' : 'mgr') + '">' + ic(aiOn ? 'bot' : 'hand', 12) +
        (aiOn
          ? '<span>Бот отвечает сам. <b>Напишешь — он замолчит в этом диалоге</b>, пока не включишь снова.</span>'
          : '<span>Диалог ведёшь ты — бот молчит. Нажми <b>«Бот вкл»</b>, чтобы вернуть авто-ответы' + resumeNote(c) + '</span>') +
      '</div>' +
      '<div class="tg-compose">' +
        '<textarea id="tg-input" rows="1" data-conv="' + esc(c.id) + '" autocomplete="off" ' +
          'placeholder="' + (aiOn ? 'Написать — вы перехватите диалог у бота' : 'Написать сообщение') + '"></textarea>' +
        '<button class="tg-send" id="tg-send" title="Отправить (Enter · Shift+Enter — новая строка)">' + ic('send', 16) + '</button>' +
      '</div>';
    state._composerRendering = false;

    var th = el('tg-thread'); if (th) th.scrollTop = th.scrollHeight;
    var bk = el('tg-back'); if (bk) bk.addEventListener('click', function () { el('tg').classList.remove('show-chat'); });
    var ai = el('tg-ai'); if (ai) ai.addEventListener('click', function () { inboxSetAi(c, !aiOn); });
    var inp = el('tg-input'), snd = el('tg-send');
    function send() {
      if (!inp) return;
      var t = inp.value.trim(); if (!t) return;
      inp.value = ''; delete state.drafts[c.id]; composerGrow(inp);
      inp.focus(); composerSave();   // курсор остаётся в поле: следующее сообщение пишется сразу
      inboxSend(c, t);
    }
    if (snd) snd.addEventListener('click', send);
    if (inp) {
      composerRestore(c.id);   // возвращаем недописанное после любой перерисовки
      inp.addEventListener('input', function () { composerSave(); composerGrow(inp); });
      ['focus', 'blur', 'keyup', 'click'].forEach(function (ev) { inp.addEventListener(ev, composerSave); });
      inp.addEventListener('keydown', function (e) {
        // Enter отправляет, Shift+Enter — перенос строки (привычка из мессенджеров).
        // e.isComposing — идёт набор через IME, Enter там подтверждает вариант, а не шлёт.
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
          e.preventDefault(); send();
        }
      });
    }
    // удаление сообщения (модерация) — оптимистично + фоном
    Array.prototype.forEach.call(host.querySelectorAll('.tg-del[data-del]'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var mid = b.getAttribute('data-del');
        var d = state.bot.msgs[c.id];
        if (d && d.messages) d.messages = d.messages.filter(function (m) { return String(m.id) !== String(mid); });
        apiSend('/admin/api/bot/conversations/' + c.id + '/messages/' + mid, 'DELETE', null, function () {});
        renderInboxChat(list);
      });
    });
  }

  /* ── РАЗДЕЛ «Диалог» в карточке лида (демо) ── */
  function buildDialog(ctx) {
    var l = ctx.lead || ctx.base;
    var dlg = getDialog(l.crm ? l : ctx.base);
    var aiOn = dlg.ai_on;
    var thread = dlg.messages.map(function (m) {
      var side = m.from === 'client' ? 'in' : 'out';
      var tag = m.from === 'bot' ? '<span class="msg-by ai">' + ic('bot', 11) + 'AI-бот</span>'
        : m.from === 'manager' ? '<span class="msg-by hum">' + ic('hand', 11) + 'Менеджер</span>' : '';
      return '<div class="msg ' + side + (m.from === 'manager' ? ' mgr' : '') + '">' +
        (tag ? '<div class="msg-h">' + tag + '</div>' : '') +
        '<div class="msg-b">' + esc(m.text) + '</div><div class="msg-t num">' + fmtWhen(m.at) + '</div></div>';
    }).join('');
    if (dlg.handed) thread += '<div class="msg-sys">' + ic('hand', 12) + 'Диалог передан менеджеру</div>';

    var handoffBanner = (dlg.handoff_req && !dlg.handed)
      ? '<div class="handoff-banner">' + ic('hand', 14) + '<div><b>Клиент просит менеджера</b><span>бот продолжает отвечать. Возьми диалог, когда готов.</span></div></div>' : '';

    return '<div class="m-ctitle">Диалог</div>' +
      '<div class="m-csub">Как человек общается с ботом. Канал, история, расход AI. Демо — оживёт с подключением бота.</div>' +
      handoffBanner +
      '<div class="dlg-bar">' +
        '<div class="dlg-ch">' + chBadge(dlg.channel) + '</div>' +
        (aiOn
          ? '<div class="dlg-acts"><button class="ai-toggle on" id="dlg-ai"><span class="ait-dot"></span>AI ведёт диалог</button>' +
            '<button class="bp sm" id="dlg-take">' + ic('hand', 13) + 'Взять диалог</button></div>'
          : '<div class="dlg-acts"><button class="ai-toggle" id="dlg-ai"><span class="ait-dot"></span>AI выключен</button>' +
            '<button class="bp ghost sm" id="dlg-return">' + ic('bot', 13) + 'Вернуть AI</button></div>') +
      '</div>' +
      '<div class="dlg-thread">' + thread + '</div>' +
      '<div class="dlg-cost"><div class="dc-cell"><div class="dc-v num">' + dlg.msgs + '</div><div class="dc-l">сообщений</div></div>' +
        '<div class="dc-cell"><div class="dc-v num">' + fmtMoney(dlg.tokens) + '</div><div class="dc-l">токенов AI</div></div>' +
        '<div class="dc-cell"><div class="dc-v num" style="color:var(--amber-ink)">' + dlg.cost_rub + ' ₽</div><div class="dc-l">расход на диалог</div></div></div>';
  }

  /* ── СТРАНИЦА «Аналитика бота» (owner) — api с фоллбэком на демо ── */
  function renderBotAnalytics(view) {
    if (!state.botStats) {
      view.innerHTML = dashSkeleton();
      api('/admin/api/bot/analytics').then(function (r) { state.botStats = normBotStats(r, 'api'); if (state.page === 'analytics') renderView(); })
        .catch(function () { state.botStats = 'none'; if (state.page === 'analytics') renderView(); });
      return;
    }
    if (state.botStats === 'none') {
      view.innerHTML = '<div class="card"><div class="empty">Аналитика бота появится, когда бэкенд получит доступ к базе бота. Демо-данных больше нет.</div></div>';
      return;
    }
    var st = state.botStats;
    var bar = statBar([
      { tint: 'blue', label: 'Первый ответ', value: st.first_resp + ' сек', sub: 'среднее по каналам' },
      { tint: 'green', label: 'AI довёл до заявки', value: st.ai_closed, sub: st.dialogs ? Math.round(st.ai_closed / st.dialogs * 100) + '% диалогов' : '' },
      { tint: 'navy', label: 'Передано менеджеру', value: st.handed, sub: 'сложные / горячие' },
      { tint: 'amber', label: 'Расход AI', value: fmtMoney(st.cost) + ' ₽', sub: st.bot_msgs + ' ответов' },
    ]);
    var chParts = st.by_channel.filter(function (x) { return x.n; });
    var chTotal = chParts.reduce(function (s2, x) { return s2 + x.n; }, 0) || 1;
    var acc = 0;
    var grad = chParts.map(function (x) { var f = acc / chTotal * 100; acc += x.n; return chMeta(x.channel).c + ' ' + f + '% ' + (acc / chTotal * 100) + '%'; }).join(', ');
    var chLeg = chParts.map(function (x) {
      return '<div class="r"><span class="dd2" style="background:' + chMeta(x.channel).c + '"></span><span class="dnm">' + esc(chMeta(x.channel).label) + '</span>' +
        '<span class="dcount num">' + x.n + '</span><span class="dpc num">' + Math.round(x.n / chTotal * 100) + '%</span></div>';
    }).join('');
    var chanCard = '<div class="card sp7" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('chat', 14) + '</span><div><div class="t">Лиды по каналам</div><div class="s">откуда пишут клиенты</div></div></div>' +
      '<div class="distr-body"><div class="dwrap"><div class="dpie" style="background:conic-gradient(' + grad + ')"></div>' +
      '<div class="dctr"><div><div class="dn num">' + chTotal + '</div><div class="ds">диалогов</div></div></div></div>' +
      '<div class="dleg">' + chLeg + '</div></div></div>';

    var fmax = st.funnel[0] ? (st.funnel[0].n || 1) : 1;
    var funRows = st.funnel.map(function (f2, i) {
      var w = Math.round(f2.n / fmax * 100);
      var conv = i && st.funnel[i - 1].n ? Math.round(f2.n / st.funnel[i - 1].n * 100) + '%' : '';
      return '<div class="cvc-row"><div class="cvc-nm">' + esc(f2.l) + '</div>' +
        '<div class="cvc-track"><div class="cvc-fill" style="width:' + Math.max(w, f2.n ? 5 : 0) + '%"></div></div>' +
        '<div class="cvc-c num">' + f2.n + '</div><div class="cvc-p num">' + conv + '</div></div>';
    }).join('');
    var funCard = '<div class="card sp5" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('funnel', 14) + '</span><div class="t">Воронка бота</div></div>' +
      '<div class="cvc-rows" style="margin-top:12px">' + funRows + '</div></div>';

    var faqMax = st.faq.length ? st.faq[0].n : 1;
    var faqCard = '<div class="card sp7" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('chat', 14) + '</span><div><div class="t">Частые вопросы клиентов</div><div class="s">что чаще спрашивают / где база молчит</div></div></div>' +
      (st.faq.length ? '<div class="cvc-rows" style="margin-top:12px">' + st.faq.map(function (q) {
        return '<div class="cvc-row"><div class="cvc-nm" style="white-space:normal">' + esc(q.q) + '</div>' +
          '<div class="cvc-track"><div class="cvc-fill" style="width:' + Math.round(q.n / faqMax * 100) + '%"></div></div>' +
          '<div class="cvc-c num">' + q.n + '</div><div class="cvc-p num"></div></div>';
      }).join('') + '</div>' : '<div class="empty">Пока нет данных по вопросам.</div>') + '</div>';

    var costCard = '<div class="card sp5" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic gold">' + ic('coins', 14) + '</span><div><div class="t">Стоимость обработки</div><div class="s">сколько AI тратит на лида</div></div></div>' +
      '<div class="lose-body"><div class="lose-big"><b class="num" style="color:var(--amber-ink)">' + (st.dialogs ? Math.round(st.cost / st.dialogs) : 0) + ' ₽</b><span>на один диалог</span></div>' +
      '<div class="lose-sub">Всего ' + fmtMoney(st.cost) + ' ₽ на ' + st.dialogs + ' ' + plural(st.dialogs, 'диалог', 'диалога', 'диалогов') + '. Дешевле менеджера на первичке.</div></div></div>';

    var banner = st.source === 'demo'
      ? '<div class="ib-banner">' + ic('bolt', 14) + '<span>Демо-аналитика. С подключением бота цифры станут реальными (каналы, конверсии, расход, пробелы базы).</span></div>' : '';
    view.innerHTML = '<div class="dash">' + banner + bar + '<div class="grid">' + chanCard + funCard + faqCard + costCard + '</div></div>';
  }
  function normBotStats(r, source) {
    var byCh = (r.by_channel || []).map(function (x) { return { channel: x.channel, n: x.n }; });
    return {
      source: source, first_resp: 7, dialogs: r.dialogs || 0, bot_msgs: r.bot_msgs || 0,
      ai_closed: Math.max(0, (r.dialogs || 0) - (r.handed || 0)), handed: r.handed || 0, cost: r.est_cost_rub || 0,
      by_channel: byCh.length ? byCh : [{ channel: 'telegram', n: r.dialogs || 0 }],
      funnel: [
        { l: 'Написали боту', n: r.dialogs || 0 },
        { l: 'Получили ответ', n: (r.dialogs || 0) - (r.ai_off || 0) },
        { l: 'Просят менеджера', n: r.handoff || 0 },
        { l: 'Взяты менеджером', n: r.ai_off || 0 },
      ],
      faq: (r.frequent_gaps || []).map(function (g) { return { q: g.q, n: g.n }; }),
    };
  }
  function mockBotStats() {
    var arr = state.leads;
    var byCh = {}; CHAN_ORDER.forEach(function (k) { byCh[k] = 0; });
    var cost = 0, msgs = 0, handed = 0, closed = 0;
    arr.forEach(function (l) { var d = getDialog(l); byCh[d.channel]++; cost += d.cost_rub; msgs += d.msgs; if (d.handed) handed++; else if (l.booking) closed++; });
    var total = arr.length;
    return {
      source: 'demo', first_resp: 6, dialogs: total, bot_msgs: msgs, ai_closed: closed, handed: handed, cost: cost,
      by_channel: CHAN_ORDER.filter(function (k) { return byCh[k]; }).map(function (k) { return { channel: k, n: byCh[k] }; }),
      funnel: [
        { l: 'Написали боту', n: total },
        { l: 'Квалифицированы', n: state.leads.filter(function (x) { return x.status !== 'visited'; }).length },
        { l: 'Запущена диагностика', n: state.leads.filter(function (x) { return x.stages && x.stages.diagnostics === 'done'; }).length },
        { l: 'Записались', n: state.leads.filter(function (x) { return x.booking; }).length },
        { l: 'Стали клиентами', n: state.leads.filter(function (x) { return !!x.paid; }).length },
      ],
      faq: [{ q: 'Какие нужны документы для поступления?', n: 38 }, { q: 'Сколько стоит сопровождение?', n: 31 },
        { q: 'Есть ли гранты CSC и как получить?', n: 27 }, { q: 'Нужен ли HSK для бакалавриата?', n: 22 }, { q: 'Как оформить визу?', n: 18 }],
    };
  }

  /* ── DRAWER (карточка лида) ───────────────────────────── */
  /* ════ КАРТОЧКА КЛИЕНТА — центр-модалка с левой навигацией ════ */
  var MODAL_SECTIONS = [
    { id: 'main',      label: 'Главное',     icon: 'target' },
    { id: 'now',       label: 'Сейчас',      icon: 'flame' },
    { id: 'admission', label: 'Поступление', icon: 'cap' },
    { id: 'det',       label: 'Английский',  icon: 'globe' },
    { id: 'course',    label: 'Китайский',   icon: 'play' },
    { id: 'offers',    label: 'Витрина',     icon: 'box' },
    { id: 'path',      label: 'Путь',        icon: 'path' },
    { id: 'notes',  label: 'Заметки',    icon: 'note' },
    { id: 'docs',   label: 'Документы',  icon: 'doc' },
    { id: 'pay',    label: 'Оплаты',     icon: 'card' },
    { id: 'notify', label: 'Написать',   icon: 'send' },
    { id: 'ai',     label: 'Диагностика', icon: 'spark' },
  ];

  /* ════ ПОСТУПЛЕНИЕ — конструктор задач по этапам пути в Китай ════
     Путь клиента разложен на этапы. У задачи есть владелец (клиент / мы), статус,
     задание (что сделать), список того, что нужно прислать, присланное клиентом
     (файлы / фото / тексты) и тред комментариев. Менеджер раскрывает задачу,
     смотрит присланное, принимает или возвращает, комментирует.
     Пока без бэка: состояние живёт локально в RM[id]. Контракт задачи:
       { id, stage, title, owner:'client'|'team', status, need, due:'YYYY-MM-DD'|'', attach:[type],
         subs:[{kind:'image'|'file'|'text'|'link', name, src, text, at}],
         comments:[{by:'mgr'|'client', text, at, atts:[{kind:'image'|'file', name, src}]}] }
       status: 'wait' | 'doing' | 'review' | 'done' | 'return'
       тип вложения (attach / sub.kind): 'photo'|'file'|'text'|'link'             */
  var RM_ATTACH = {
    photo: { label: 'Фото',   icon: 'image' },
    file:  { label: 'Файл',   icon: 'doc' },
    text:  { label: 'Текст',  icon: 'note' },
    link:  { label: 'Ссылка', icon: 'ext' },
  };
  var ADMISSION_STAGES = [
    { key: 'intro',    n: 1, title: 'Знакомство и анализ',  sub: 'Собираем профиль и понимаем, с чем работаем.',
      presets: [ { t: 'Заполнить анкету', o: 'client', need: 'Пройти все шаги анкеты на платформе.', at: ['text'] },
                 { t: 'Пройти консультацию', o: 'client' },
                 { t: 'Проанализировать профиль', o: 'team' } ] },
    { key: 'strategy', n: 2, title: 'Стратегия',            sub: 'Подбираем гранты и вузы под профиль.',
      presets: [ { t: 'Сформировать стратегию поступления', o: 'team' }, { t: 'Подобрать список вузов и грантов', o: 'team' } ] },
    { key: 'docs',     n: 3, title: 'Подготовка документов', sub: 'Собираем и оформляем весь пакет.',
      hint: 'Дедлайны: справка о несудимости — около 15 ноября · Duolingo / IELTS — до 1 января · многое — до 1 декабря.',
      presets: [
        { t: 'Загранпаспорт', o: 'client', need: 'Разворот с фото, четко, без бликов.', at: ['photo'] },
        { t: 'Аттестат или диплом', o: 'client', need: 'Аттестат и приложение с оценками. Скан или ровное фото.', at: ['photo', 'file'] },
        { t: 'Выписка оценок', o: 'client', need: 'Официальная выписка за все классы.', at: ['file'] },
        { t: 'Языковой сертификат (HSK / IELTS / Duolingo / TOEFL)', o: 'client', need: 'Скан сертификата или результата.', at: ['photo', 'file'] },
        { t: 'Мотивационное письмо', o: 'client', need: '200–300 слов: почему Китай, почему эта специальность.', at: ['text'] },
        { t: 'Рекомендательные письма', o: 'client', need: 'От преподавателя последней ступени обучения.', at: ['file'] },
        { t: 'Справка о несудимости', o: 'client', need: 'Оформляется около двух недель — начни заранее.', at: ['file'] },
        { t: 'Медицинская справка', o: 'client', need: 'Форма для выезжающих за рубеж.', at: ['file'] },
        { t: 'Фотографии', o: 'client', need: 'Формат для документов, белый фон.', at: ['photo'] },
        { t: 'Проверить и подписать анкеты вузов', o: 'client', need: 'Проверь данные и пришли подписанные сканы.', at: ['file'] },
        { t: 'Нотариальные переводы документов', o: 'team' }, { t: 'Заполнить анкеты вузов и грантов', o: 'team' },
        { t: 'Проверить корректность пакета', o: 'team' } ] },
    { key: 'submit',   n: 4, title: 'Подача',                sub: 'Отправляем документы в вузы.',
      presets: [ { t: 'Подать документы в вузы', o: 'team' } ] },
    { key: 'exam',     n: 5, title: 'Интервью и экзамены',  sub: 'Если вуз или грант их предусматривает.',
      presets: [ { t: 'Подготовить кандидата к интервью', o: 'team' }, { t: 'Пройти собеседование или экзамен', o: 'client' } ] },
    { key: 'result',   n: 6, title: 'Результат и выбор',    sub: 'Разбираем офферы и выбираем грант.',
      presets: [ { t: 'Помочь с анализом офферов', o: 'team' }, { t: 'Выбрать подходящий грант', o: 'client' } ] },
    { key: 'visa',     n: 7, title: 'Визовое оформление',   sub: 'Готовим документы на визу.',
      presets: [ { t: 'Оформить документы на визу', o: 'team' } ] },
    { key: 'move',     n: 8, title: 'Переезд и заселение',  sub: 'Маршрут, прибытие, регистрация в вузе.',
      presets: [ { t: 'Спланировать маршрут и прибытие', o: 'team' }, { t: 'Регистрация в вузе и заселение', o: 'team' } ] },
  ];
  var RM_STATUS = {
    wait:   { label: 'ждем' },
    doing:  { label: 'в работе' },
    review: { label: 'на проверке' },
    done:   { label: 'готово' },
    return: { label: 'вернули' },
  };
  var RM = {};
  var RM_OPEN = {};  /* какие задачи раскрыты (по id) */

  /* демо-превью присланного документа (пока нет реальных файлов) */
  function rmDemoImg() {
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='150'>" +
      "<rect width='220' height='150' fill='#EEF2FB'/>" +
      "<rect x='22' y='16' width='176' height='118' rx='8' fill='#fff' stroke='#D6E0F5'/>" +
      "<rect x='38' y='32' width='84' height='11' rx='4' fill='#BBD0F4'/>" +
      "<rect x='38' y='56' width='144' height='7' rx='3.5' fill='#E4EAF6'/>" +
      "<rect x='38' y='71' width='144' height='7' rx='3.5' fill='#E4EAF6'/>" +
      "<rect x='38' y='86' width='110' height='7' rx='3.5' fill='#E4EAF6'/>" +
      "<rect x='38' y='108' width='56' height='15' rx='4' fill='#2F6BFF' opacity='.9'/>" +
      "</svg>";
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }
  function rmSeed(id) {
    /* демо-наполнение, чтобы прочувствовать поток: присланное, проверка, комментарии */
    var s4 = String(id).slice(0, 4);
    var now = Date.now();
    var hrs = function (h) { return new Date(now - h * 3600000).toISOString(); };
    var T = [
      { stage: 'intro', title: 'Заполнить анкету', owner: 'client', status: 'done', need: 'Пройти все шаги анкеты на платформе.', attach: ['text'],
        subs: [{ kind: 'text', text: 'Анкета заполнена полностью — 7 из 7 шагов.', at: hrs(72) }] },
      { stage: 'intro', title: 'Пройти консультацию', owner: 'client', status: 'done' },
      { stage: 'intro', title: 'Проанализировать профиль', owner: 'team', status: 'done' },
      { stage: 'strategy', title: 'Сформировать стратегию поступления', owner: 'team', status: 'done' },
      { stage: 'strategy', title: 'Подобрать список вузов и грантов', owner: 'team', status: 'doing' },
      { stage: 'docs', title: 'Загранпаспорт', owner: 'client', status: 'done', need: 'Разворот с фото, четко, без бликов.', attach: ['photo'],
        subs: [{ kind: 'image', name: 'passport.jpg', at: hrs(48) }] },
      { stage: 'docs', title: 'Аттестат или диплом', owner: 'client', status: 'review', need: 'Аттестат и приложение с оценками. Скан или ровное фото, без бликов.', attach: ['photo', 'file'],
        subs: [{ kind: 'image', name: 'attestat.jpg', at: hrs(5) }, { kind: 'image', name: 'prilozhenie.jpg', at: hrs(5) }, { kind: 'file', name: 'diplom-perevod.pdf', at: hrs(5) }],
        comments: [
          { by: 'client', text: 'Прислал аттестат и приложение с оценками, плюс перевод', at: hrs(5) },
          { by: 'mgr', text: 'Принял, спасибо. Вот образец печати, которую ждем на справке, и список требований.', at: hrs(4), atts: [{ kind: 'image', name: 'obrazec-pechati.jpg' }, { kind: 'file', name: 'trebovaniya.pdf' }] },
        ] },
      { stage: 'docs', title: 'Мотивационное письмо', owner: 'client', status: 'review', need: '200–300 слов: почему Китай, почему эта специальность.', attach: ['text'],
        subs: [{ kind: 'text', text: 'С детства увлекаюсь робототехникой и хочу учиться там, где она развивается быстрее всего. Китай для меня — это…', at: hrs(2) }] },
      { stage: 'docs', title: 'Выписка оценок', owner: 'client', status: 'doing', need: 'Официальная выписка за все классы.', attach: ['file'], due: todayISO(-1) },
      { stage: 'docs', title: 'Справка о несудимости', owner: 'client', status: 'wait', need: 'Оформляется около двух недель — начни заранее.', attach: ['file'], due: todayISO(5) },
      { stage: 'docs', title: 'Нотариальные переводы документов', owner: 'team', status: 'wait' },
    ];
    var arr = T.map(function (t, i) {
      return Object.assign({ id: 'rm' + i + '_' + s4, need: '', due: '', attach: [], subs: [], comments: [] }, t);
    });
    RM_OPEN[arr[6].id] = true;  /* аттестат раскрыт по умолчанию — сразу видно поток проверки */
    return arr;
  }
  var RM_LOADED = {};     /* доска подтянута с бэка (или засеяна дефолтом) — по id лида */
  var RM_SAVE_T = {};     /* таймеры дебаунса сохранения доски */
  var RM_STAGES = {};     /* мета этапов от AI [{position,key,title,about}] — уходит вместе с доской */
  var RM_REASON = {};     /* логика последней AI-сборки: трек, решения, пропущенные этапы */
  var PCHAT = {};         /* лента чата правок плана по id лида: [{me, text, report, at}] */
  var PCHAT_LOADED = {};  /* тред подтянут с бэка */
  var PCHAT_BUSY = {};    /* ждём ответ модели — не шлём вторую реплику */
  var RM_REFRESHED = {};  /* для лида уже дёрнули refreshDetail (старый кэш без доски) */
  /* сохранённая доска: сперва из ДЕТАЛИ лида, иначе из СПИСКА (admission приходит и там) */
  function rmSavedBoard(id) {
    var d = state.details[id];
    var detB = (d && d.crm && Array.isArray(d.crm.admission)) ? d.crm.admission : null;
    var l = findLead(id);
    var listB = (l && l.crm && Array.isArray(l.crm.admission)) ? l.crm.admission : null;
    // Обе доски — один и тот же persisted admission, но кэш ДЕТАЛИ мог сняться
    // ДО того, как пришли комментарии (тогда «Обсуждения» показывали строку, а
    // клик открывал пустой чат). Берём ту доску, где комментарии реально есть —
    // это всегда самая свежая версия; при равенстве приоритет у детали.
    var hasC = function (b) { return b && b.some(function (t) { return (t.comments || []).length; }); };
    if (hasC(detB)) return detB;
    if (hasC(listB)) return listB;
    return detB || listB;
  }
  function rmTasks(id) {
    if (RM_LOADED[id]) return RM[id] || (RM[id] = []);
    var saved = rmSavedBoard(id);
    if (saved === null) return RM[id] || (RM[id] = []);  // деталь ещё не загрузилась
    // Новый лид = ПУСТАЯ доска. Задачи появляются только когда команда
    // осознанно развернёт план (шаблон) или добавит задачи вручную — не по дефолту.
    RM[id] = saved.length ? JSON.parse(JSON.stringify(saved)) : [];
    RM_LOADED[id] = true;
    return RM[id];
  }
  /* сохранить доску на бэк (дебаунс), тихо синхронизировать кэш детали */
  function rmSave(id) {
    clearTimeout(RM_SAVE_T[id]);
    RM_SAVE_T[id] = setTimeout(function () {
      var board = RM[id] || [];
      var payload = { admission: board };
      // мету этапов шлём только когда AI её собрал — иначе не затираем ту, что уже в базе
      if (RM_STAGES[id]) payload.admission_stages = RM_STAGES[id];
      api('/admin/api/leads/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (res) {
        if (res && res.crm) {
          var l = findLead(id); if (l && l.crm) l.crm.admission = res.crm.admission;
          var d = state.details[id]; if (d && d.crm) { d.crm.admission = res.crm.admission; cacheSet(id, d); }
        }
      }).catch(function (e) { if (e && e.message !== '403') showToast('Доска не сохранилась — проверь сеть'); });
    }, 600);
  }
  function rmSet(id, arr) { RM[id] = arr; RM_LOADED[id] = true; rmSave(id); }
  function rmReviewCount(id) { return rmTasks(id).filter(function (t) { return t.status === 'review'; }).length; }
  /* загрузка вложения на бэк → относительный url (ключ подставим при отрисовке) */
  function rmUpload(id, att, cb) {
    var mime = ''; var m = /^data:([^;,]+)[;,]/.exec(att.src || ''); if (m) mime = m[1];
    api('/admin/api/attachments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: id, name: att.name || 'file', mime: mime, kind: att.kind || 'file', data: att.src }),
    }).then(function (res) {
      if (res && res.url) cb({ kind: att.kind || 'file', name: att.name || 'file', url: res.url });
      else cb(null);
    }).catch(function () { cb(null); });
  }
  /* загружаемая ссылка вложения: относительный путь бэка дополняем базой и ключом; data-URL — как есть */
  function rmAttUrl(a) {
    var u = (a && (a.url || a.src)) || '';
    if (u && u.charAt(0) === '/') u = API + u + (u.indexOf('?') === -1 ? '?k=' + encodeURIComponent(getKey()) : '');
    return u;
  }
  /* скрыть лид (мягко, в архив) / вернуть из архива — затем обновить список */
  function rmHideLead(id, hidden) {
    api('/admin/api/leads/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: !!hidden }),
    }).then(function () {
      var l = findLead(id); if (l && l.crm) l.crm.hidden = !!hidden;
      var d = state.details[id]; if (d && d.crm) { d.crm.hidden = !!hidden; cacheSet(id, d); }
      if (hidden) { closeDrawer(); showToast('Лид скрыт — в архиве'); }
      else { showToast('Лид возвращён из архива'); }
      loadLeads(true);
    }).catch(function (e) { if (e && e.message !== '403') showToast('Не получилось — проверь сеть'); });
  }

  /* Реальная сдача хранит doc_id (ссылка на client_docs), не готовый src — сам файл
     лежит в Storage за подписанной ссылкой, которую нужно резолвить запросом. Раньше
     rmSubCard рисовал либо мёртвую ссылку (href="#"), либо для картинок вообще
     демо-заглушку вместо присланного фото: куратор физически не мог посмотреть,
     что прислал клиент. Для doc_id-карточек оставляем href="#" + data-docid,
     резолвим асинхронно (см. resolveDocLink) — картинки сразу для превью, файлы
     по клику. */
  var RM_DOC_LINK_CACHE = {};
  function resolveDocLink(docId, cb) {
    if (RM_DOC_LINK_CACHE[docId]) { cb(RM_DOC_LINK_CACHE[docId]); return; }
    fetch(API + '/admin/api/docs/' + docId + '/download?k=' + encodeURIComponent(getKey()))
      .then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') !== -1) return r.json().then(function (d) { return d.link || null; });
        return r.blob().then(function (b) { return URL.createObjectURL(b); });
      })
      .then(function (url) { if (url) RM_DOC_LINK_CACHE[docId] = url; cb(url || null); })
      .catch(function () { cb(null); });
  }

  /* присланное клиентом — одна карточка вложения */
  function rmSubCard(s) {
    if (s.kind === 'image') {
      if (s.doc_id && !s.src) {
        return '<a class="rm-sub rm-sub-img rm-sub-pending" data-docid="' + s.doc_id + '" href="#" rel="noopener">' +
          '<span class="rm-sub-thumb rm-sub-thumb--load"></span>' +
          '<span class="rm-sub-cap">' + esc(s.name || 'фото') + '</span></a>';
      }
      var img = s.src || rmDemoImg();
      return '<a class="rm-sub rm-sub-img" href="' + img + '" target="_blank" rel="noopener">' +
        '<span class="rm-sub-thumb" style="background-image:url(\'' + img + '\')"></span>' +
        '<span class="rm-sub-cap">' + esc(s.name || 'фото') + '</span></a>';
    }
    if (s.kind === 'text') {
      return '<div class="rm-sub rm-sub-text">' + ic('note', 13) + '<span>' + esc(s.text || '') + '</span></div>';
    }
    if (s.kind === 'link') {
      return '<a class="rm-sub rm-sub-file" href="' + esc(s.src || '#') + '" target="_blank" rel="noopener">' +
        '<span class="rm-sub-fic">' + ic('ext', 14) + '</span><span class="rm-sub-nm">' + esc(s.name || s.src || 'ссылка') + '</span><span class="rm-sub-open">открыть</span></a>';
    }
    if (s.doc_id && !s.src) {
      return '<a class="rm-sub rm-sub-file" data-docid="' + s.doc_id + '" href="#" rel="noopener">' +
        '<span class="rm-sub-fic">' + ic('doc', 14) + '</span><span class="rm-sub-nm">' + esc(s.name || 'файл') + '</span><span class="rm-sub-open">' + ic('dl', 13) + '</span></a>';
    }
    return '<a class="rm-sub rm-sub-file" href="' + (s.src || '#') + '"' + (s.src ? ' target="_blank" rel="noopener"' : '') + '>' +
      '<span class="rm-sub-fic">' + ic('doc', 14) + '</span><span class="rm-sub-nm">' + esc(s.name || 'файл') + '</span><span class="rm-sub-open">' + ic('dl', 13) + '</span></a>';
  }

  /* черновики вложений к комментарию, по id задачи: { atts:[{kind,name,src}] } */
  var RM_DRAFT = {};
  /* картинку сжимаем на клиенте: ужимаем до 1400px и в jpeg ~0.82, чтобы не таскать тяжёлые исходники */
  function rmCompressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1400, w = img.width, h = img.height;
        if (w > max || h > max) { var k = Math.min(max / w, max / h); w = Math.round(w * k); h = Math.round(h * k); }
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        try { cv.getContext('2d').drawImage(img, 0, 0, w, h); cb({ kind: 'image', name: file.name, src: cv.toDataURL('image/jpeg', 0.82) }); }
        catch (e) { cb({ kind: 'image', name: file.name, src: reader.result }); }
      };
      img.onerror = function () { cb({ kind: 'image', name: file.name, src: reader.result }); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function rmReadFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function () { cb({ kind: 'file', name: file.name, src: reader.result }); };
    reader.readAsDataURL(file);
  }
  /* превью вложения в композере (с крестиком) */
  function rmDraftCard(a, i) {
    var up = a.uploading ? ' up' : '';
    if (a.kind === 'image') {
      return '<div class="rm-cdraft img' + up + '" data-i="' + i + '" style="background-image:url(\'' + rmAttUrl(a) + '\')">' +
        (a.uploading ? '<span class="rm-cdraft-spin"></span>' : '') +
        '<button class="rm-cdraft-x" title="Убрать">' + ic('x', 11) + '</button></div>';
    }
    return '<div class="rm-cdraft file' + up + '" data-i="' + i + '">' + ic('doc', 13) +
      '<span class="rm-cdraft-nm">' + esc(a.name || 'файл') + '</span>' +
      '<button class="rm-cdraft-x" title="Убрать">' + ic('x', 11) + '</button></div>';
  }
  /* вложение внутри пузыря комментария (кликабельное) */
  function rmCmtAttCard(a) {
    var href = rmAttUrl(a);
    if (a.kind === 'image') {
      var src = href || rmDemoImg();
      return '<a class="rm-catt img" href="' + src + '" target="_blank" rel="noopener" style="background-image:url(\'' + src + '\')"></a>';
    }
    return '<a class="rm-catt file" href="' + (href || '#') + '"' + (href ? ' target="_blank" rel="noopener"' : '') + '>' +
      ic('doc', 13) + '<span>' + esc(a.name || 'файл') + '</span></a>';
  }

  /* какой задачи открыт чат-оверлей (по id) или null */
  var RM_CHAT = null;
  /* применить изменение к задаче и перерисовать карточку (с сохранением чата, если открыт) */
  function rmApply(id, tid, fn) {
    rmSet(id, rmTasks(id).map(function (t) { return t.id === tid ? fn(Object.assign({}, t)) : t; }));
    if (state.drawerId === id && state.modalSection === 'admission') renderDrawer(true);
    else if (state.page === 'inbox' && state.inboxMode === 'threads') { state.threadSel = { id: id, tid: tid }; renderThreads(el('view')); }
  }
  /* композер сообщений: текст + вложения (фото/документы). Переиспользуется в чате задачи. */
  function bindCmtComposer(scope, id, tid) {
    var cmtIn = scope.querySelector('.rm-cmt-in'), cmtSend = scope.querySelector('.rm-cmt-send'),
        cmtClip = scope.querySelector('.rm-cmt-clip'), cmtFile = scope.querySelector('.rm-cmt-file'),
        cmtDrafts = scope.querySelector('.rm-cmt-drafts');
    var draftArr = function () { if (!RM_DRAFT[tid]) RM_DRAFT[tid] = { atts: [] }; return RM_DRAFT[tid].atts; };
    var renderDrafts = function () {
      if (!cmtDrafts) return;
      var arr = (RM_DRAFT[tid] && RM_DRAFT[tid].atts) || [];
      cmtDrafts.className = 'rm-cmt-drafts' + (arr.length ? ' has' : '');
      cmtDrafts.innerHTML = arr.map(rmDraftCard).join('');
      Array.prototype.forEach.call(cmtDrafts.querySelectorAll('.rm-cdraft-x'), function (xb) {
        xb.addEventListener('click', function () { draftArr().splice(+xb.parentNode.getAttribute('data-i'), 1); renderDrafts(); });
      });
    };
    renderDrafts();
    if (cmtClip && cmtFile) cmtClip.addEventListener('click', function () { cmtFile.click(); });
    if (cmtFile) cmtFile.addEventListener('change', function () {
      var files = Array.prototype.slice.call(cmtFile.files || []); cmtFile.value = '';
      files.forEach(function (f) {
        // мгновенно показываем плитку, потом сжимаем (картинки) и грузим на бэк
        var item = { kind: /^image\//.test(f.type) ? 'image' : 'file', name: f.name, src: null, url: null, uploading: true };
        draftArr().push(item); renderDrafts();
        var onRead = function (a) {
          item.src = a.src; item.kind = a.kind; renderDrafts();
          rmUpload(id, a, function (res) {
            item.uploading = false;
            if (res && res.url) item.url = res.url;
            renderDrafts();
          });
        };
        if (item.kind === 'image') rmCompressImage(f, onRead); else rmReadFile(f, onRead);
      });
    });
    var doSend = function () {
      var c = cmtIn ? cmtIn.value.trim() : '';
      var arr = (RM_DRAFT[tid] && RM_DRAFT[tid].atts) || [];
      if (arr.some(function (a) { return a.uploading; })) { showToast('Секунду — вложение ещё грузится'); return; }
      if (!c && !arr.length) return;
      // в комментарий кладём ссылку (url) — лёгкую; base64 (src) только как запасной путь
      var atts = arr.map(function (a) {
        return a.url ? { kind: a.kind, name: a.name, url: a.url } : { kind: a.kind, name: a.name, src: a.src };
      });
      delete RM_DRAFT[tid];
      rmApply(id, tid, function (t) { t.comments = (t.comments || []).concat([{ by: 'mgr', text: c, at: new Date().toISOString(), atts: atts }]); return t; });
    };
    if (cmtSend) cmtSend.addEventListener('click', doSend);
    if (cmtIn) cmtIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
  }
  /* рендер ленты сообщений по задаче (переиспользуется оверлеем и инбоксом «Обсуждения») */
  function rmMsgsHtml(comments) {
    if (!comments || !comments.length)
      return '<div class="rm-chat-empty">' + ic('chat', 26) + '<div>Тут переписка по задаче.<br>Напишите первое сообщение или прикрепите файл.</div></div>';
    return '<div class="rm-cmts">' + comments.map(function (c) {
      var catts = c.atts && c.atts.length ? '<div class="rm-catts">' + c.atts.map(rmCmtAttCard).join('') + '</div>' : '';
      var ctxt = c.text ? '<div class="rm-cmt-t">' + esc(c.text) + '</div>' : '';
      return '<div class="rm-cmt by-' + (c.by === 'client' ? 'client' : 'mgr') + '">' +
        '<div class="rm-cmt-h"><span class="rm-cmt-who">' + (c.by === 'client' ? 'Клиент' : 'Куратор') + '</span>' +
        (c.at ? '<span class="rm-cmt-when">' + fmtWhen(c.at) + '</span>' : '') + '</div>' + ctxt + catts + '</div>';
    }).join('') + '</div>';
  }
  /* лента обсуждения по задаче В СТИЛЕ «ДИАЛОГОВ» — те же пузыри .tg-msg (клиент слева,
     куратор справа), с днями-разделителями и вложениями; используется инбоксом «Обсуждения» */
  function buildThreadFromComments(comments) {
    if (!comments || !comments.length)
      return '<div class="tg-thread-empty">' + ic('chat', 24) +
        '<span>Тут переписка по задаче. Напишите первое сообщение или прикрепите файл.</span></div>';
    var lastDay = null;
    return comments.map(function (c) {
      var isClient = c.by === 'client';
      var side = isClient ? 'in' : 'out';
      var sep = '';
      var dk = c.at ? String(c.at).slice(0, 10) : '';
      if (dk && dk !== lastDay) { lastDay = dk; sep = '<div class="tg-day"><span>' + dayLabel(c.at) + '</span></div>'; }
      var atts = c.atts && c.atts.length ? '<div class="tg-atts">' + c.atts.map(rmCmtAttCard).join('') + '</div>' : '';
      var foot = isClient ? '' : '<span class="tg-by">' + ic('hand', 9) + 'Куратор</span>';
      return sep + '<div class="tg-msg ' + side + (isClient ? '' : ' mgr') + '">' +
        '<div class="tg-bub">' + atts + (c.text ? '<span class="tg-txt">' + mdMsg(c.text) + '</span>' : '') +
          '<span class="tg-mt num">' + fmtTime(c.at) + '</span></div>' + foot +
      '</div>';
    }).join('');
  }
  /* композер сообщения: вложения + текст + отправка (общий для оверлея и инбокса) */
  function rmComposerHtml() {
    return '<div class="rm-cmt-add">' +
      '<div class="rm-cmt-drafts"></div>' +
      '<div class="rm-cmt-bar">' +
        '<button class="rm-cmt-clip" title="Прикрепить фото или документ">' + ic('clip', 18) + '</button>' +
        '<input class="rm-cmt-in" placeholder="Сообщение по задаче…" autocomplete="off">' +
        '<button class="rm-cmt-send" title="Отправить">' + ic('send', 16) + '</button>' +
      '</div>' +
      '<input type="file" class="rm-cmt-file" accept="image/*,.pdf,.doc,.docx,.heic" multiple hidden>' +
    '</div>';
  }
  /* просторный чат-оверлей по задаче */
  function buildRmChat(id) {
    var t = rmTasks(id).filter(function (x) { return x.id === RM_CHAT; })[0];
    if (!t) return '';
    var st = ADMISSION_STAGES.filter(function (s) { return s.key === t.stage; })[0];
    var sm = RM_STATUS[t.status] || RM_STATUS.wait;
    var isClient = t.owner === 'client';
    var statusChip = '<span class="rm-status st-' + t.status + '">' + (t.status === 'review' ? '<i class="rm-pulse"></i>' : '') + sm.label + '</span>';
    return '<div class="rm-chat" data-chat="' + esc(t.id) + '">' +
      '<div class="rm-chat-head">' +
        '<button class="rm-chat-back" title="Назад к задачам">' + ic('go', 16) + '</button>' +
        '<div class="rm-chat-hid">' +
          '<div class="rm-chat-title">' + esc(t.title) + '</div>' +
          '<div class="rm-chat-meta"><span class="rm-who-t' + (isClient ? ' cl' : '') + '">' + (isClient ? 'клиент' : 'мы') + '</span>' +
            '<span class="rm-meta-sep"></span>' + esc(st ? st.title : '') + '</div>' +
        '</div>' + statusChip +
      '</div>' +
      '<div class="rm-chat-scroll"><div class="rm-chat-col">' + rmMsgsHtml(t.comments || []) + '</div></div>' +
      '<div class="rm-chat-foot"><div class="rm-chat-col">' + rmComposerHtml() + '</div></div>' +
    '</div>';
  }
  function bindRmChat(chat, id) {
    var back = chat.querySelector('.rm-chat-back');
    if (back) back.addEventListener('click', function () { RM_CHAT = null; syncRmChat(id); });
    bindCmtComposer(chat, id, chat.getAttribute('data-chat'));
    var inp = chat.querySelector('.rm-cmt-in'); if (inp) inp.focus();
  }
  /* смонтировать/снять чат-оверлей над телом модалки в зависимости от RM_CHAT */
  function syncRmChat(id) {
    var content = el('m-content'), body = content ? content.parentNode : null;
    var modalEl = el('modal');
    if (!body) return;
    var existing = body.querySelector('.rm-chat');
    if (existing) existing.parentNode.removeChild(existing);
    var open = state.modalSection === 'admission' && RM_CHAT &&
      rmTasks(id).filter(function (x) { return x.id === RM_CHAT; }).length;
    if (!open) {
      if (RM_CHAT && state.modalSection === 'admission') RM_CHAT = null;
      if (modalEl) modalEl.classList.remove('chat-open');
      return;
    }
    if (modalEl) modalEl.classList.add('chat-open');
    var wrap = document.createElement('div'); wrap.innerHTML = buildRmChat(id);
    var chat = wrap.firstChild; if (!chat) return;
    body.appendChild(chat);
    bindRmChat(chat, id);
    var sc = chat.querySelector('.rm-chat-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
  }

  /* ════ ОБСУЖДЕНИЯ — инбокс переписок по задачам всех клиентов ════ */
  /* живая доска лида: RM[id] если уже подтянута (свежее), иначе сохранённая из списка */
  function threadBoard(l) {
    if (RM_LOADED[l.id] && RM[l.id]) return RM[l.id];
    return (l.crm && Array.isArray(l.crm.admission)) ? l.crm.admission : null;
  }
  /* собрать все треды (задачи с хотя бы одним комментарием), свежие сверху */
  function buildThreads() {
    var out = [];
    (state.leads || []).forEach(function (l) {
      var board = threadBoard(l);
      if (!board || !board.length) return;
      board.forEach(function (t) {
        var cm = t.comments || [];
        if (!cm.length) return;
        var last = cm[cm.length - 1];
        out.push({
          leadId: l.id, name: leadName(l), taskId: t.id, title: t.title,
          stage: t.stage, owner: t.owner, status: t.status,
          last: last, lastAt: last.at || '',
          wait: last.by === 'client' || t.status === 'review',
        });
      });
    });
    out.sort(function (a, b) { return new Date(b.lastAt || 0) - new Date(a.lastAt || 0); });
    return out;
  }
  function threadsAttention() { return buildThreads().filter(function (t) { return t.wait; }).length; }

  function threadRow(th, sel) {
    var st = ADMISSION_STAGES.filter(function (s) { return s.key === th.stage; })[0];
    var last = th.last;
    var prev = last.text || (last.atts && last.atts.length ? 'вложение' : '');
    var who = last.by === 'client' ? 'Клиент' : 'Куратор';
    return '<button class="tg-row th-row' + (sel ? ' on' : '') + (th.wait ? ' unread' : '') +
      '" data-id="' + esc(th.leadId) + '" data-tid="' + esc(th.taskId) + '">' +
      // анатомия строки — один в один с «Диалогами»: аватар, имя+время, превью, тег снизу
      '<span class="tg-ava" style="--c:#2F6BFF">' + esc(initials(th.name)) +
        '<span class="tg-ch" style="background:#2F6BFF">' + ic('chat', 8) + '</span></span>' +
      '<span class="tg-rb">' +
        '<span class="tg-r1"><span class="tg-nm">' + esc(th.name) + '</span>' +
          '<span class="tg-tm num">' + fmtWhen(th.lastAt) + '</span></span>' +
        '<span class="tg-r2"><span class="tg-pv">' + esc(who + ': ' + prev) + '</span>' +
          (th.wait ? '<span class="tg-badge wait"></span>' : '') + '</span>' +
        '<span class="tg-r3"><span class="tg-tag tsk' + (th.wait ? ' wait' : ' ai') + '">' + ic('box', 10) + '<span class="tg-tag-t">' + esc(th.title) + '</span></span>' +
          (st ? '<span class="tg-tag st">' + esc(st.title) + '</span>' : '') + '</span>' +
      '</span>' +
    '</button>';
  }

  function renderThreads(view) {
    var threads = buildThreads();
    if (!threads.length) {
      view.innerHTML = inboxBlank('<div class="tg-blank-ic">' + ic('chat', 26) + '</div>' +
        '<div style="font-weight:700;color:var(--ink)">Пока нет обсуждений</div>' +
        '<div style="max-width:400px;text-align:center;line-height:1.55">Комментарии к задачам клиентов из блока «Поступление» собираются здесь — как переписка в чате. Откройте карточку клиента, задачу и напишите первое сообщение.</div>');
      bindInboxSwitch(view);
      return;
    }
    if (!state.threadSel || !threads.some(function (t) { return t.leadId === state.threadSel.id && t.taskId === state.threadSel.tid; })) {
      state.threadSel = { id: threads[0].leadId, tid: threads[0].taskId };
    }
    var selFn = function (t) { return state.threadSel && state.threadSel.id === t.leadId && state.threadSel.tid === t.taskId; };
    var waitN = threads.filter(function (t) { return t.wait; }).length;
    var rows = threads.map(function (t) { return threadRow(t, selFn(t)); }).join('');
    view.innerHTML =
      '<div class="tg th-tg show-chat" id="th-tg">' +
        '<aside class="tg-list">' + inboxSwitch() +
          (waitN ? '' : '<div class="th-lhead"><span class="th-lh-all">' + ic('check', 12) + 'все на связи</span></div>') +
          '<div class="tg-search"><span class="searchwrap">' + ic('leads', 15) +
            '<input id="th-q" class="search" type="search" placeholder="Поиск по клиенту или задаче" autocomplete="off"></span></div>' +
          '<div class="tg-rows" id="th-rows">' + rows + '</div>' +
        '</aside>' +
        '<main class="tg-chat" id="th-chat"></main>' +
      '</div>';

    var qi = el('th-q');
    if (qi) {
      qi.value = state.threadQ || '';
      qi.addEventListener('input', function () {
        state.threadQ = this.value.trim();
        var host = el('th-rows'); if (!host) return;
        var qq = state.threadQ.toLowerCase();
        var f = threads.filter(function (t) {
          return !qq || ((t.name || '') + ' ' + (t.title || '') + ' ' + (t.last.text || '')).toLowerCase().indexOf(qq) !== -1;
        });
        host.innerHTML = f.length ? f.map(function (t) { return threadRow(t, selFn(t)); }).join('') : '<div class="tg-empty-list">Ничего не найдено</div>';
        bindThreadRows(host);
      });
    }
    bindInboxSwitch(view);
    bindThreadRows(el('th-rows'));
    renderThreadChat();
  }

  function bindThreadRows(host) {
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('.th-row[data-id]'), function (n) {
      n.addEventListener('click', function () {
        state.threadSel = { id: n.getAttribute('data-id'), tid: n.getAttribute('data-tid') };
        Array.prototype.forEach.call(host.querySelectorAll('.th-row'), function (x) { x.classList.remove('on'); });
        n.classList.add('on'); n.classList.remove('unread');
        var b = n.querySelector('.tg-badge'); if (b) b.remove();
        var tg = el('th-tg'); if (tg) tg.classList.add('show-chat');
        renderThreadChat();
      });
    });
  }

  function renderThreadChat() {
    var host = el('th-chat'); if (!host) return;
    var seld = state.threadSel;
    if (!seld) { host.innerHTML = '<div class="tg-blank"><div class="tg-blank-ic">' + ic('chat', 26) + '</div><div>Выберите обсуждение слева</div></div>'; return; }
    var l = findLead(seld.id);
    var t = l ? rmTasks(seld.id).filter(function (x) { return x.id === seld.tid; })[0] : null;
    if (!t) { host.innerHTML = '<div class="tg-blank"><div class="tg-blank-ic">' + ic('chat', 26) + '</div><div>Обсуждение не найдено</div></div>'; return; }
    var st = ADMISSION_STAGES.filter(function (s) { return s.key === t.stage; })[0];
    var sm = RM_STATUS[t.status] || RM_STATUS.wait;
    var isClient = t.owner === 'client';
    var statusChip = '<span class="rm-status st-' + t.status + '">' + (t.status === 'review' ? '<i class="rm-pulse"></i>' : '') + sm.label + '</span>';
    host.innerHTML =
      '<div class="th-chat-in" data-chat="' + esc(t.id) + '">' +
        // шапка чата — та же конструкция, что у «Диалогов» (.tg-chead / .tg-ci)
        '<div class="tg-chead th-chead">' +
          '<button class="tg-back th-back" title="К списку">' + ic('go', 16) + '</button>' +
          '<span class="tg-ava sm" style="--c:#2F6BFF">' + esc(initials(leadName(l))) + '</span>' +
          '<div class="tg-ci">' +
            '<div class="tg-cn">' + esc(t.title) + '</div>' +
            '<div class="tg-cs"><b>' + esc(leadName(l)) + '</b>' +
              '<span class="rm-who-t' + (isClient ? ' cl' : '') + '">' + (isClient ? 'клиент' : 'мы') + '</span>' +
              (st ? '<span class="th-cstage">' + esc(st.title) + '</span>' : '') + '</div>' +
          '</div>' +
          statusChip +
          '<button class="th-open" id="th-open" title="Открыть карточку клиента">' + ic('ext', 14) + '<span>Карточка</span></button>' +
        '</div>' +
        '<div class="tg-thread th-scroll">' + buildThreadFromComments(t.comments || []) + '</div>' +
        '<div class="th-foot">' + rmComposerHtml() + '</div>' +
      '</div>';
    var sc = host.querySelector('.th-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
    bindCmtComposer(host, seld.id, seld.tid);
    var inp = host.querySelector('.rm-cmt-in'); if (inp) inp.focus();
    var back = host.querySelector('.tg-back'); if (back) back.addEventListener('click', function () { var tg = el('th-tg'); if (tg) tg.classList.remove('show-chat'); });
    var op = el('th-open'); if (op) op.addEventListener('click', function () { openDrawer(seld.id); setModalSection('admission'); });
  }

  /* тип ответа задачи: явное поле submit, для старых задач — вывод из attach[];
     без attach решаем по тексту (та же эвристика, что plans._task_submit_kind на
     бэке — иначе CRM показывала бы «файл» там, где ученик видит «без сдачи») */
  var RM_SUBMIT_RU = { file: 'файл', text: 'текст', both: 'файл + текст', none: 'без сдачи' };
  var RM_DOC_WORDS = /загруз|прикреп|скан|фото|справк|сертификат|паспорт|аттестат|диплом|документ|перевод|письм|эссе|резюме|портфолио|выписк|согласи|апостил/i;
  function rmSubmitKind(t) {
    if (RM_SUBMIT_RU[t.submit]) return t.submit;
    var attach = t.attach || [];
    var hasFile = attach.some(function (a) { return a === 'photo' || a === 'file' || a === 'link'; });
    var hasText = attach.indexOf('text') !== -1;
    if (hasFile && hasText) return 'both';
    if (hasFile) return 'file';
    if (hasText) return 'text';
    return RM_DOC_WORDS.test((t.title || '') + ' ' + (t.need || '')) ? 'file' : 'none';
  }

  function rmTaskRow(t) {
    var sm = RM_STATUS[t.status] || RM_STATUS.wait;
    var isClient = t.owner === 'client';
    var open = !!RM_OPEN[t.id];
    var attach = t.attach || [], subs = t.subs || [], comments = t.comments || [];

    var done = t.status === 'done';
    /* мета-строка под названием: владелец · тип ответа · счётчики (тихо) */
    var bits = ['<span class="rm-who-t">' + (isClient ? 'клиент' : 'мы') + '</span>'];
    if (isClient) {
      var subKind = rmSubmitKind(t);
      if (subKind !== 'none') bits.push('<span class="rm-need-mini">' + RM_SUBMIT_RU[subKind] + '</span>');
    }
    if (subs.length) bits.push('<span class="rm-cnt-mini hl">' + ic('clip', 11) + subs.length + ' прислал' + (subs.length > 1 ? 'и' : '') + '</span>');
    if (comments.length) bits.push('<span class="rm-cnt-mini">' + ic('chat', 11) + comments.length + '</span>');
    var meta = '<div class="rm-sub-line">' + bits.join('<span class="rm-meta-sep"></span>') + '</div>';

    /* дедлайн-чип: тихий по умолчанию, подсветка «скоро» (≤7 дней) и «просрочено» */
    var dueChip = '';
    if (t.due && !done) {
      var dst = t.due < todayISO(0) ? 'over' : (t.due <= todayISO(7) ? 'soon' : 'ok');
      dueChip = '<span class="rm-due ' + dst + '">' + ic('clock', 11) + fmtDue(t.due) + '</span>';
    }
    /* статус-чип: готовые — без чипа (галочка и так всё говорит), «на проверке» — якорь */
    var statusChip = done ? '' : '<span class="rm-status st-' + t.status + '">' +
      (t.status === 'review' ? '<i class="rm-pulse"></i>' : '') + sm.label + '</span>';

    var head = '<div class="rm-task-head">' +
      '<button class="rm-ck" title="Отметить готовым">' + (done ? ic('check', 12) : '') + '</button>' +
      '<div class="rm-tb">' +
        '<div class="rm-title">' + esc(t.title) + '</div>' + meta +
      '</div>' +
      '<div class="rm-side">' + dueChip + statusChip +
        '<span class="rm-exp">' + ic('go', 14) + '</span>' +
      '</div>' +
    '</div>';

    var detail = '';
    if (open) {
      var d = '';
      if (t.need) d += '<div class="rm-dsec"><div class="rm-dh">Описание — его видит ученик</div><div class="rm-need">' + esc(t.need) + '</div></div>';
      // пошаговая инструкция и совет — то, что ученик видит в попапе задачи
      var steps = String(t.how_to || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (steps.length) {
        d += '<div class="rm-dsec"><div class="rm-dh">Как выполнить</div><ol class="rm-howto">' +
          steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
      }
      if (t.tip) d += '<div class="rm-dsec"><div class="rm-dh">Совет ученику</div><div class="rm-need rm-tip">' + esc(t.tip) + '</div></div>';
      if (isClient) {
        // тип ответа: что попап ученика попросит в конце задачи
        var sub = rmSubmitKind(t);
        d += '<div class="rm-dsec"><div class="rm-dh">Ответ ученика</div><div class="rm-submit-seg" data-tid="' + esc(t.id) + '">' +
          [['file', 'Файл'], ['text', 'Текст'], ['both', 'Файл + текст'], ['none', 'Без сдачи']].map(function (o) {
            return '<button class="rm-sub-t' + (sub === o[0] ? ' on' : '') + '" data-sub="' + o[0] + '">' + o[1] + '</button>';
          }).join('') + '</div></div>';
      }
      if (isClient) {
        d += '<div class="rm-dsec"><div class="rm-dh">Прислал клиент' + (subs.length ? ' <span class="rm-dh-n">' + subs.length + '</span>' : '') + '</div>' +
          (subs.length ? '<div class="rm-subs">' + subs.map(rmSubCard).join('') + '</div>'
                       : '<div class="rm-subs-empty">' + ic('clip', 13) + 'Пока ничего не прислал</div>') + '</div>';
      }
      if (t.status === 'review') {
        d += '<div class="rm-review-act">' +
          '<button class="bp sm rm-accept">' + ic('check', 13) + 'Принять</button>' +
          '<button class="rm-return">' + ic('refresh', 13) + 'Вернуть на доработку</button></div>' +
          '<div class="rm-ret-box" hidden><input class="rm-ret-in" placeholder="Что поправить — клиент увидит это" autocomplete="off"><button class="bp sm rm-ret-send">' + ic('send', 13) + 'Вернуть</button></div>';
      }
      var lastC = comments.length ? comments[comments.length - 1] : null;
      var prevTxt = lastC ? (lastC.text || (lastC.atts && lastC.atts.length ? 'вложение' : '')) : '';
      d += '<button class="rm-discuss" data-discuss="' + esc(t.id) + '">' +
        '<span class="rm-discuss-ic">' + ic('chat', 16) + '</span>' +
        '<span class="rm-discuss-main">' +
          '<span class="rm-discuss-t">Обсуждение' + (comments.length ? ' <span class="num">' + comments.length + '</span>' : '') + '</span>' +
          '<span class="rm-discuss-prev">' + (lastC ? esc((lastC.by === 'client' ? 'Клиент' : 'Куратор') + ': ' + prevTxt)
                                                   : 'Открыть чат по задаче — фото и документы тоже можно') + '</span>' +
        '</span>' +
        '<span class="rm-discuss-go">' + ic('go', 15) + '</span>' +
      '</button>';

      d += '<div class="rm-dfoot"><button class="rm-del">' + ic('x', 12) + 'Убрать задачу</button></div>';
      detail = '<div class="rm-detail">' + d + '</div>';
    }

    return '<div class="rm-task o-' + t.owner + ' st-' + t.status + (open ? ' open' : '') +
      (RM_FLASH[t.id] ? ' rm-flash' : '') + '" data-tid="' + esc(t.id) + '">' + head + detail + '</div>';
  }

  function buildAdmissionSection(ctx) {
    var id = state.drawerId;
    var tasks = rmTasks(id);
    var byStage = {};
    tasks.forEach(function (t) { (byStage[t.stage] = byStage[t.stage] || []).push(t); });
    var totalDone = tasks.filter(function (t) { return t.status === 'done'; }).length;
    var reviewN = tasks.filter(function (t) { return t.status === 'review'; }).length;
    var pct = tasks.length ? Math.round(totalDone / tasks.length * 100) : 0;

    var html = '<div class="m-ctitle">Поступление в Китай</div>' +
      '<div class="m-csub">Путь клиента по этапам: что делает он, что делаем мы. Раскрой задачу — увидишь присланное, примешь или вернешь, оставишь комментарий.</div>';

    html += '<div class="rm-summary">' +
      '<div class="rm-sum-main">' +
        '<div class="rm-sum-figure"><b class="num">' + totalDone + '</b><span class="num">/' + tasks.length + '</span></div>' +
        '<div class="rm-sum-meta">' +
          '<div class="rm-sum-l">задач готово</div>' +
          '<div class="rm-prog-bar"><i style="width:' + pct + '%"></i></div>' +
        '</div>' +
      '</div>' +
      (reviewN
        ? '<button class="rm-review-cta" data-rmreview title="Перейти к первой задаче на проверке">' + ic('bell', 14) + '<span class="num">' + reviewN + '</span> ждут проверки</button>'
        : '<div class="rm-allclear">' + ic('check', 13) + 'все проверено</div>') +
    '</div>';

    // личные названия/описания этапов от AI (то, что видит ученик) поверх словаря
    var stMeta = (state.planStatus[id] && state.planStatus[id].meta) || {};
    html += '<div class="rm-flow">';
    ADMISSION_STAGES.forEach(function (st) {
      var meta = stMeta[st.key] || {};
      var list = byStage[st.key] || [];
      var doneN = list.filter(function (t) { return t.status === 'done'; }).length;
      var hasReview = list.some(function (t) { return t.status === 'review'; });
      var active = list.some(function (t) { return t.status === 'doing' || t.status === 'review'; });
      var allDone = list.length > 0 && doneN === list.length;
      var empty = list.length === 0;
      var scls = allDone ? 'done' : active ? 'cur' : empty ? 'empty' : 'todo';

      var hasClientPreset = st.presets.some(function (p) { return p.o === 'client'; });
      var defOwner = hasClientPreset ? 'client' : 'team';

      var rows = list.map(rmTaskRow).join('');

      var chips = st.presets.map(function (p) {
        return '<button class="rm-chip o-' + p.o + '" data-o="' + p.o + '" data-t="' + esc(p.t) + '"' +
          ' data-need="' + esc(p.need || '') + '" data-at="' + ((p.at || []).join(',')) + '">' + ic('plus', 11) + esc(p.t) + '</button>';
      }).join('');

      // тип ответа новой задачи: то, что попап ученика попросит в конце
      var submitToggle = [['file', 'Файл'], ['text', 'Текст'], ['both', 'Файл + текст'], ['none', 'Без сдачи']]
        .map(function (o, i) {
          return '<button class="rm-at-t' + (i === 0 ? ' on' : '') + '" data-sub="' + o[0] + '">' + o[1] + '</button>';
        }).join('');

      html += '<div class="rm-stage ' + scls + '">' +
        '<div class="rm-rail"><div class="rm-node">' + (allDone ? ic('check', 13) : st.n) + '</div><div class="rm-line"></div></div>' +
        '<div class="rm-body">' +
          '<div class="rm-shead">' +
            '<div class="rm-stitle">' + esc(meta.title || st.title) + (hasReview ? '<span class="rm-shead-dot"></span>' : '') + '</div>' +
            (list.length ? '<div class="rm-scount num">' + doneN + '/' + list.length + '</div>' : '<div class="rm-stag">пусто</div>') +
          '</div>' +
          '<div class="rm-ssub">' + esc(meta.about || st.sub) + '</div>' +
          (st.hint ? '<div class="rm-hint">' + ic('clock', 12) + esc(st.hint) + '</div>' : '') +
          (rows ? '<div class="rm-tasks">' + rows + '</div>' : '') +
          '<button class="rm-add-btn" data-addstage="' + st.key + '">' + ic('plus', 13) + 'Добавить задачу</button>' +
          '<div class="rm-add" data-stage="' + st.key + '" data-o="' + defOwner + '" hidden>' +
            '<div class="rm-add-own">' +
              '<button data-o="client"' + (defOwner === 'client' ? ' class="on"' : '') + '>' + ic('leads', 12) + 'Клиент делает</button>' +
              '<button data-o="team"' + (defOwner === 'team' ? ' class="on"' : '') + '>' + ic('team', 12) + 'Делаем мы</button>' +
            '</div>' +
            (chips ? '<div class="rm-presets">' + chips + '</div>' : '') +
            '<div class="rm-form">' +
              '<input class="rm-f-title" placeholder="Название своей задачи" autocomplete="off">' +
              '<input class="rm-f-need" placeholder="Что нужно сделать — по желанию" autocomplete="off">' +
              '<div class="rm-f-grid">' +
                '<div class="rm-f-cell">' +
                  '<div class="rm-f-l">Ответ клиента</div>' +
                  '<div class="rm-f-attach">' + submitToggle + '</div>' +
                '</div>' +
                '<div class="rm-f-cell rm-f-cell-due">' +
                  '<div class="rm-f-l">Срок <span class="rm-f-opt">по желанию</span></div>' +
                  '<input type="date" class="rm-f-due">' +
                '</div>' +
              '</div>' +
              '<button class="rm-f-add bp sm">' + ic('plus', 13) + 'Добавить задачу</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    return planToolbar(id) + html;
  }

  function openDrawer(id, listIds) {
    state.drawerId = id;
    if (listIds && listIds.length) state.drawerList = listIds;
    state.modalSection = 'main';
    RM_CHAT = null;
    syncHash(id);
    renderDrawer(false);
    el('mbg').classList.add('open');
    el('modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    warm(id);
    if (!state.details[id]) fetchDetail(id, function (got) {
      if (state.drawerId !== id) return;
      if (got) renderDrawer(true);
      // пришли по ссылке на клиента, которого уже нет (или нет прав) — честно скажем
      else if (!findLead(id)) { closeDrawer(); showToast('Клиент не найден — возможно, ссылка устарела'); }
    });
  }
  function closeDrawer() {
    syncHash('');
    state.drawerId = null;
    state.botConvoId = null;
    RM_CHAT = null;
    el('mbg').classList.remove('open');
    el('modal').classList.remove('open');
    document.body.style.overflow = '';
  }
  function drawerStep(delta) {
    var list = state.drawerList || [];
    var i = list.indexOf(state.drawerId);
    if (i === -1) return;
    var next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
    if (next && next !== state.drawerId) {
      state.drawerId = next;
      state.modalSection = 'main';
      RM_CHAT = null;
      syncHash(next);
      renderDrawer(false);
      warm(next);
      if (!state.details[next]) fetchDetail(next, function (got) {
        if (state.drawerId === next && got) renderDrawer(true);
      });
    }
  }
  function setModalSection(s) {
    state.modalSection = s;
    RM_CHAT = null;
    // Открыли «Поступление» — статус публикации всегда свежий с бэка (не кэш).
    if (s === 'admission' && state.drawerId) ensurePlanStatus(state.drawerId, true);
    var nav = el('modal').querySelector('.m-nav');
    if (nav) Array.prototype.forEach.call(nav.children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-s') === s);
    });
    renderModalContent();
  }

  function leadCtx(id) {
    var lead = findLead(id);
    var d = state.details[id] || cacheGet(id);
    if (d) state.details[id] = d;
    var base = d || lead;
    var crm = (lead && lead.crm) || (d && d.crm) || { status: 'new', note: '', tasks: [], comms: [] };
    return { lead: lead, d: d, base: base, crm: crm };
  }

  function renderDrawer(keepScroll) {
    var modal = el('modal');
    var id = state.drawerId;
    if (!modal || !id) return;
    var prevScroll = 0;
    if (keepScroll) { var c0 = modal.querySelector('.m-content'); prevScroll = c0 ? c0.scrollTop : 0; }

    var ctx = leadCtx(id);
    var lead = ctx.lead, d = ctx.d, base = ctx.base, crm = ctx.crm;
    if (!base) {
      // карточку открыли по прямой ссылке — данных ещё нет, ждём ответ бэка
      modal.innerHTML = '<div class="m-navfloat"><button class="m-arrow" id="m-close">' + ic('x', 14) + '</button></div>' +
        '<div class="m-load">Открываем карточку…</div>';
      var mcl = el('m-close');
      if (mcl) mcl.addEventListener('click', closeDrawer);
      return;
    }
    var diag = (d && d.diagnostics) || {};
    var score = lead && lead.score != null ? lead.score : diag.score;
    var tone = score != null ? scoreTone(score) : null;
    var booking = base.booking;
    var risks = lead ? leadRisks(lead) : [];
    var city = (lead && lead.geo && lead.geo.city) || (d && d.geo && d.geo.city);
    var country = (lead && lead.geo && lead.geo.country) || (d && d.geo && d.geo.country);

    var list = state.drawerList || [];
    var pos = list.indexOf(id);

    var nm = ov(ctx, 'name');
    var openTasks = (crm.tasks || []).filter(function (t) { return !t.done; }).length;
    var navHtml = MODAL_SECTIONS.map(function (sct) {
      var extra = '';
      if (sct.id === 'now' && risks.length) extra = '<span class="dotw"></span>';
      else if (sct.id === 'admission') { var rv = rmReviewCount(id); if (rv) extra = '<span class="cnt num warn">' + rv + '</span>'; }
      else if (sct.id === 'det' && lead && lead.det && lead.det.overall != null) extra = '<span class="cnt num">' + lead.det.overall + '</span>';
      else if (sct.id === 'notes' && openTasks) extra = '<span class="cnt num">' + openTasks + '</span>';
      else if (sct.id === 'docs' && d && d.docs && d.docs.length) extra = '<span class="cnt num">' + d.docs.length + '</span>';
      else if (sct.id === 'pay' && d && d.payments && d.payments.length) extra = '<span class="cnt num">' + d.payments.length + '</span>';
      return '<button class="m-ni' + (state.modalSection === sct.id ? ' on' : '') + '" data-s="' + sct.id + '">' +
        ic(sct.icon, 17) + '<span>' + sct.label + '</span>' + extra + '</button>';
    }).join('');

    var subBits = [
      sevPill(lead || { crm: crm, booking: booking }),
      '<span>пришел ' + fmtWhen(base.created_at) + '</span>',
      (pos !== -1 ? '<span>' + (pos + 1) + ' из ' + list.length + '</span>' : ''),
      '<span class="sess">сессия ' + esc(String(id).slice(0, 8)) + '</span>',
    ].filter(Boolean).join('<span class="dot-sep"></span>') +
      '<button class="m-copylink" id="m-link" title="Скопировать ссылку на эту карточку — команда откроет её одним кликом">' +
      ic('copy', 12) + 'Ссылка на клиента</button>';

    // с открытым чатом правок окно шире: доска слева должна остаться читаемой
    modal.classList.toggle('pchat-open', hasSidePanel());

    modal.innerHTML =
      '<div class="m-head">' +
        '<div class="m-navfloat">' +
          '<button class="m-arrow" id="m-prev"' + (pos <= 0 ? ' disabled' : '') + '>' +
            '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 5l-5 5 5 5"/></svg></button>' +
          '<button class="m-arrow" id="m-next"' + (pos === -1 || pos >= list.length - 1 ? ' disabled' : '') + '>' + ic('go', 13) + '</button>' +
          '<button class="m-arrow" id="m-close">' + ic('x', 14) + '</button>' +
        '</div>' +
        '<div class="m-ava">' + esc(initials(nm)) + '</div>' +
        '<div class="m-id">' +
          '<div class="m-name-row">' +
            '<div class="m-name' + (nm ? '' : ' anon') + '" id="m-name" data-raw="' + esc(nm) + '">' + esc(nm || 'Без имени') + '</div>' +
            '<button class="m-edit" id="m-name-edit" title="Изменить имя">' + ic('note', 14) + '</button>' +
          '</div>' +
          '<div class="m-sub">' + subBits + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="m-body">' +
        '<nav class="m-nav">' + navHtml + '</nav>' +
        '<div class="m-content" id="m-content"></div>' +
        '<div id="m-side"></div>' +
      '</div>' +
      '<div class="m-foot">' +
        (crm.hidden
          ? '<button class="m-archive" id="m-unhide" title="Вернуть лида из архива">' + ic('refresh', 14) + 'Вернуть из архива</button>'
          : '<button class="m-archive" id="m-hide" title="Скрыть лида в архив (мягко, данные останутся)">' + ic('x', 14) + 'Скрыть</button>') +
      '</div>';

    el('m-close').addEventListener('click', closeDrawer);
    var hideBtn = el('m-hide');
    if (hideBtn) hideBtn.addEventListener('click', function () {
      if (window.confirm('Скрыть этого лида? Он уйдёт из списков в архив, данные сохранятся — можно вернуть.')) rmHideLead(id, true);
    });
    var unhideBtn = el('m-unhide');
    if (unhideBtn) unhideBtn.addEventListener('click', function () { rmHideLead(id, false); });
    var lnk = el('m-link');
    if (lnk) lnk.addEventListener('click', function () { copyText(leadUrl(id), lnk); });
    var mp = el('m-prev'), mn = el('m-next');
    if (mp) mp.addEventListener('click', function () { drawerStep(-1); });
    if (mn) mn.addEventListener('click', function () { drawerStep(1); });
    Array.prototype.forEach.call(modal.querySelectorAll('.m-ni'), function (b) {
      b.addEventListener('click', function () { setModalSection(b.getAttribute('data-s')); });
    });
    bindInline(el('m-name'), 'name', { big: true, ph: 'Имя клиента' });
    var ne = el('m-name-edit');
    if (ne) ne.addEventListener('click', function () { var n = el('m-name'); if (n) n.click(); });
    renderModalContent();
    if (keepScroll) { var c1 = modal.querySelector('.m-content'); if (c1) c1.scrollTop = prevScroll; }
  }

  function renderModalContent() {
    var host = el('m-content');
    var id = state.drawerId;
    if (!host || !id) return;
    var ctx = leadCtx(id);
    var s = state.modalSection;
    if (s === 'main') host.innerHTML = buildMain(ctx);
    else if (s === 'now') host.innerHTML = buildNow(ctx);
    else if (s === 'dialog') host.innerHTML = buildDialog(ctx);
    else if (s === 'admission') host.innerHTML = buildAdmissionSection(ctx);
    else if (s === 'path') host.innerHTML = buildPathSection(ctx);
    else if (s === 'notes') host.innerHTML = buildNotesSection(ctx);
    else if (s === 'docs') host.innerHTML = ctx.d ? buildDocsSection(ctx) : skeletonSection('docs');
    else if (s === 'pay') host.innerHTML = ctx.d ? buildPaySection(ctx) : skeletonSection('pay');
    else if (s === 'notify') host.innerHTML = buildNotifySection(ctx);
    else if (s === 'ai') host.innerHTML = ctx.d ? buildAiSections(ctx.d) : skeletonSection('ai');
    else if (s === 'det') host.innerHTML = buildDetSection(id);
    else if (s === 'course') host.innerHTML = buildCourseSection(id);
    else if (s === 'offers') host.innerHTML = ctx.d ? buildOffersSection(ctx) : skeletonSection('offers');
    // правый столбец (чат плана / чат витрины) — вместе со сменой секции;
    // модалка под ним шире, поэтому класс тоже переключаем здесь
    var side = el('m-side');
    if (side) side.innerHTML = drawerChatPanel(id);
    var mdl = el('modal');
    if (mdl) mdl.classList.toggle('pchat-open', hasSidePanel());
    attachContentHandlers(id, ctx);
    if (s === 'admission') { ensurePlanStatus(id); wirePlanToolbar(id); }
    if (s === 'offers' && ctx.d) {
      wireOffersSection(id);
      // чат витрины всегда открыт рядом — как чат плана у доски
      loadOffersChat(id);
      bindOffersChat(id);
    }
    animBars(host);
    syncRmChat(id);
  }
  function skeletonSection(kind) {
    var head = { docs: ['Документы', 'Собираю файлы клиента'],
                 pay: ['Оплаты', 'Считаю платежи'],
                 offers: ['Витрина', 'Поднимаю каталог продуктов'],
                 det: ['Английский', 'Поднимаю тест DET'],
                 course: ['Китайский', 'Смотрю доступ к курсу'],
                 ai: ['Разбор AI', 'Поднимаю диагностику с платформы'] }[kind] || ['Загрузка', ''];
    var body;
    if (kind === 'ai') {
      body = '<div class="sk tall"></div>' +
        '<div class="sk-rows"><div class="sk row"></div><div class="sk row"></div></div>' +
        '<div class="sk w35" style="margin-top:20px"></div>' +
        '<div class="sk w90"></div><div class="sk w75"></div><div class="sk w55"></div>';
    } else {
      body = '<div class="sk-rows"><div class="sk row"></div><div class="sk row"></div></div>' +
        '<div class="sk tall" style="margin-top:16px"></div>';
    }
    return '<div class="m-ctitle">' + head[0] + '</div>' +
      (head[1] ? '<div class="m-csub">' + head[1] + '</div>' : '') + body;
  }

  /* ── РАЗДЕЛ «Английский»: входной тест DET, пересдачи, доступ ──
     Балл считает бэкенд (шкала 10-160), тут только показываем и открываем доступ.
     Тест бесплатный и один раз: повтор и тренажеры включает сотрудник тумблером. */
  var DET = {};          // id лида -> блок с бэка
  var DET_BUSY = {};     // id лида -> идет загрузка
  var DET_ITEM = {};     // id попытки -> разбор заданий
  var DET_SHOW = null;   // какая попытка раскрыта

  var DET_KIND = { entry: 'входной', progress: 'пересдача', final: 'итоговый' };
  var DET_SKILLS = [['reading', 'Чтение'], ['listening', 'Аудирование'],
                    ['writing', 'Письмо'], ['speaking', 'Речь']];

  /* Что балл значит для продажи. Пороги — наша внутренняя шкала, не правило вуза:
     менеджеру нужен ответ «что предлагать», а не голое число. */
  function detVerdict(v) {
    if (v == null) return { cls: '', t: 'Балл еще не посчитан' };
    if (v <= 55) return { cls: 'bad', t: 'Начальный уровень — до подачи нужен курс с преподавателем' };
    if (v < 95) return { cls: 'warn', t: 'Ниже порога большинства программ — предлагай подготовку' };
    if (v < 115) return { cls: 'warn', t: 'Почти порог — небольшая подготовка закроет разрыв' };
    return { cls: 'good', t: 'Уверенный уровень — подготовка нужна только под конкретный вуз' };
  }

  function loadDet(id, force) {
    if (DET_BUSY[id]) return;
    if (force) delete DET[id];
    DET_BUSY[id] = true;
    api('/admin/api/leads/' + id + '/det').then(function (r) {
      DET_BUSY[id] = false; DET[id] = r;
      if (state.drawerId === id && state.modalSection === 'det') renderModalContent();
    }).catch(function (e) {
      DET_BUSY[id] = false;
      if (e.message !== '403') { DET[id] = 'none'; if (state.drawerId === id) renderModalContent(); }
    });
  }

  function detDelta(v) {
    if (v == null || !v) return '';
    var up = v > 0;
    return '<span class="det-delta' + (up ? ' up' : ' down') + '">' + (up ? '+' : '') + v + '</span>';
  }

  /* Чего в балле еще не хватает. Письмо и речь сначала проверяет модель, и менеджер
     должен видеть разницу: балл от модели можно оспорить, балл преподавателя — нет. */
  var DET_SKILL_RU = { writing: 'сочинение', speaking: 'устный ответ' };

  function detPartial(a) {
    var g = a.graded_by || {};
    var wait = [], byAi = [];
    ['writing', 'speaking'].forEach(function (s) {
      if (!g[s]) wait.push(DET_SKILL_RU[s]);
      else if (g[s] === 'ai') byAi.push(DET_SKILL_RU[s]);
    });
    if (wait.length) return 'Балл неполный — ' + wait.join(' и ') + ' еще не проверены';
    if (byAi.length) return 'Проверила модель: ' + byAi.join(' и ') + ' — можете поправить балл';
    return '';
  }

  function detWho(a) {
    var by = String(a.scored_by || '');
    if (!by) return '';
    return by.indexOf('ai:') === 0 ? ' · первым проверила модель'
      : ' · проверил ' + esc(by.replace('teacher:', ''));
  }

  /* Кто ведет ученика по английскому. Преподаватель видит в своем разделе ТОЛЬКО тех,
     кого ему сюда назначили, — поэтому пустое поле значит «этот ученик не виден никому
     из преподавателей». Список ролей ограничен: менеджера в преподаватели не поставить. */
  var DET_TEACHERS = null;
  function detTeacherRow(t) {
    return '<div class="det-lbl det-linkh">Преподаватель по английскому</div>' +
      '<div class="det-teacher"><select class="tm-sel" id="det-teacher">' +
        '<option value="">не назначен</option>' +
        ((DET_TEACHERS || (t ? [t] : [])).map(function (x) {
          return '<option value="' + esc(x.login) + '"' + (t && t.login === x.login ? ' selected' : '') +
            '>' + esc(x.name) + '</option>';
        }).join('')) + '</select>' +
      '<span class="det-teacher-s">' + (t
        ? 'закреплен за учеником: разбирает его занятия и проверяет тесты'
        : 'пока не назначен — занятия ученика не видит ни один преподаватель') + '</span></div>';
  }

  /* Занятия в тренажерах. Разбор каждого задания — дело преподавателя, здесь ответ на
     один вопрос: человек занимается или ссылку открыл и бросил. Поэтому четыре цифры,
     полоска по дням и распределение по навыкам, без таблиц. */
  function detPractice(pr, opts) {
    if (!pr.total) return '';
    opts = opts || {};
    var DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    // Фронт может приехать раньше бэка: старый ответ без разбивки — показываем цифры.
    var days = (pr.by_day || []).map(function (d) {
      var dt = new Date(d.date + 'T12:00:00');
      return '<div class="det-day' + (d.n ? ' on' : '') + '" title="' + esc(d.date) + '">' +
        '<b>' + (d.n || '·') + '</b><i>' + (isNaN(dt) ? '' : DOW[dt.getDay()]) + '</i></div>';
    }).join('');
    var top = (pr.by_skill || []).reduce(function (m, s) { return Math.max(m, s.n); }, 0) || 1;
    var skills = (pr.by_skill || []).map(function (s) {
      var weak = s.accuracy_pct != null && s.accuracy_pct < 60;
      return '<div class="det-skl"><div class="det-skl-t">' + esc(s.label) + '</div>' +
        '<div class="det-skl-b"><i style="width:' + Math.round(s.n * 100 / top) + '%"></i></div>' +
        '<div class="det-skl-v' + (weak ? ' warn' : '') + '">' + s.n +
          (s.accuracy_pct != null ? ' · <b>' + s.accuracy_pct + '%</b>' : '') + '</div></div>';
    }).join('');
    return '<div class="m-sec"><div class="m-sec-h">Занятия в тренажерах</div>' +
      '<div class="pay-board det-board">' +
        '<div class="pay-cell"><div class="pc-l">Заданий</div><div class="pc-v num">' + pr.total + '</div></div>' +
        '<div class="pay-cell' + (pr.week ? '' : ' muted') + '"><div class="pc-l">За неделю</div>' +
          '<div class="pc-v num">' + (pr.week || 0) + '</div></div>' +
        '<div class="pay-cell' + (pr.accuracy_pct == null ? ' muted' : '') + '"><div class="pc-l">Верно</div>' +
          '<div class="pc-v num">' + (pr.accuracy_pct == null ? '—' : pr.accuracy_pct + '%') + '</div></div>' +
        '<div class="pay-cell"><div class="pc-l">Дней</div><div class="pc-v num">' + (pr.days || 0) + '</div></div>' +
      '</div>' +
      '<div class="det-lbl det-prl">Две недели по дням</div><div class="det-days">' + days + '</div>' +
      (skills && !opts.noSkills ? '<div class="det-lbl det-prl">По навыкам</div>' + skills : '') +
      (pr.last_at ? '<div class="det-pr det-prl">последний раз ' + esc(ago(pr.last_at)) + ' назад</div>' : '') +
      '</div>';
  }

  function detAttemptRow(a, prev) {
    var d = (a.overall != null && prev != null) ? a.overall - prev : null;
    var when = a.finished_at || a.started_at;
    var st = a.status === 'scored' ? '<span class="sev s-client">проверен</span>'
      : a.status === 'submitted' ? '<span class="sev s-wait">ждет проверки</span>'
      : a.status === 'in_progress' ? '<span class="sev s-new">проходит сейчас</span>'
      : '<span class="sev s-rejected">брошен</span>';
    return '<div class="det-row' + (DET_SHOW === a.id ? ' open' : '') + '" role="button" tabindex="0" data-det="' + esc(a.id) + '">' +
      '<span class="det-row-v num">' + (a.overall != null ? a.overall : '—') + '</span>' +
      '<div class="det-row-b"><div class="det-row-t">' + (DET_KIND[a.kind] || a.kind) + ' тест ' + st + '</div>' +
        '<div class="det-row-m">' + esc(fmtWhen(when)) + detWho(a) + '</div></div>' +
      detDelta(d) + '<span class="det-row-go">' + ic('go', 13) + '</span></div>' +
      (DET_SHOW === a.id ? '<div class="det-detail" id="det-detail">' + detDetailHtml(a) + '</div>' : '');
  }

  function detDetailHtml(a) {
    var det = DET_ITEM[a.id];
    if (!det) return '<div class="field-empty">Открываю разбор…</div>';
    var open = det.items.filter(function (i) { return i.type_code === 'writing_prompt' || i.type_code === 'speaking_prompt'; });
    var auto = det.items.filter(function (i) { return open.indexOf(i) === -1; });
    var right = auto.filter(function (i) { return i.score >= 0.999; }).length;

    var marks = auto.map(function (i) {
      var cls = i.score == null ? 'skip' : (i.score >= 0.999 ? 'ok' : (i.score > 0 ? 'part' : 'bad'));
      return '<span class="det-mark ' + cls + '" title="' + esc(i.skill_tag) + ', сложность ' + i.band + '">' + (i.idx + 1) + '</span>';
    }).join('');

    var openHtml = open.map(function (i) {
      var text = (i.response && i.response.text) || '';
      var audio = i.doc_id
        ? '<a class="bp ghost sm" target="_blank" rel="noopener" href="' + API + '/admin/api/docs/' + i.doc_id +
          '/download?k=' + encodeURIComponent(getKey()) + '">' + ic('play', 13) + 'Послушать ответ</a>'
        : '';
      var task = (i.payload && (i.payload.prompt || i.payload.question || i.payload.text)) || '';
      return '<div class="det-open">' +
        '<div class="det-open-h">' + (i.type_code === 'writing_prompt' ? 'Письмо' : 'Речь') +
          '<i>сложность ' + i.band + '</i></div>' +
        (task ? '<div class="det-open-q">' + esc(task) + '</div>' : '') +
        (text ? '<div class="det-open-a">' + esc(text) + '</div>' : (audio ? '' : '<div class="det-open-a muted">Ответа нет</div>')) +
        audio + '</div>';
    }).join('');

    // Разбор модели: по нему преподаватель либо соглашается, либо ставит свой балл.
    var aiHtml = [['writing', det.ai, 'Сочинение проверила модель'],
                  ['speaking', det.ai_speaking, 'Устный ответ проверила модель']]
      .map(function (b) {
        var ai = b[1];
        if (!ai || !ai.criteria) return '';
        var teacherSet = (a.graded_by || {})[b[0]] === 'teacher';
        return '<div class="det-ai' + (teacherSet ? ' old' : '') + '">' +
          '<div class="det-ai-h">' + ic('spark', 13) +
            (teacherSet ? 'Что говорила модель про ' + DET_SKILL_RU[b[0]] + ' (балл уже ваш)' : b[2]) +
            (ai.cefr ? '<i>уровень ' + esc(ai.cefr) + '</i>' : '') + '</div>' +
          '<div class="det-ai-c">' + ai.criteria.map(function (c) {
            return '<div class="det-ai-r"><span class="det-ai-t">' + esc(c.title || c.code) + '</span>' +
              '<span class="det-ai-v num">' + c.score + '</span>' +
              (c.note ? '<span class="det-ai-n">' + esc(c.note) + '</span>' : '') + '</div>';
          }).join('') + '</div>' +
          (ai.summary ? '<div class="det-ai-s">' + esc(ai.summary) + '</div>' : '') +
          (ai.growth ? '<div class="det-ai-s muted">' + esc(ai.growth) + '</div>' : '') +
          // Расшифровка речи — чтобы не переслушивать запись ради одной фразы. Ученику
          // ее не показываем: спорить с тем, как машина расслышала, тут не о чем.
          (ai.transcript ? '<div class="det-ai-tr">' + esc(ai.transcript) + '</div>' : '') +
          (ai.flags && ai.flags.length ? '<div class="det-ai-f">' + esc(ai.flags.join(', ')) + '</div>' : '') +
          '</div>';
      }).join('');

    var form = '';
    if (can('students') && a.status !== 'in_progress') {
      var m = det.attempt;
      // Перепроверяем только то, что человек еще не оценил сам: свой балл модель не трогает.
      var g = a.graded_by || {};
      var canRegrade = ['writing', 'speaking'].filter(function (s) { return g[s] !== 'teacher'; });
      var regrade = !canRegrade.length ? ''
        : '<button class="bp ghost sm" id="det-regrade" data-aid="' + esc(a.id) + '">' + ic('spark', 13) +
          (canRegrade.some(function (s) { return g[s] === 'ai'; }) ? 'Перепроверить моделью' : 'Проверить моделью') +
          '</button>';
      form = '<div class="det-grade">' +
        '<div class="det-lbl">Балл за письмо и речь</div>' +
        '<div class="det-grade-r">' +
          '<label>Письмо<input class="al-in det-gi" id="det-gw" inputmode="numeric" placeholder="10-160" value="' +
            (m.writing != null ? m.writing : '') + '"></label>' +
          '<label>Речь<input class="al-in det-gi" id="det-gs" inputmode="numeric" placeholder="10-160" value="' +
            (m.speaking != null ? m.speaking : '') + '"></label>' +
          '<button class="bp sm" id="det-gsave" data-aid="' + esc(a.id) + '">' + ic('check', 13) + 'Сохранить</button>' +
          regrade +
        '</div>' +
        '<div class="det-grade-hint">Шкала 10-160, шагом 5. Ученик себе балл не ставит — только вы. ' +
          (['writing', 'speaking'].some(function (s) { return g[s] === 'ai'; })
            ? 'Где балл поставила модель, он уже стоит в поле — сохраните, если согласны, или впишите свой.'
            : '') + '</div></div>';
    }

    return '<div class="det-lbl">Задания с автопроверкой · ' + right + ' из ' + auto.length + ' верно</div>' +
      '<div class="det-marks">' + marks + '</div>' + openHtml + aiHtml + form;
  }

  function buildDetSection(id) {
    var b = DET[id];
    if (!b) { loadDet(id); return skeletonSection('det'); }
    if (b === 'none') {
      return '<div class="m-ctitle">Английский</div>' +
        '<div class="m-csub">Не удалось загрузить тест. Обновите страницу.</div>';
    }
    var head = '<div class="m-ctitle">Английский</div>' +
      '<div class="m-csub">Входной тест DET по шкале 10-160: чтение и аудирование считает сервер, сочинение и устный ответ сначала проверяет модель, а вы можете поправить ее балл. Тест бесплатный и проходится один раз — повтор открываете вы.</div>';

    var latest = b.latest;
    // Пока оценены не все навыки, балл неполный. Вердикт цветом тут не даем: менеджер
    // прочитает «начальный уровень» как приговор, а это еще не весь тест.
    var partialText = latest ? detPartial(latest) : '';
    var partial = !!partialText;
    var hero;
    if (!latest) {
      hero = '<div class="det-hero empty">' +
        '<div class="det-hero-ic">' + ic('globe', 20) + '</div>' +
        '<div><div class="det-empty-t">Тест еще не проходили</div>' +
        '<div class="det-empty-s">Выдайте ссылку — результат придет сюда сам, и будет видно, что предлагать.</div></div></div>';
    } else {
      var vd = detVerdict(latest.overall);
      hero = '<div class="det-hero">' +
        '<div class="det-score"><span class="det-num num">' + (latest.overall != null ? latest.overall : '—') + '</span>' +
          '<span class="det-scale">из 160</span></div>' +
        '<div class="det-hero-b">' +
          (partial
            ? '<div class="det-partial">' + ic('clock', 13) + esc(partialText) + '</div>' +
              '<div class="det-verdict muted">' + vd.t + '</div>'
            : '<div class="det-verdict ' + vd.cls + '">' + vd.t + '</div>') +
          '<div class="det-hero-m">' + esc(fmtWhen(latest.finished_at || latest.started_at)) +
            (b.delta ? ' · к прошлому ' + detDelta(b.delta) : '') + '</div>' +
          (b.note ? '<div class="det-note">' + esc(b.note) + '</div>' : '') +
        '</div></div>' +
        '<div class="pay-board det-board">' + DET_SKILLS.map(function (s) {
          var v = latest[s[0]];
          return '<div class="pay-cell' + (v == null ? ' muted' : '') + '">' +
            '<div class="pc-l">' + s[1] + '</div>' +
            '<div class="pc-v num">' + (v == null ? '—' : v) + '</div></div>';
        }).join('') + '</div>';
    }

    var attempts = (b.attempts || []).slice().reverse();
    var prevOf = {};
    var scored = (b.attempts || []).filter(function (a) { return a.overall != null; });
    scored.forEach(function (a, i) { if (i) prevOf[a.id] = scored[i - 1].overall; });
    var rows = attempts.length
      ? attempts.map(function (a) { return detAttemptRow(a, prevOf[a.id]); }).join('')
      : '<div class="field-empty">Попыток пока нет</div>';

    var acc = b.access || {};
    var inv = b.invite;
    // Синим — то, что делают каждый раз. «Новая ссылка» обесценивает уже выданную,
    // поэтому primary она получает только когда ссылки еще нет.
    var link = '<div class="det-link">' +
      (inv
        ? '<input class="al-in det-url" id="det-url" readonly value="' + esc(inv.url) + '">' +
          '<button class="bp sm" id="det-copy">' + ic('copy', 13) + 'Скопировать</button>' +
          '<button class="bp ghost sm" id="det-newlink">' + ic('plus', 13) + 'Новая ссылка</button>'
        : '<span class="det-link-none">Ссылки нет — создайте, и отправьте ее человеку</span>' +
          '<button class="bp sm" id="det-newlink">' + ic('plus', 13) + 'Создать ссылку</button>') +
      '</div>' +
      (inv ? '<div class="det-link-m">' + (inv.used_count >= inv.max_uses ? 'по ссылке уже прошли' : 'ссылка активна') +
        ' · до ' + esc(fmtWhen(inv.expires_at)) + '</div>' : '');

    var access = '<div class="m-sec"><div class="m-sec-h">Доступ</div>' +
      '<div class="det-sw-row">' +
        '<div class="det-sw-b"><div class="det-sw-t">Разрешить повторный тест</div>' +
          '<div class="det-sw-s">' + (acc.attempts_used
            ? 'Попыток пройдено: ' + acc.attempts_used + '. Разрешение одноразовое — уйдет на следующий тест.'
            : 'Первый тест человек проходит сам, разрешение не нужно.') + '</div></div>' +
        '<button type="button" class="pd-sw' + (acc.retakes > 0 ? ' on' : '') + '" id="det-sw-retake">' +
          '<span class="pd-sw-l">' + (acc.retakes > 0 ? 'Разрешен' : 'Закрыт') + '</span>' +
          '<span class="pd-sw-t"><span class="pd-sw-k"></span></span></button></div>' +
      '<div class="det-sw-row">' +
        '<div class="det-sw-b"><div class="det-sw-t">Открыть тренажеры</div>' +
          '<div class="det-sw-s">Тренировки на платформе между тестами. Пока закрыты, занятия ученика ' +
            'в карточку не попадают — откройте после оплаты, и здесь будет видно, как он занимается.</div></div>' +
        '<button type="button" class="pd-sw' + (acc.practice_open ? ' on' : '') + '" id="det-sw-practice">' +
          '<span class="pd-sw-l">' + (acc.practice_open ? 'Открыты' : 'Закрыты') + '</span>' +
          '<span class="pd-sw-t"><span class="pd-sw-k"></span></span></button></div>' +
      (acc.updated_by ? '<div class="det-sw-by">последним менял ' + esc(acc.updated_by) + ' · ' + esc(fmtWhen(acc.updated_at)) + '</div>' : '') +
      detTeacherRow(b.teacher) +
      '<div class="det-lbl det-linkh">Ссылка на тест</div>' + link + '</div>';

    var practice = detPractice(b.practice || {});

    var it = b.intensive;
    var intensive = it
      ? '<div class="m-sec"><div class="m-sec-h">Интенсив DET</div>' +
        '<div class="det-pr">' + (it.has_access ? 'доступ открыт' : 'доступа нет') +
        ' · сдано ' + it.lessons_done + ' ' + plural(it.lessons_done, 'урок', 'урока', 'уроков') +
        (it.avg_pct != null ? ' · в среднем ' + it.avg_pct + '%' : '') +
        (it.last_at ? ' · последний ' + esc(fmtWhen(it.last_at)) : '') + '</div>' +
        '<div class="det-sw-by">свели по телефону — интенсив живет отдельным приложением</div></div>'
      : '';

    return head + hero +
      '<div class="m-sec"><div class="m-sec-h">Попытки' +
        '<span class="hr" id="det-refresh">' + ic('refresh', 12) + 'обновить</span></div>' + rows + '</div>' +
      access + practice + intensive;
  }

  /* ── РАЗДЕЛ «Китайский»: доступ к курсу «Живой китайский» в записи ──
     Близнец блока DET: тот же вопрос менеджера — «что у человека открыто» — и та же
     кнопка на том же месте. Курс живет по личной ссылке, аккаунт платформы для него
     не нужен, поэтому ссылку показываем прямо здесь: у школьника может не быть почты,
     и доставить ссылку иногда придется руками. Ссылка одноразово выдается бэком в
     ответе на открытие доступа и нигде не хранится — новая выпускается кнопкой. */
  var CRS = {};        // id лида -> состояние с бэка
  var CRS_BUSY = {};   // id лида -> идет загрузка
  var CRS_LINK = {};   // id лида -> свежая ссылка на кабинет (живет до перезагрузки)

  function loadCourse(id, force) {
    if (CRS_BUSY[id]) return;
    if (force) delete CRS[id];
    CRS_BUSY[id] = true;
    api('/admin/api/leads/' + id + '/course').then(function (r) {
      CRS_BUSY[id] = false; CRS[id] = r;
      if (state.drawerId === id && state.modalSection === 'course') renderModalContent();
    }).catch(function (e) {
      CRS_BUSY[id] = false;
      if (e.message !== '403') { CRS[id] = 'none'; if (state.drawerId === id) renderModalContent(); }
    });
  }

  function buildCourseSection(id) {
    var b = CRS[id];
    if (!b) { loadCourse(id); return skeletonSection('course'); }
    if (b === 'none') {
      return '<div class="m-ctitle">Китайский</div>' +
        '<div class="m-csub">Не удалось поднять состояние курса — обновите страницу.</div>' +
        buildHskBlock(id);
    }

    var head = '<div class="m-ctitle">Китайский</div>' +
      '<div class="m-csub">Видеокурс «Живой китайский». Доступ открывается кнопкой на ' +
      '3 месяца: ученик заходит в кабинет по личной ссылке, аккаунт и пароль ему не нужны. ' +
      'Когда срок выйдет, уроки закроются сами.</div>';

    var done = b.done_n || 0;
    var total = b.total_n || 0;
    // Доступ к курсу срочный (3 месяца с открытия). Менеджеру важно видеть не только
    // «открыт/закрыт», но и до какого дня, — иначе он узнает о конце срока от ученика.
    var untilTxt = b.access_until ? dayFull(b.access_until) : '';
    var expired = !b.has_access && !!b.access_until && new Date(b.access_until) < new Date();
    var progress = b.has_access
      ? (done
          ? 'пройдено ' + done + ' из ' + total + ' ' + plural(total, 'урок', 'урока', 'уроков') +
            (b.last_activity ? ' · последний раз ' + esc(ago(b.last_activity)) + ' назад' : '')
          : 'к урокам еще не приступал')
      : expired
        ? 'срок вышел ' + esc(untilTxt) + ' — уроки закрылись сами'
        : 'уроки закрыты';

    var link = CRS_LINK[id];
    var linkRow = '<div class="det-link">' +
      (link
        ? '<input class="al-in det-url" id="crs-url" readonly value="' + esc(link) + '">' +
          '<button class="bp sm" id="crs-copy">' + ic('copy', 13) + 'Скопировать</button>' +
          '<button class="bp ghost sm" id="crs-newlink">' + ic('refresh', 13) + 'Новая ссылка</button>'
        : '<span class="det-link-none">Ссылка выдается при открытии доступа. Потерялась — выпустите новую.</span>' +
          '<button class="bp ghost sm" id="crs-newlink">' + ic('refresh', 13) + 'Новая ссылка</button>') +
      '</div>' +
      '<div class="det-link-m">ссылка личная: по ней открывается кабинет именно этого ученика</div>';

    var access = '<div class="m-sec"><div class="m-sec-h">Доступ' +
        '<span class="hr" id="crs-refresh">' + ic('refresh', 12) + 'обновить</span></div>' +
      '<div class="det-sw-row">' +
        '<div class="det-sw-b"><div class="det-sw-t">Курс «Живой китайский»</div>' +
          '<div class="det-sw-s">' + progress + '</div></div>' +
        '<button type="button" class="pd-sw' + (b.has_access ? ' on' : '') + '" id="crs-sw">' +
          '<span class="pd-sw-l">' + (b.has_access ? 'Открыт' : 'Закрыт') + '</span>' +
          '<span class="pd-sw-t"><span class="pd-sw-k"></span></span></button></div>' +
      (b.has_access && untilTxt
        ? '<div class="det-sw-by">действует до ' + esc(untilTxt) + '</div>'
        : '') +
      (b.opened_by
        ? '<div class="det-sw-by">открыл ' + esc(b.opened_by) + ' · ' + esc(fmtWhen(b.opened_at)) + '</div>'
        : '') +
      (b.has_access ? '<div class="det-lbl det-linkh">Ссылка на уроки</div>' + linkRow : '') +
      '</div>';

    return head + access + buildHskBlock(id);
  }

  /* ── HSK-тренажёр в той же вкладке «Китайский» ──
     Тренажёр китайского открыт по прямой ссылке всем (localStorage, без входа),
     поэтому «доступ» тут — не гейт, а отметка менеджера «я дал этому ученику» плюс
     ссылка под рукой. Флаг живёт в overrides.hsk лида (частичный мердж на бэке),
     отдельная ручка и таблица не нужны. Персонального входа, как у курса и DET,
     пока нет — это отдельная работа. */
  var HSK_LINK = 'https://истсайд.рф/hsk_cabinet.html';
  function buildHskBlock(id) {
    var det = state.details[id];
    var h = (det && det.crm && det.crm.overrides && det.crm.overrides.hsk) || {};
    var on = !!h.open;
    return '<div class="m-sec"><div class="m-sec-h">HSK — тренажёр китайского</div>' +
      '<div class="m-csub">Слова, иероглифы, аудио, пробный тест. Открыт по прямой ссылке ' +
      'всем; тумблер отмечает, что вы дали доступ этому ученику, и держит ссылку под рукой.</div>' +
      '<div class="det-sw-row">' +
        '<div class="det-sw-b"><div class="det-sw-t">Тренажёр HSK</div>' +
          '<div class="det-sw-s">' + (on ? 'вы отметили доступ' : 'доступ не отмечен') + '</div></div>' +
        '<button type="button" class="pd-sw' + (on ? ' on' : '') + '" id="hsk-sw">' +
          '<span class="pd-sw-l">' + (on ? 'Открыт' : 'Закрыт') + '</span>' +
          '<span class="pd-sw-t"><span class="pd-sw-k"></span></span></button></div>' +
      (on && h.by ? '<div class="det-sw-by">отметил ' + esc(h.by) +
        (h.at ? ' · ' + esc(fmtWhen(h.at)) : '') + '</div>' : '') +
      '<div class="det-lbl det-linkh">Ссылка на тренажёр</div>' +
      '<div class="det-link">' +
        '<input class="al-in det-url" id="hsk-url" readonly value="' + esc(HSK_LINK) + '">' +
        '<button class="bp sm" id="hsk-copy">' + ic('copy', 13) + 'Скопировать</button></div>' +
      '<div class="det-link-m">ссылка общая: тренажёр без входа, прогресс хранится ' +
      'у ученика в браузере</div>' +
      '</div>';
  }

  function wireCourse(id) {
    // Пока запрос в пути, кнопки этого блока выключены. Иначе второй клик по
    // переключателю уходит на сервер раньше, чем вернется ответ на первый, — и
    // ученик получает ссылку дважды (сервер такой повтор тоже отбивает).
    var busy = false;
    function lock(on) {
      busy = on;
      ['crs-sw', 'crs-newlink', 'crs-refresh'].forEach(function (bid) {
        var b = el(bid);
        if (b) { b.disabled = on; b.style.opacity = on ? '.55' : ''; }
      });
    }
    function post(body, okMsg) {
      if (busy) return;
      lock(true);
      return api('/admin/api/leads/' + id + '/course/access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(function (r) {
        CRS[id] = r;
        if (r.link) CRS_LINK[id] = r.link;
        // Доступ открыт всегда, а вот доставка могла не дойти: у ученика, которого
        // завели руками, чата с ботом нет. Менеджер должен узнать об этом сразу, а
        // не из того, что ребенок так и не пришел на урок.
        if (okMsg) {
          showToast(body.open && !r.opened_now
            ? okMsg + ' — ученику не дублируем, ссылка в карточке'
            : r.delivered && r.delivered.telegram
              ? okMsg + ' — ссылка ушла ему в чат'
              : okMsg + ' — ссылку отправьте сами, она в карточке');
        }
        renderModalContent();
      }).catch(function (e) {
        if (e.message !== '403') showToast('Не получилось: ' + e.message);
      }).then(function () { lock(false); });
    }

    var lead = findLead(id) || {};
    var payload = { name: lead.name || '', email: lead.email || '' };

    var rf = el('crs-refresh');
    if (rf) rf.addEventListener('click', function () { loadCourse(id, true); });

    var sw = el('crs-sw');
    if (sw) sw.addEventListener('click', function () {
      var on = (CRS[id] || {}).has_access;
      if (on && !confirm('Закрыть ученику доступ к курсу?')) return;
      post({ open: !on, name: payload.name, email: payload.email },
           on ? 'Доступ закрыт' : 'Доступ открыт');
    });

    var cp = el('crs-copy');
    if (cp) cp.addEventListener('click', function () { copyText(CRS_LINK[id] || '', cp); });

    var nl = el('crs-newlink');
    if (nl) nl.addEventListener('click', function () {
      post({ open: true, name: payload.name, email: payload.email }, 'Новая ссылка готова');
    });

    // HSK-тренажёр: тумблер-отметка доступа (флаг в overrides.hsk) + копирование ссылки.
    // Полный overrides шлём целиком, чтобы оптимистичный рендер не потерял имя/контакт.
    var hsw = el('hsk-sw');
    if (hsw) hsw.addEventListener('click', function () {
      var det = state.details[id];
      var ov = Object.assign({}, (det && det.crm && det.crm.overrides) || {});
      var cur = ov.hsk || {};
      var next = !cur.open;
      ov.hsk = next
        ? { open: true, by: state.userName || '', at: new Date().toISOString() }
        : { open: false, by: cur.by || '', at: cur.at || '' };
      patch(id, { overrides: ov }, null, function () {
        if (state.drawerId === id && state.modalSection === 'course') renderModalContent();
      });
      if (state.drawerId === id && state.modalSection === 'course') renderModalContent();
      showToast(next ? 'HSK отмечен доступным' : 'Отметка HSK снята');
    });

    var hcp = el('hsk-copy');
    if (hcp) hcp.addEventListener('click', function () { copyText(HSK_LINK, hcp); });
  }

  /* ── РАЗДЕЛ «Сейчас» ── */
  function nextAction(lead, crm, booking, act, contact) {
    var st = crm.status;
    var write = act ? '<a class="bp sm" target="_blank" rel="noopener" href="' + esc(act.href) + '">' + ic('send', 13) + act.label + '</a>' : '';
    var copy = contact ? '<button class="bp ghost sm" id="nd-copy">' + ic('copy', 13) + 'Скопировать</button>' : '';
    function adv(to, label) { return '<button class="bp sm" data-adv="' + to + '">' + label + '</button>'; }
    if (st === 'new' && booking) return { cls: 'warn', k: 'горячо', t: 'Связаться, пока тёплый', s: 'Оставил заявку на разбор ' + ago(booking.at || lead.created_at) + ' назад. Чем быстрее ответишь — тем выше шанс.', a: write + copy + adv('contacted', 'Связались') };
    if (st === 'new') return { cls: '', k: 'без заявки', t: 'Прошёл диагностику, но не записался', s: 'Можно дожать на бесплатный разбор. ' + (contact ? 'Контакт есть.' : 'Контакта нет — увы.'), a: write + copy };
    if (st === 'contacted') return { cls: '', k: 'в работе', t: 'Договориться о разборе', s: 'На связи — назначь время созвона.', a: write + adv('call_scheduled', 'Созвон назначен') };
    if (st === 'call_scheduled') return { cls: '', k: 'разбор', t: 'Провести разбор' + (booking && booking.slot ? ' · ' + esc(booking.slot) : ''), s: 'После созвона зафиксируй результат.', a: adv('call_done', 'Разбор проведён') };
    if (st === 'call_done') return { cls: '', k: 'предложение', t: 'Отправить предложение', s: 'Подбери под него услуги (вкладка «Разбор AI») и отправь.', a: adv('offer_sent', 'Предложение отправлено') };
    if (st === 'offer_sent') return { cls: 'warn', k: 'дожать', t: 'Дожать до оплаты', s: 'Предложение у него. Не теряй — напомни, ответь на возражения.', a: write + adv('client', 'Стал клиентом') };
    if (st === 'client') return { cls: 'calm', k: 'клиент', t: 'Клиент 🎉', s: 'Оплатил — ведём дальше: документы, оплаты, следующие шаги.', a: '' };
    return { cls: '', k: 'отказ', t: 'Не сложилось', s: 'Можно вернуться позже с другим предложением.', a: adv('new', 'Вернуть в работу') };
  }
  /* строка редактируемого контакта (общая для «Главное» и «Сейчас») */
  function efRow(field, raw, isContact) {
    var a = isContact ? contactAction(raw) : null;
    var inner = raw
      ? (a ? '<a href="' + esc(a.href) + '" target="_blank" rel="noopener">' + esc(raw) + '</a>' : esc(raw))
      : 'добавить';
    return '<div class="ed-field" data-ef="' + field + '">' +
      '<span class="ef-ic">' + ic(field === 'contact' ? 'phone' : field === 'email' ? 'send' : 'pin', 14) + '</span>' +
      '<span class="ef-k">' + (field === 'contact' ? 'Контакт' : field === 'email' ? 'Email' : 'Город') + '</span>' +
      '<span class="ef-v' + (raw ? '' : ' empty') + '" data-edit="' + field + '" data-raw="' + esc(raw) + '">' + inner + '</span>' +
      (raw && isContact ? '<button class="ef-copy" data-copy="' + esc(raw) + '" title="Скопировать">' + ic('copy', 13) + '</button>' : '') +
    '</div>';
  }

  /* ── РАЗДЕЛ «Главное» — вся ключевая инфа о клиенте на одном экране ── */
  function buildMain(ctx) {
    var lead = ctx.lead, d = ctx.d, base = ctx.base, crm = ctx.crm;
    var booking = base.booking;
    var diag = (d && d.diagnostics) || {};
    var score = (lead && lead.score != null) ? lead.score : diag.score;
    var tone = score != null ? scoreTone(score) : null;
    var ans = (d && d.answers) || {};
    var get = function (k) { return (ans[k] != null && ans[k] !== '') ? ans[k] : ((lead && lead[k] != null) ? lead[k] : null); };
    var dirs = (lead && lead.directions) || ans.directions;
    if (Array.isArray(dirs)) dirs = dirs.join(', ');

    var html = '<div class="m-ctitle">О клиенте</div>' +
      '<div class="m-csub">Самое важное: кто это, что заполнил на платформе, на каком он шаге.</div>';

    /* верхняя плашка — статус + балл */
    html += '<div class="main-hero">' +
      '<div class="mh-st">' + sevPill(lead || { crm: crm, booking: booking }) +
        (booking && booking.slot ? '<span class="mh-slot">' + ic('cal', 12) + esc(booking.slot) + '</span>' : '') + '</div>' +
      (tone ? '<div class="mh-score"><b class="num" style="color:' + tone.c + '">' + score + '<small>/100</small></b>' +
        '<span style="color:' + tone.c + '">' + esc(tone.label) + '</span></div>' : '') +
    '</div>';

    /* анкета абитуриента */
    var pairs = [];
    if (dirs) pairs.push(['Направления', dirs]);
    SNAPSHOT.forEach(function (p) { var v = fmtVal(get(p[0])); if (v != null && v !== '') pairs.push([p[1], v]); });
    var profInner = pairs.length
      ? '<div class="ab">' + pairs.map(function (p) {
          return '<div class="r"><span class="k">' + esc(p[0]) + '</span><span class="v">' + esc(p[1]) + '</span></div>';
        }).join('') + '</div>'
      : (d ? '<div class="field-empty">Анкету пока не заполнил.</div>'
           : '<div class="sk-rows"><div class="sk row"></div><div class="sk row"></div></div>');
    html += '<div class="m-sec"><div class="m-sec-h">Анкета абитуриента</div>' + profInner + '</div>';

    /* контакты (редактируемые) */
    var contact = ov(ctx, 'contact'), email = ov(ctx, 'email'), city = ov(ctx, 'city');
    html += '<div class="m-sec"><div class="m-sec-h">Контакты</div><div class="who">' +
      efRow('contact', contact, true) + efRow('email', email, false) + efRow('city', city, false) + '</div></div>';

    /* заявка */
    if (booking) {
      html += '<div class="m-sec"><div class="m-sec-h">Заявка на разбор</div><div class="ab">' +
        (booking.slot ? '<div class="r"><span class="k">Слот</span><span class="v">' + esc(booking.slot) + '</span></div>' : '') +
        '<div class="r"><span class="k">Оставлена</span><span class="v">' + fmtWhen(booking.at || base.created_at) + '</span></div>' +
        (booking.channel ? '<div class="r"><span class="k">Канал</span><span class="v">' + esc(booking.channel) + '</span></div>' : '') +
      '</div></div>';
    }
    return html;
  }

  function buildNow(ctx) {
    var lead = ctx.lead, crm = ctx.crm, base = ctx.base;
    var booking = base.booking;
    var contact = ov(ctx, 'contact');
    var act = contactAction(contact);
    var na = nextAction(lead || { created_at: base.created_at }, crm, booking, act, contact);

    /* 1. ХЕРО — что делать прямо сейчас */
    var html = '<div class="now-do ' + na.cls + '">' +
      '<div class="nd-k">' + na.k + '</div>' +
      '<div class="nd-t">' + na.t + '</div>' +
      (na.s ? '<div class="nd-s">' + na.s + '</div>' : '') +
      (na.a ? '<div class="nd-act">' + na.a + '</div>' : '') +
    '</div>';

    if (booking && booking.slot) {
      html += '<div class="slotchip">' + ic('cal', 13) + 'Разбор назначен: ' + esc(booking.slot) + '</div>';
    }

    /* 2. СТАДИЯ — степпер воронки (поднят выше: это главное действие на экране) */
    var flow = ['new', 'contacted', 'call_scheduled', 'call_done', 'offer_sent', 'client'];
    var isRej = crm.status === 'rejected';
    var curOrder = CRM[crm.status].order;
    var pipe = flow.map(function (s) {
      var o = CRM[s].order;
      var cls = isRej ? '' : (o < curOrder ? 'past' : o === curOrder ? 'cur' : 'next');
      return '<button class="pstep ' + cls + ' s-' + s + '" data-s="' + s + '">' +
        '<span class="pdot"></span><span class="plbl">' + CRM[s].label + '</span></button>';
    }).join('');
    html += '<div class="m-sec stage-sec" id="m-st"><div class="m-sec-h">Стадия в воронке' +
        '<button class="dr-rej hr" data-s="' + (isRej ? 'new' : 'rejected') + '">' + (isRej ? 'Вернуть в работу' : 'Отметить отказ') + '</button></div>' +
      (isRej ? '<div class="rej-banner">' + ic('x', 13) + 'Сейчас в статусе «отказ» — сделка закрыта</div>' : '<div class="pipe">' + pipe + '</div>') +
    '</div>';

    /* 3. КТО ЭТО — редактируемая сводка контактов (компактная) */
    var email = ov(ctx, 'email'), city = ov(ctx, 'city');
    html += '<div class="m-sec"><div class="m-sec-h">Кто это</div>' +
      '<div class="who compact">' + efRow('contact', contact, true) + efRow('email', email, false) + efRow('city', city, false) + '</div></div>';
    return html;
  }

  /* ── ПУТЬ И ИСПОЛЬЗОВАНИЕ ─────────────────────────────────────────────────
     Полная картина клиента на одном экране: где он в воронке и как «дышит»
     (герой-пульс) → чем реально пользуется (сетка панелей: поступление,
     продукты, деньги, документы, диагностика, касания, обучение/бот/семья) →
     как шел по платформе (таймлайн событий). Все из живых данных карточки. */
  function buildPathSection(ctx) {
    var d = ctx.d, base = ctx.base;
    var L = ctx.lead || base;
    var id = state.drawerId;
    if (!state._catalog) fetchCatalog(function () {
      if (state.drawerId === id && state.modalSection === 'path') renderModalContent();
    });
    var html = '<div class="m-ctitle">Путь и использование</div>' +
      '<div class="m-csub">Кто это, как пользуется платформой и где остановился — вся картина на одном экране.</div>';
    html += buildUsageDash(ctx, L);
    html += '<div class="uz-jh"><span>Как шел по платформе</span><i></i></div>';
    html += buildPathTimeline(L, d || null);
    return html;
  }

  /* герой-пульс + сетка панелей использования */
  function buildUsageDash(ctx, L) {
    var d = ctx.d, base = ctx.base, crm = ctx.crm || {};
    var id = state.drawerId;
    var A = (d && d.answers) || (L.answers) || {};

    /* — воронка платформы: глубина и точка остановки — */
    var depth = 0, nextStep = null;
    for (var i = 0; i < FSTEPS.length; i++) {
      if (FSTEPS[i].test(L)) depth++;
      else { nextStep = FSTEPS[i]; break; }
    }
    var reached = depth > 0 ? FSTEPS[depth - 1] : null;
    var milestone = reached ? reached.label : 'Только зашли на платформу';
    var mSub = nextStep
      ? (depth === 0 ? 'сессия создана, дальше не пошел' : 'остановился на шаге: ' + esc(nextStep.label))
      : 'дошел до конца воронки платформы';

    /* — пульс — */
    var created = (d && d.created_at) || base.created_at || L.created_at;
    var lastAct = L.last_activity || (d && d.events && d.events.length ? d.events[d.events.length - 1].at : null) || created;
    var days = created ? Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / 86400000)) : null;
    var evCount = d && d.events ? d.events.length : (L.events ? L.events.length : 0);
    var st = crm.status && CRM[crm.status] ? CRM[crm.status] : CRM.new;

    var pulse = [
      ['На платформе', days == null ? '—' : (days === 0 ? 'сегодня' : days + ' ' + plural(days, 'день', 'дня', 'дней'))],
      ['Активность', lastAct ? ago(lastAct) + ' назад' : '—'],
      ['Действий', evCount ? String(evCount) : '—'],
    ].map(function (p) {
      return '<div class="uz-pz"><div class="uz-pz-v num">' + esc(p[1]) + '</div><div class="uz-pz-l">' + p[0] + '</div></div>';
    }).join('');

    /* профиль-чипы (кто это) */
    var pchips = [];
    if (A.grade) pchips.push(esc(fmtVal(A.grade)) + ' класс');
    if (A.target_year) pchips.push('поступление ' + esc(fmtVal(A.target_year)));
    var dirs = A.directions || A.direction;
    if (dirs) { var dd = Array.isArray(dirs) ? dirs[0] : dirs; if (dd) pchips.push(esc(fmtVal(dd))); }
    var geo = L.geo || (d && d.geo);
    if (geo && geo.city) pchips.push(esc(geo.city));
    var pchipsHtml = pchips.length ? '<div class="uz-prof">' + pchips.map(function (c) {
      return '<span class="uz-chip">' + c + '</span>';
    }).join('') + '</div>' : '';

    var hero = '<div class="uz-hero">' +
      '<div class="uz-hm">' +
        '<div class="uz-hm-l">Где сейчас' +
          '<span class="uz-st"><span class="uz-st-d" style="background:' + st.dot + '"></span>' + esc(st.label) + '</span></div>' +
        '<div class="uz-hm-t">' + esc(milestone) + '</div>' +
        '<div class="uz-hm-s">' + mSub + '</div>' +
        pchipsHtml +
      '</div>' +
      '<div class="uz-pulse">' + pulse + '</div>' +
    '</div>';

    /* — панели использования — */
    var panels = [];
    panels.push(usageAdmission(crm, id));
    var grid = [usageProducts(id), usageMoney(d), usageDocs(d), usageDiag(d), usageTouch(crm)];
    if (d && d.usage) {
      grid.push(usageLearning(d.usage.learning));
      grid.push(usageBot(d.usage.bot));
      grid.push(usageFamily(d.usage.family));
    }
    grid = grid.filter(Boolean);
    var gridHtml = grid.length ? '<div class="uz-grid">' + grid.join('') + '</div>' : '';

    return '<div class="uz">' + hero + panels.filter(Boolean).join('') + gridHtml + '</div>';
  }

  /* карточка-панель: иконка + заголовок + значение + строка; опц. ссылка на вкладку */
  function uzPanel(o) {
    var link = o.goto ? '<button class="uz-go" data-goto="' + o.goto + '">' + (o.golabel || 'открыть') + ic('go', 12) + '</button>' : '';
    return '<div class="uz-p' + (o.mute ? ' mute' : '') + (o.wide ? ' wide' : '') + '">' +
      '<div class="uz-p-h"><span class="uz-p-ic">' + ic(o.icon, 15) + '</span><span class="uz-p-t">' + o.title + '</span>' + link + '</div>' +
      '<div class="uz-p-b">' + o.body + '</div>' +
    '</div>';
  }

  function usageAdmission(crm, id) {
    var board = (crm && Array.isArray(crm.admission)) ? crm.admission : [];
    if (!board.length) return null;
    var by = { wait: 0, doing: 0, review: 0, done: 0, return: 0 };
    var client = 0, team = 0;
    var isClientSide = function (o) { return o === 'client' || o === 'student' || o === 'parent'; };
    board.forEach(function (t) {
      by[t.status] = (by[t.status] || 0) + 1;
      if (t.status !== 'done') { if (isClientSide(t.owner)) client++; else team++; }
    });
    var total = board.length, done = by.done || 0;
    var pct = total ? Math.round(done / total * 100) : 0;
    // следующая задача: приоритет review → return → doing → wait
    var order = { review: 0, return: 1, doing: 2, wait: 3, done: 9 };
    var pend = board.filter(function (t) { return t.status !== 'done'; })
      .sort(function (a, b) { return (order[a.status] || 5) - (order[b.status] || 5); });
    var next = pend[0];
    var chips = [];
    if (by.review) chips.push(['на проверке', by.review, 'rev']);
    if (by.return) chips.push(['вернули', by.return, 'ret']);
    if (client) chips.push(['на клиенте', client, 'cli']);
    if (team) chips.push(['на нас', team, 'team']);
    var chipsHtml = chips.map(function (c) {
      return '<span class="uz-tag uz-tag--' + c[2] + '">' + c[0] + '<b class="num">' + c[1] + '</b></span>';
    }).join('');
    var nextHtml = next
      ? '<div class="uz-next"><span class="uz-next-l">Следующее</span>' + esc(next.title) +
          '<span class="uz-next-o">' + (isClientSide(next.owner) ? 'клиент' : 'мы') + '</span></div>'
      : '<div class="uz-next done">' + ic('check', 12) + 'Все задачи закрыты</div>';
    var body =
      '<div class="uz-prog"><div class="uz-prog-bar"><span style="width:' + pct + '%"></span></div>' +
        '<span class="uz-prog-n num">' + done + '/' + total + '</span></div>' +
      (chipsHtml ? '<div class="uz-tags">' + chipsHtml + '</div>' : '') +
      nextHtml;
    return uzPanel({ icon: 'cap', title: 'Работа по поступлению', body: body, goto: 'admission', golabel: 'доска', wide: true });
  }

  function usageProducts(id) {
    var offers = leadOffers(id);
    var cat = state._catalog, byPid = {};
    if (cat) cat.forEach(function (p) { byPid[p.id] = p; });
    var pname = function (o) { return (byPid[o.pid] && byPid[o.pid].name) || o.headline || 'продукт'; };
    var bought = offers.filter(function (o) { return o && o.bought; });
    var shown = offers.filter(function (o) { return o && o.on && !o.bought; });
    if (!bought.length && !shown.length) {
      return uzPanel({ icon: 'box', title: 'Продукты', mute: true, goto: 'offers', golabel: 'витрина',
        body: '<div class="uz-empty">Витрина еще не собрана</div>' });
    }
    var body = '';
    if (bought.length) {
      body += '<div class="uz-mini">Куплено</div><div class="uz-chips">' + bought.map(function (o) {
        return '<span class="uz-chip on">' + ic('check', 11) + esc(pname(o)) + '</span>';
      }).join('') + '</div>';
    }
    body += '<div class="uz-line">' +
      (bought.length ? '<b class="num">' + bought.length + '</b> куплено' : 'ничего не куплено') +
      (shown.length ? ' · <b class="num">' + shown.length + '</b> в витрине' : '') + '</div>';
    return uzPanel({ icon: 'box', title: 'Продукты', body: body, goto: 'offers', golabel: 'витрина' });
  }

  function usageMoney(d) {
    var pays = (d && d.payments) || [];
    if (!pays.length) return uzPanel({ icon: 'coins', title: 'Деньги', mute: true, goto: 'pay', golabel: 'оплаты',
      body: '<div class="uz-empty">Оплат пока нет</div>' });
    var paid = 0, pend = 0;
    pays.forEach(function (p) { if (p.status === 'paid') paid += (p.amount_rub || 0); else if (p.status === 'pending') pend += (p.amount_rub || 0); });
    var body = '<div class="uz-big num">' + fmtMoney(paid) + ' <span>₽</span></div>' +
      '<div class="uz-line">оплачено · <b class="num">' + pays.length + '</b> ' + plural(pays.length, 'платеж', 'платежа', 'платежей') +
      (pend ? ' · ждем <b class="num">' + fmtMoney(pend) + ' ₽</b>' : '') + '</div>';
    return uzPanel({ icon: 'coins', title: 'Деньги', body: body, goto: 'pay', golabel: 'оплаты' });
  }

  function usageDocs(d) {
    var docs = (d && d.docs) || [];
    if (!docs.length) return uzPanel({ icon: 'doc', title: 'Документы', mute: true, goto: 'docs', golabel: 'архив',
      body: '<div class="uz-empty">Файлов нет</div>' });
    var withFile = docs.filter(function (x) { return x.has_file || x.link; }).length;
    var body = '<div class="uz-big num">' + docs.length + '</div>' +
      '<div class="uz-line">' + plural(docs.length, 'документ', 'документа', 'документов') +
      (withFile ? ' · <b class="num">' + withFile + '</b> с файлом' : '') + '</div>';
    return uzPanel({ icon: 'doc', title: 'Документы', body: body, goto: 'docs', golabel: 'архив' });
  }

  function usageDiag(d) {
    var dg = d && d.diagnostics;
    if (!dg || dg.score == null) return uzPanel({ icon: 'spark', title: 'Диагностика', mute: true, goto: 'ai', golabel: 'разбор',
      body: '<div class="uz-empty">Разбор не готов</div>' });
    var tone = scoreTone(dg.score);
    var body = '<div class="uz-big num" style="color:' + tone.c + '">' + dg.score + '<span>/100</span></div>' +
      '<div class="uz-line">' + esc(tone.label) + '</div>';
    return uzPanel({ icon: 'spark', title: 'Диагностика', body: body, goto: 'ai', golabel: 'разбор' });
  }

  function usageTouch(crm) {
    var comms = (crm && crm.comms) || [];
    if (!comms.length) return uzPanel({ icon: 'phone', title: 'Касания', mute: true, goto: 'notes', golabel: 'заметки',
      body: '<div class="uz-empty">Еще не связывались</div>' });
    var last = comms[comms.length - 1];
    var body = '<div class="uz-big num">' + comms.length + '</div>' +
      '<div class="uz-line">' + plural(comms.length, 'касание', 'касания', 'касаний') +
      ' · последнее ' + ago(last.at) + ' назад</div>';
    return uzPanel({ icon: 'phone', title: 'Касания', body: body, goto: 'notes', golabel: 'заметки' });
  }

  /* панели из d.usage (появятся после расширения бэкенда — миграция usage) */
  function usageLearning(lr) {
    if (!lr) return null;
    if (!lr.submissions) return uzPanel({ icon: 'chart', title: 'Обучение', mute: true, body: '<div class="uz-empty">Еще не занимался</div>' });
    var body = '<div class="uz-big num">' + lr.submissions + '</div>' +
      '<div class="uz-line">' + plural(lr.submissions, 'работа', 'работы', 'работ') + ' сдано' +
      (lr.avg_score != null ? ' · средний <b class="num">' + lr.avg_score + '</b>' : '') +
      (lr.last_at ? ' · ' + ago(lr.last_at) + ' назад' : '') + '</div>';
    return uzPanel({ icon: 'chart', title: 'Обучение', body: body });
  }

  function usageBot(bt) {
    if (!bt) return null;
    if (!bt.messages) return uzPanel({ icon: 'bot', title: 'Бот', mute: true, body: '<div class="uz-empty">Не писал боту</div>' });
    var body = '<div class="uz-big num">' + bt.messages + '</div>' +
      '<div class="uz-line">' + plural(bt.messages, 'сообщение', 'сообщения', 'сообщений') +
      (bt.last_at ? ' · ' + ago(bt.last_at) + ' назад' : '') +
      (bt.channel ? ' · ' + esc(bt.channel) : '') + '</div>';
    return uzPanel({ icon: 'bot', title: 'Активность в боте', body: body });
  }

  function usageFamily(fam) {
    if (!fam || !fam.length) return null;
    var body = '<div class="uz-chips">' + fam.map(function (m) {
      var role = m.relation === 'parent' ? 'родитель' : (m.relation === 'self' ? 'ученик' : (m.role || ''));
      return '<span class="uz-chip' + (m.connected ? ' on' : '') + '">' + esc(m.name || role) +
        (role ? '<i>' + esc(role) + '</i>' : '') + '</span>';
    }).join('') + '</div>' +
      '<div class="uz-line"><b class="num">' + fam.length + '</b> ' + plural(fam.length, 'участник', 'участника', 'участников') + ' семьи</div>';
    return uzPanel({ icon: 'team', title: 'Семья', body: body });
  }

  /* группирует реальные события под шаги платформы */
  function buildPathTimeline(L, d) {
    if (!L) return '';
    var ev = (d && d.events) || [];
    var firstAt = function (types) {
      for (var i = 0; i < ev.length; i++) if (types.indexOf(ev[i].type) !== -1) return ev[i].at;
      return null;
    };
    var bookedAt = (L.booking && (L.booking.at)) || null;
    var stepTime = {
      visited: (d && d.created_at) || L.created_at,
      submitted: firstAt(['questionnaire_submitted']),
      diagnosed: null,
      viewed: firstAt(['viewed_result']),
      cta: firstAt(['clicked_book_call', 'clicked_messenger']),
      booked: bookedAt,
      client: (L.crm && L.crm.updated_at) || null,
    };
    var subsByStep = { visited: [], submitted: [], diagnosed: [], viewed: [], cta: [], booked: [], client: [] };
    var maxStep = 0;
    ev.forEach(function (e) {
      if (e.type === 'anketa_step') {
        var s = (e.payload || {}).step || 0; if (s > maxStep) maxStep = s; return;
      }
      var label = evText(e);
      var hi = (e.type === 'questionnaire_submitted' || e.type === 'viewed_result' ||
        e.type === 'lead_submitted' || e.type === 'magnet_registered');
      var bucket = (e.type === 'opened_product' || e.type === 'viewed_result') ? 'viewed'
        : (e.type === 'clicked_book_call' || e.type === 'clicked_messenger') ? 'cta'
        : (e.type === 'lead_submitted') ? 'booked'
        : (e.type === 'questionnaire_submitted') ? 'submitted' : 'visited';
      subsByStep[bucket].push({ text: label, at: e.at, hi: hi });
    });
    if (maxStep) subsByStep.submitted.unshift({ text: 'анкета: дошел до шага ' + maxStep + ' из 7', at: null, hi: false });
    ((d && d.crm && d.crm.comms) || (L.crm && L.crm.comms) || []).forEach(function (cm) {
      subsByStep.booked.push({ text: (COMM_KINDS[cm.kind] || cm.kind) + (cm.text ? ': ' + cm.text : ''), at: cm.at, hi: false, comm: true });
    });

    var reachedPrev = true, dropMarked = false;
    var rows = FSTEPS.map(function (st) {
      var ok = st.test(L);
      var cls, node, tag = '', sdesc;
      if (ok) { cls = 'done'; node = ic('check', 13); sdesc = st.hint; }
      else if (reachedPrev && !dropMarked) { cls = 'drop'; dropMarked = true; node = ic('x', 12);
        tag = '<span class="pt-tag drop">тут оборвался</span>'; sdesc = 'дальше не пошел — здесь остановка'; }
      else { cls = 'todo'; node = '<span style="font-size:11px;font-weight:700">' + (FSTEPS.indexOf(st) + 1) + '</span>';
        sdesc = 'не дошел'; }
      if (!ok) reachedPrev = false;
      var t = stepTime[st.key];
      var subs = (subsByStep[st.key] || []).slice().sort(function (a, b) { return new Date(a.at || 0) - new Date(b.at || 0); });
      var subsHtml = subs.length ? '<div class="pt-subs">' + subs.map(function (s) {
        return '<div class="pt-sub' + (s.hi ? ' hi' : '') + (s.comm ? ' comm' : '') + '">' + esc(s.text) +
          (s.at ? '<span class="sw num">' + fmtWhen(s.at) + '</span>' : '') + '</div>';
      }).join('') + '</div>' : '';
      return '<div class="pt-step ' + cls + '">' +
        '<div class="pt-rail"><div class="pt-node">' + node + '</div><div class="pt-line"></div></div>' +
        '<div class="pt-body"><div class="pt-t">' + st.label + tag +
          (t ? '<span class="pt-when num">' + fmtWhen(t) + '</span>' : '') + '</div>' +
          '<div class="pt-s">' + sdesc + '</div>' + subsHtml +
        '</div></div>';
    }).join('');
    return '<div class="path-tl">' + rows + '</div>';
  }

  /* ── РАЗДЕЛ «Заметки» — заметка + задачи + лог ── */
  function buildNotesSection(ctx) {
    var crm = ctx.crm;
    var tasks = (crm.tasks || []).slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return (a.due || '9999') < (b.due || '9999') ? -1 : 1;
    });
    var comms = (crm.comms || []).slice(-8).reverse();
    var commIc = { call: 'phone', msg: 'send', meet: 'cal' };
    return '<div class="m-ctitle">Заметки и задачи</div>' +
      '<div class="m-csub">Веди клиента: о чем договорились, что обещал, какой следующий шаг.</div>' +
      '<div class="m-sec"><div class="m-sec-h">Заметка</div>' +
        '<textarea class="note-ta" id="m-note" placeholder="О чем договорились, что обещали, нюансы">' + esc(crm.note || '') + '</textarea>' +
        '<div class="note-state" id="m-notestate"></div></div>' +
      '<div class="m-sec"><div class="m-sec-h">Задачи</div><div id="m-tasks">' + tasks.map(function (t) {
        var over = !t.done && t.due && t.due < todayISO(0);
        return '<div class="task' + (t.done ? ' done' : '') + (over ? ' overdue' : '') + '" data-tid="' + esc(t.id) + '">' +
          '<button class="task-chk">' + ic('check', 11) + '</button>' +
          '<div class="task-body"><div class="task-text">' + esc(t.text) + '</div>' +
          (t.due ? '<div class="task-due">' + (over ? ic('clock', 11) : '') + fmtDue(t.due) + '</div>' : '') + '</div>' +
          '<button class="task-del">' + ic('x', 12) + '</button></div>';
      }).join('') + (tasks.length ? '' : '<div class="field-empty">Задач нет. Поставь следующий шаг ниже.</div>') + '</div>' +
        '<div class="task-add"><input id="m-task-in" placeholder="Новая задача — Enter" autocomplete="off">' +
        '<span class="due-seg" id="m-due"><button data-d="0" class="on">сегодня</button><button data-d="1">завтра</button><button data-d="">без срока</button></span></div></div>';
  }

  /* ── РАЗДЕЛ «Документы» — ручная загрузка ── */
  function fmtSize(n) {
    if (!n) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1048576) return Math.round(n / 1024) + ' КБ';
    return (n / 1048576).toFixed(1) + ' МБ';
  }
  function buildDocsSection(ctx) {
    var docs = (ctx.d && ctx.d.docs) || [];
    var rows = docs.map(function (dc) {
      var href = dc.link ? dc.link : (API + '/admin/api/docs/' + dc.id + '/download?k=' + encodeURIComponent(getKey()));
      var meta = [dc.kind, dc.link ? 'ссылка' : fmtSize(dc.size_bytes), fmtWhen(dc.created_at)].filter(Boolean).join(' · ');
      return '<div class="doc-row" data-did="' + dc.id + '">' +
        '<span class="doc-ic">' + ic(dc.link ? 'ext' : 'doc', 17) + '</span>' +
        '<div class="doc-b"><div class="doc-n">' + esc(dc.name) + '</div><div class="doc-m">' + esc(meta) + '</div></div>' +
        '<div class="doc-act">' +
          '<a class="icobtn" target="_blank" rel="noopener" href="' + esc(href) + '" title="Открыть">' + ic(dc.link ? 'ext' : 'dl', 14) + '</a>' +
          '<button class="icobtn del" data-deldoc="' + dc.id + '" title="Удалить">' + ic('x', 14) + '</button>' +
        '</div></div>';
    }).join('');
    return '<div class="m-ctitle">Документы</div>' +
      '<div class="m-csub">Паспорт, аттестат, согласия — что прислал клиент. Файл до 12 МБ или ссылка.</div>' +
      (docs.length ? '<div>' + rows + '</div>' : '') +
      '<div class="dropzone" id="m-drop"><input type="file" id="m-file" style="display:none">' +
        '<div class="dz-ic">' + ic('dl', 18) + '</div>' +
        '<div><b>Выбери файл</b> или перетащи сюда</div></div>' +
      '<div class="linkrow"><input id="m-link" placeholder="…или вставь ссылку на документ"><button class="bp sm" id="m-link-add">' + ic('plus', 13) + 'Добавить</button></div>';
  }

  /* ── РАЗДЕЛ «Оплаты» — ручной учёт ── */
  var PAY_ST = {
    paid:     { label: 'оплачен',   sev: 'client' },
    pending:  { label: 'ожидается', sev: 'contacted' },
    refunded: { label: 'возврат',   sev: 'rejected' },
  };

  /* ── РАЗДЕЛ «Написать» — отправить уведомление клиенту через бота + история отправок ── */
  function buildNotifySection(ctx) {
    var id = ctx.id;
    return '<div class="m-ctitle">Написать клиенту</div>' +
      '<div class="m-csub">Сообщение уходит клиенту в его канал через бота. AI-режим — опиши суть, бот сформулирует сам (по тону куратора и истории переписки); Текст — отправится как есть.</div>' +
      '<div class="m-sec">' +
        '<div class="m-sec-h">Новое сообщение</div>' +
        '<div class="ntf-mode" id="ntf-mode">' +
          '<button data-m="event" class="on">AI сформулирует</button>' +
          '<button data-m="text">Готовый текст</button>' +
        '</div>' +
        '<textarea class="note-ta" id="ntf-input" placeholder="Опиши, что написать — например: «напомни о созвоне завтра, предложи перенести, если неудобно»"></textarea>' +
        '<div class="ntf-act"><button class="bp sm" id="ntf-send">' + ic('send', 13) + 'Отправить</button>' +
        '<span class="ntf-state" id="ntf-state"></span></div>' +
      '</div>' +
      '<div class="m-sec"><div class="m-sec-h">История отправок' +
        '<span class="hr" id="ntf-refresh">' + ic('refresh', 12) + 'обновить</span></div>' +
        '<div id="ntf-log"></div></div>';
  }
  /* режим/отправка/лог — подключаются в attachContentHandlers (когда модалка в DOM) */
  function buildPaySection(ctx) {
    var pays = (ctx.d && ctx.d.payments) || [];
    var paid = pays.filter(function (p) { return p.status === 'paid'; }).reduce(function (s, p) { return s + (p.amount_rub || 0); }, 0);
    var pending = pays.filter(function (p) { return p.status === 'pending'; }).reduce(function (s, p) { return s + (p.amount_rub || 0); }, 0);
    var refunded = pays.filter(function (p) { return p.status === 'refunded'; }).reduce(function (s, p) { return s + (p.amount_rub || 0); }, 0);

    var board = '<div class="pay-board">' +
      '<div class="pay-cell lead"><div class="pc-l">Оплачено</div><div class="pc-v num">' + fmtMoney(paid) + ' ₽</div></div>' +
      '<div class="pay-cell' + (pending ? '' : ' muted') + '"><div class="pc-l">Ожидается</div><div class="pc-v num">' + fmtMoney(pending) + ' ₽</div></div>' +
      '<div class="pay-cell' + (refunded ? '' : ' muted') + '"><div class="pc-l">Возвраты</div><div class="pc-v num">' + fmtMoney(refunded) + ' ₽</div></div>' +
    '</div>';

    var rows = pays.slice().sort(function (a, b) {
      var aw = a.paid_at || a.created_at || '', bw = b.paid_at || b.created_at || '';
      return aw < bw ? 1 : -1;
    }).map(function (p) {
      var st = PAY_ST[p.status] || PAY_ST.pending;
      var when = p.paid_at
        ? p.paid_at.slice(8, 10) + '.' + p.paid_at.slice(5, 7) + '.' + p.paid_at.slice(0, 4)
        : fmtWhen(p.created_at);
      var amtCls = p.status === 'refunded' ? ' refunded' : (p.status === 'pending' ? ' pending' : '');
      var rcpt = p.receipt_doc_id
        ? '<a class="pay-rcpt has" target="_blank" rel="noopener" href="' + API + '/admin/api/docs/' + p.receipt_doc_id + '/download?k=' + encodeURIComponent(getKey()) + '" title="Открыть квитанцию">' + ic('doc', 13) + 'квитанция</a>'
        : '<button class="pay-rcpt" data-attachpay="' + p.id + '" title="Прикрепить квитанцию">' + ic('plus', 12) + 'квитанция</button>';
      return '<div class="pay-row">' +
        '<div class="doc-b"><div class="doc-n">' + esc(p.title) +
          ' <span class="sev s-' + st.sev + '" style="margin-left:6px">' + st.label + '</span></div>' +
          '<div class="doc-m">' + [when, p.note].filter(Boolean).map(esc).join(' · ') + '</div></div>' +
        rcpt +
        '<span class="pay-amt' + amtCls + ' num">' + fmtMoney(p.amount_rub) + ' ₽</span>' +
        '<button class="icobtn del" data-delpay="' + p.id + '" title="Удалить">' + ic('x', 14) + '</button></div>';
    }).join('');

    var manualCount = pays.length;
    return '<div class="m-ctitle">Оплаты</div>' +
      '<div class="m-csub">Выставьте клиенту счет — он оплатит онлайн через ЮKassa, оплата зачтется сама. Итог по деньгам — в сводке ниже.</div>' +
      board +
      '<div class="m-sec"><div class="m-sec-h">Счета клиента' +
        '<span class="hr" id="ord-refresh">' + ic('refresh', 12) + 'обновить</span></div>' +
        '<div id="ord-list"><div class="field-empty">Загружаю счета…</div></div>' +
        '<div class="ord-b">' +
          '<div class="ord-newh">Новый счет</div>' +
          '<div class="ord-addwrap">' +
            '<button type="button" class="ord-addbtn" id="ord-addbtn">' + ic('plus', 13) + 'Добавить в счет' + ic('go', 12) + '</button>' +
            '<div class="ord-menu" id="ord-menu" hidden></div>' +
          '</div>' +
          '<div id="ord-items" class="ord-items"></div>' +
          '<div class="ord-total"><span>Итого</span><span id="ord-total-v" class="num">0 ₽</span></div>' +
          '<div class="ord-foot">' +
            '<span class="pay-seg" id="ord-mode"><button data-v="full" class="on">полная оплата</button>' +
              '<button data-v="installment">рассрочка</button></span>' +
            '<label class="ord-n-wrap" id="ord-n-wrap" hidden>взносов <input id="ord-n" class="ord-n" inputmode="numeric" value="4"></label>' +
            '<button class="bp sm" id="ord-add-btn" style="margin-left:auto">' + ic('plus', 13) + '<span id="ord-btn-lbl">Выставить счет</span></button>' +
          '</div>' +
        '</div></div>' +
      '<details class="pay-manual"' + (manualCount ? ' open' : '') + '>' +
        '<summary><span class="pm-t">Записать оплату вручную</span>' +
          '<span class="pm-h">нал, перевод и прочее мимо кассы' + (manualCount ? ' · ' + manualCount : '') + '</span>' +
          ic('go', 13) + '</summary>' +
        '<div class="pay-manual__body">' +
          (pays.length ? '<div>' + rows + '</div>' : '<div class="field-empty">Ручных платежей нет. Оплаты через кассу учитываются автоматически.</div>') +
          '<div class="m-sec" style="margin-top:12px"><div class="m-sec-h">Добавить платеж</div>' +
            '<div class="pay-form">' +
              '<span class="pay-seg" id="pay-st"><button data-v="paid" class="on">оплачен</button>' +
                '<button data-v="pending">ожидается</button><button data-v="refunded">возврат</button></span>' +
              '<input id="pay-title" placeholder="За что — например «Диагностика» или «Сопровождение»">' +
              '<div class="pay-grid">' +
                '<input id="pay-amt" inputmode="numeric" placeholder="Сумма, ₽">' +
                '<input id="pay-date" type="date" value="' + todayISO(0) + '">' +
                '<button class="bp sm" id="pay-add-btn" style="justify-content:center">' + ic('plus', 13) + 'Добавить</button>' +
              '</div>' +
              '<button class="pay-rcpt add" id="pay-rcpt-pick" type="button">' + ic('doc', 13) + '<span id="pay-rcpt-lbl">Прикрепить квитанцию (необязательно)</span></button>' +
            '</div></div>' +
        '</div></details>' +
      '<input type="file" id="pay-rcpt-file" style="display:none">';
  }
  function fmtMoney(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  /* ── обработчики активного раздела ── */
  /* Обработчики раздела «Английский». Все действия — отдельные ручки бэка; после каждой
     перечитываем блок целиком, чтобы на экране был ответ сервера, а не наша догадка. */
  function wireDet(id, host) {
    function reload() { loadDet(id, true); }
    function post(path, body, okMsg) {
      return api(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(function (r) { if (okMsg) showToast(okMsg); reload(); return r; })
        .catch(function (e) { if (e.message !== '403') showToast('Не получилось: ' + e.message); });
    }

    var rf = el('det-refresh');
    if (rf) rf.addEventListener('click', reload);

    Array.prototype.forEach.call(host.querySelectorAll('[data-det]'), function (row) {
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      });
      row.addEventListener('click', function (e) {
        if (e.target.closest('.det-detail')) return;
        var aid = row.getAttribute('data-det');
        DET_SHOW = DET_SHOW === aid ? null : aid;
        renderModalContent();
        if (DET_SHOW && !DET_ITEM[DET_SHOW]) {
          api('/admin/api/det/attempts/' + DET_SHOW).then(function (r) {
            DET_ITEM[aid] = r;
            if (state.drawerId === id && state.modalSection === 'det') renderModalContent();
          }).catch(function (err) { if (err.message !== '403') showToast('Разбор не открылся'); });
        }
      });
    });

    var gs = el('det-gsave');
    if (gs) gs.addEventListener('click', function () {
      var w = (el('det-gw').value || '').trim(), s = (el('det-gs').value || '').trim();
      var body = {};
      if (w) body.writing = parseInt(w, 10);
      if (s) body.speaking = parseInt(s, 10);
      var bad = Object.keys(body).some(function (kk) { return !(body[kk] >= 10 && body[kk] <= 160); });
      if (!Object.keys(body).length || bad) { showToast('Балл — число от 10 до 160'); return; }
      var aid = gs.getAttribute('data-aid');
      delete DET_ITEM[aid];
      post('/admin/api/det/attempts/' + aid + '/score', body, 'Балл сохранен');
    });

    var rg = el('det-regrade');
    if (rg) rg.addEventListener('click', function () {
      var aid = rg.getAttribute('data-aid');
      rg.disabled = true; rg.textContent = 'Проверяю…';
      delete DET_ITEM[aid];
      api('/admin/api/det/attempts/' + aid + '/regrade', { method: 'POST' })
        .then(function (r) {
          showToast(r.ok ? 'Сочинение проверено' : 'Модель не ответила — попробуйте еще раз');
          return api('/admin/api/det/attempts/' + aid).then(function (d) { DET_ITEM[aid] = d; });
        })
        .catch(function (e) { if (e.message !== '403') showToast('Не получилось: ' + e.message); })
        .then(reload);
    });

    var b = DET[id] || {}, acc = b.access || {};
    var sr = el('det-sw-retake');
    if (sr) sr.addEventListener('click', function () {
      post('/admin/api/leads/' + id + '/det/access', { retake: !(acc.retakes > 0) },
           acc.retakes > 0 ? 'Повторный тест закрыт' : 'Повторный тест разрешен');
    });
    var sp = el('det-sw-practice');
    if (sp) sp.addEventListener('click', function () {
      post('/admin/api/leads/' + id + '/det/access', { practice_open: !acc.practice_open },
           acc.practice_open ? 'Тренажеры закрыты' : 'Тренажеры открыты');
    });

    var tsel = el('det-teacher');
    if (tsel) {
      // Список преподавателей грузим один раз на сессию и перерисовываем поле.
      if (!DET_TEACHERS) api('/admin/api/det/teachers').then(function (r) {
        DET_TEACHERS = (r && r.teachers) || [];
        if (el('det-teacher')) renderDrawer(true);
      }).catch(function () { DET_TEACHERS = []; });
      tsel.addEventListener('change', function () {
        post('/admin/api/leads/' + id + '/det/teacher', { login: tsel.value || null },
             tsel.value ? 'Преподаватель назначен' : 'Преподаватель снят');
      });
    }

    var nl = el('det-newlink');
    if (nl) nl.addEventListener('click', function () {
      post('/admin/api/leads/' + id + '/det/invite', {}, 'Ссылка на тест готова');
    });
    var cp = el('det-copy');
    if (cp) cp.addEventListener('click', function () {
      var f = el('det-url'); if (f) copyText(f.value, cp);
    });
  }

  function attachContentHandlers(id, ctx) {
    var host = el('m-content');
    if (!host) return;
    var crm = ctx.crm;

    // advance-кнопки и copy в «Сейчас»
    Array.prototype.forEach.call(host.querySelectorAll('[data-adv]'), function (b) {
      b.addEventListener('click', function () { patch(id, { status: b.getAttribute('data-adv') }); });
    });
    // переход на другую вкладку карточки (ссылки «открыть доску / оплаты» из «Пути»)
    Array.prototype.forEach.call(host.querySelectorAll('[data-goto]'), function (b) {
      b.addEventListener('click', function () { setModalSection(b.getAttribute('data-goto')); });
    });
    var cc = el('c-copy'), ndc = el('nd-copy');
    var contact = ((ctx.base.booking || {}).contact) || '';
    if (cc) cc.addEventListener('click', function () { copyText(contact, cc); });
    if (ndc) ndc.addEventListener('click', function () { copyText(contact, ndc); });
    var stHost = el('m-st');
    if (stHost) Array.prototype.forEach.call(stHost.querySelectorAll('[data-s]'), function (b) {
      b.addEventListener('click', function () { var s = b.getAttribute('data-s'); if (s !== crm.status) patch(id, { status: s }); });
    });

    // ── АНГЛИЙСКИЙ: разбор попытки, баллы за письмо и речь, доступ ──
    if (state.modalSection === 'det') wireDet(id, host);

    // ── КИТАЙСКИЙ: доступ к курсу в записи и личная ссылка на уроки ──
    if (state.modalSection === 'course') wireCourse(id);

    // ── ПОСТУПЛЕНИЕ: конструктор задач по этапам ──
    var rmHost = host.querySelector('.rm-flow');
    if (rmHost) {
      // старый кэш детали (до появления доски) — подтянуть свежую деталь один раз
      if (!RM_LOADED[id] && !RM_REFRESHED[id]) {
        var dd = state.details[id];
        if (dd && (!dd.crm || !Array.isArray(dd.crm.admission))) {
          RM_REFRESHED[id] = true;
          refreshDetail(id, function () { if (state.drawerId === id && state.modalSection === 'admission') renderDrawer(true); });
        }
      }
      var rmReload = function () { if (state.drawerId === id && state.modalSection === 'admission') renderDrawer(true); };
      var rmUpd = function (tid, fn) {
        rmSet(id, rmTasks(id).map(function (t) { return t.id === tid ? fn(Object.assign({}, t)) : t; }));
        rmReload();
      };
      // «N ждут проверки» в сводке — прокрутить к первой задаче на проверке
      var rvCta = host.querySelector('[data-rmreview]');
      if (rvCta) rvCta.addEventListener('click', function () {
        var first = host.querySelector('.rm-task.st-review');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      Array.prototype.forEach.call(rmHost.querySelectorAll('.rm-task'), function (tEl) {
        var tid = tEl.getAttribute('data-tid');
        // раскрытие/сворачивание задачи (клик по шапке, но не по чекбоксу)
        var headEl = tEl.querySelector('.rm-task-head');
        if (headEl) headEl.addEventListener('click', function (e) {
          if (e.target.closest('.rm-ck')) return;
          if (RM_OPEN[tid]) delete RM_OPEN[tid]; else RM_OPEN[tid] = true;
          rmReload();
        });
        // чек-кружок: тогл готово
        var ck = tEl.querySelector('.rm-ck');
        if (ck) ck.addEventListener('click', function (e) {
          e.stopPropagation();
          rmUpd(tid, function (t) { t.status = t.status === 'done' ? 'doing' : 'done'; return t; });
        });
        // принять
        var acc = tEl.querySelector('.rm-accept');
        if (acc) acc.addEventListener('click', function () { rmUpd(tid, function (t) { t.status = 'done'; return t; }); });
        // вернуть на доработку (с комментарием в тред)
        var ret = tEl.querySelector('.rm-return'), retBox = tEl.querySelector('.rm-ret-box');
        if (ret && retBox) ret.addEventListener('click', function () {
          retBox.hidden = !retBox.hidden;
          if (!retBox.hidden) { var i = retBox.querySelector('input'); if (i) i.focus(); }
        });
        var retIn = tEl.querySelector('.rm-ret-in'), retSend = tEl.querySelector('.rm-ret-send');
        var doReturn = function () {
          var c = retIn ? retIn.value.trim() : '';
          rmUpd(tid, function (t) {
            t.status = 'return';
            if (c) t.comments = (t.comments || []).concat([{ by: 'mgr', text: c, at: new Date().toISOString() }]);
            return t;
          });
        };
        if (retSend) retSend.addEventListener('click', doReturn);
        if (retIn) retIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doReturn(); } });
        // обсуждение по задаче — открыть просторный чат-оверлей
        var disc = tEl.querySelector('.rm-discuss');
        if (disc) disc.addEventListener('click', function () { RM_CHAT = tid; syncRmChat(id); });
        // убрать задачу
        var del = tEl.querySelector('.rm-del');
        if (del) del.addEventListener('click', function () { delete RM_OPEN[tid]; rmSet(id, rmTasks(id).filter(function (t) { return t.id !== tid; })); rmReload(); });
        // вложения задачи: doc_id → реальная ссылка. Картинки резолвим сразу для
        // превью-миниатюры; файлы — по клику (self-host Storage медленный, незачем
        // тащить трафик за карточки, которые никто не откроет).
        Array.prototype.forEach.call(tEl.querySelectorAll('.rm-sub[data-docid]'), function (a) {
          var docId = a.getAttribute('data-docid');
          if (a.classList.contains('rm-sub-img')) {
            resolveDocLink(docId, function (url) {
              if (!url) return;
              a.href = url;
              var thumb = a.querySelector('.rm-sub-thumb');
              if (thumb) { thumb.classList.remove('rm-sub-thumb--load'); thumb.style.backgroundImage = "url('" + url + "')"; }
            });
          } else {
            a.addEventListener('click', function (e) {
              if (a.getAttribute('data-resolved') === '1') return; // href уже настоящий — обычный переход
              e.preventDefault();
              if (a.classList.contains('rm-sub-loading')) return;
              a.classList.add('rm-sub-loading');
              resolveDocLink(docId, function (url) {
                a.classList.remove('rm-sub-loading');
                if (!url) return;
                a.href = url; a.setAttribute('data-resolved', '1');
                window.open(url, '_blank', 'noopener');
              });
            });
          }
        });
        // тип ответа ученика (file/text/both/none) — сохраняется сразу
        Array.prototype.forEach.call(tEl.querySelectorAll('.rm-submit-seg .rm-sub-t'), function (sb) {
          sb.addEventListener('click', function (e) {
            e.stopPropagation();
            rmUpd(tid, function (t) { t.submit = sb.getAttribute('data-sub'); return t; });
          });
        });
      });
      // раскрытие панели добавления
      Array.prototype.forEach.call(rmHost.querySelectorAll('.rm-add-btn'), function (b) {
        b.addEventListener('click', function () {
          var panel = rmHost.querySelector('.rm-add[data-stage="' + b.getAttribute('data-addstage') + '"]');
          if (panel) { panel.hidden = !panel.hidden; b.classList.toggle('open', !panel.hidden); }
        });
      });
      // панели добавления: владелец, пресеты, своя задача с заданием и вложениями
      Array.prototype.forEach.call(rmHost.querySelectorAll('.rm-add'), function (panel) {
        var stage = panel.getAttribute('data-stage');
        var addTask = function (opts) {
          if (!opts.title) return;
          var t = { id: 'rm' + Date.now() + Math.floor(Math.random() * 99), stage: stage, title: opts.title,
            owner: opts.owner, status: 'wait', need: opts.need || '', due: opts.due || '',
            submit: opts.submit || (opts.owner === 'team' ? 'none' : 'file'),
            attach: opts.attach || [], subs: [], comments: [] };
          rmSet(id, rmTasks(id).concat([t]));
          RM_OPEN[t.id] = true;  // раскрываем новую задачу, чтоб сразу видеть задание
          rmReload();
        };
        Array.prototype.forEach.call(panel.querySelectorAll('.rm-add-own button'), function (ob) {
          ob.addEventListener('click', function () {
            panel.setAttribute('data-o', ob.getAttribute('data-o'));
            Array.prototype.forEach.call(panel.querySelectorAll('.rm-add-own button'), function (x) { x.classList.toggle('on', x === ob); });
          });
        });
        Array.prototype.forEach.call(panel.querySelectorAll('.rm-chip'), function (cp) {
          cp.addEventListener('click', function () {
            var at = cp.getAttribute('data-at'); at = at ? at.split(',') : [];
            var hasFile = at.some(function (a) { return a === 'photo' || a === 'file' || a === 'link'; });
            var hasText = at.indexOf('text') !== -1;
            var sub = hasFile && hasText ? 'both' : hasText ? 'text' : 'file';
            addTask({ title: cp.getAttribute('data-t'), owner: cp.getAttribute('data-o'),
              need: cp.getAttribute('data-need'), attach: at, submit: sub });
          });
        });
        // тип ответа — один из четырех (file/text/both/none)
        Array.prototype.forEach.call(panel.querySelectorAll('.rm-at-t'), function (ab) {
          ab.addEventListener('click', function () {
            Array.prototype.forEach.call(panel.querySelectorAll('.rm-at-t'), function (x) { x.classList.toggle('on', x === ab); });
          });
        });
        var titleIn = panel.querySelector('.rm-f-title'), needIn = panel.querySelector('.rm-f-need'), dueIn = panel.querySelector('.rm-f-due');
        var submitCustom = function () {
          var v = titleIn ? titleIn.value.trim() : ''; if (!v) return;
          var on = panel.querySelector('.rm-at-t.on');
          var sub = (on && on.getAttribute('data-sub')) || 'file';
          var attach = sub === 'both' ? ['file', 'text'] : sub === 'none' ? [] : [sub];
          addTask({ title: v, owner: panel.getAttribute('data-o') || 'client', need: needIn ? needIn.value.trim() : '',
            due: dueIn ? dueIn.value : '', submit: sub, attach: attach });
        };
        var addBtn = panel.querySelector('.rm-f-add');
        if (addBtn) addBtn.addEventListener('click', submitCustom);
        if (titleIn) titleIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } });
        if (needIn) needIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } });
      });
    }

    // заметка
    var note = el('m-note'), noteState = el('m-notestate'), noteTimer = null;
    if (note) note.addEventListener('input', function () {
      if (noteState) noteState.textContent = '';
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { patch(id, { note: note.value }, noteState); }, 900);
    });
    // задачи
    function curTasks() { var lc = findLead(id); return ((lc && lc.crm.tasks) || crm.tasks || []).slice(); }
    Array.prototype.forEach.call(host.querySelectorAll('.task'), function (tEl) {
      var tid = tEl.getAttribute('data-tid');
      tEl.querySelector('.task-chk').addEventListener('click', function () {
        patch(id, { tasks: curTasks().map(function (t) { return String(t.id) === tid ? Object.assign({}, t, { done: !t.done }) : t; }) });
      });
      tEl.querySelector('.task-del').addEventListener('click', function () {
        patch(id, { tasks: curTasks().filter(function (t) { return String(t.id) !== tid; }) });
      });
    });
    var dueSeg = el('m-due'), dueVal = '0';
    if (dueSeg) Array.prototype.forEach.call(dueSeg.children, function (b) {
      b.addEventListener('click', function () { dueVal = b.getAttribute('data-d'); Array.prototype.forEach.call(dueSeg.children, function (x) { x.classList.toggle('on', x === b); }); });
    });
    var taskIn = el('m-task-in');
    if (taskIn) taskIn.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var text = taskIn.value.trim(); if (!text) return;
      var t = { id: String(Date.now()), text: text, done: false, created_at: new Date().toISOString() };
      if (dueVal !== '') t.due = todayISO(parseInt(dueVal, 10));
      taskIn.value = '';
      patch(id, { tasks: curTasks().concat([t]) });
    });
    // лог
    var commHost = el('m-comms');
    if (commHost) Array.prototype.forEach.call(commHost.children, function (b) {
      b.addEventListener('click', function () {
        var lc = findLead(id); var cur = ((lc && lc.crm.comms) || crm.comms || []).slice();
        cur.push({ kind: b.getAttribute('data-k'), text: '', at: new Date().toISOString() });
        patch(id, { comms: cur });
      });
    });

    // документы: загрузка файла / ссылки / удаление
    var drop = el('m-drop'), fileIn = el('m-file');
    if (drop && fileIn) {
      drop.addEventListener('click', function () { fileIn.click(); });
      fileIn.addEventListener('change', function () { if (fileIn.files && fileIn.files[0]) uploadDoc(id, fileIn.files[0]); });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files && e.dataTransfer.files[0]) uploadDoc(id, e.dataTransfer.files[0]); });
    }
    var linkAdd = el('m-link-add'), linkIn = el('m-link');
    if (linkAdd && linkIn) linkAdd.addEventListener('click', function () {
      var url = linkIn.value.trim(); if (!url) return;
      var nm = url.split('/').filter(Boolean).pop() || 'Ссылка';
      apiSend('/admin/api/leads/' + id + '/docs', 'POST', { name: nm, link: url }, function () {
        refreshDetail(id, function () { if (state.drawerId === id && state.modalSection === 'docs') renderDrawer(true); });
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-deldoc]'), function (b) {
      b.addEventListener('click', function () {
        var row = b.closest('.doc-row'); if (row) { row.style.opacity = '.4'; row.style.pointerEvents = 'none'; }
        apiSend('/admin/api/docs/' + b.getAttribute('data-deldoc'), 'DELETE', null, function () {
          if (row) row.remove();
          refreshDetail(id);  // тихо обновляем кэш, без перерисовки модалки
        });
      });
    });

    // оплаты: квитанция — общий скрытый file-input. attachTo = id оплаты (для уже
    // существующих строк) либо null + stagedRcpt (для новой оплаты в форме).
    var rcptFile = el('pay-rcpt-file'), attachTo = null, stagedRcpt = null;
    function reloadPay() { refreshDetail(id, function () { if (state.drawerId === id && state.modalSection === 'pay') renderDrawer(true); }); }
    function uploadReceipt(file, cb) {
      if (file.size > 12 * 1024 * 1024) { showToast('Файл больше 12 МБ'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        apiSend('/admin/api/leads/' + id + '/docs', 'POST',
          { name: file.name, kind: 'квитанция', mime: file.type || 'application/octet-stream', data_base64: String(reader.result) },
          function (r) { cb(r && r.id); });
      };
      reader.readAsDataURL(file);
    }
    if (rcptFile) rcptFile.addEventListener('change', function () {
      var f = rcptFile.files && rcptFile.files[0]; if (!f) return;
      if (attachTo) {  // прикрепить к существующей оплате
        var pid = attachTo; attachTo = null; rcptFile.value = '';
        showToast('Загружаю квитанцию…');
        uploadReceipt(f, function (docId) {
          if (!docId) { showToast('Не загрузилось'); return; }
          apiSend('/admin/api/payments/' + pid, 'PATCH', { receipt_doc_id: docId }, reloadPay);
        });
      } else {  // придержать для новой оплаты (форма)
        stagedRcpt = f; rcptFile.value = '';
        var lbl = el('pay-rcpt-lbl'); if (lbl) lbl.textContent = f.name;
        var pick = el('pay-rcpt-pick'); if (pick) pick.classList.add('on');
      }
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-attachpay]'), function (b) {
      b.addEventListener('click', function () { attachTo = b.getAttribute('data-attachpay'); if (rcptFile) rcptFile.click(); });
    });
    var rcptPick = el('pay-rcpt-pick');
    if (rcptPick) rcptPick.addEventListener('click', function () { attachTo = null; if (rcptFile) rcptFile.click(); });

    // оплаты: добавить (статус-сегмент + дата)
    /* ── Счета ЮKassa (заказы) ── */
    var ordList = el('ord-list');
    if (ordList) {
      var ORD_ST = {
        awaiting_payment: { label: 'ждет оплаты', sev: 'contacted' },
        partially_paid:   { label: 'частично оплачен', sev: 'offer_sent' },
        paid:             { label: 'оплачен', sev: 'client' },
        canceled:         { label: 'отменен', sev: 'rejected' },
      };
      var renderOrders = function (orders) {
        if (!orders || !orders.length) {
          ordList.innerHTML = '<div class="field-empty">Счетов пока нет — выставьте первый ниже.</div>';
          return;
        }
        ordList.innerHTML = orders.map(function (o) {
          var st = ORD_ST[o.status] || ORD_ST.awaiting_payment;
          var inst = o.installments || [];
          var paidN = inst.filter(function (i) { return i.status === 'paid'; }).length;
          var next = inst.filter(function (i) { return i.status !== 'paid' && i.status !== 'refunded'; })[0];
          var meta = [];
          if (o.pay_mode === 'installment') meta.push('рассрочка: взнос ' + Math.min(paidN + 1, inst.length) + ' из ' + inst.length);
          if (next) meta.push('след. ' + next.due_date.slice(8, 10) + '.' + next.due_date.slice(5, 7) + ' · ' + fmtMoney(next.amount) + ' ₽');
          if (o.paid_total) meta.push('внесено ' + fmtMoney(o.paid_total) + ' ₽');
          return '<div class="pay-row">' +
            '<div class="doc-b"><div class="doc-n">' + esc(o.title) +
              ' <span class="sev s-' + st.sev + '" style="margin-left:6px">' + st.label + '</span></div>' +
              '<div class="doc-m">' + meta.map(esc).join(' · ') + '</div></div>' +
            '<span class="pay-amt num">' + fmtMoney(o.amount_total) + ' ₽</span></div>';
        }).join('');
      };
      var loadOrders = function () {
        api('/admin/api/leads/' + id + '/orders').then(function (r) { renderOrders(r.orders); })
          .catch(function (e) { if (e.message !== '403') ordList.innerHTML = '<div class="field-empty">Не загрузились — обновите.</div>'; });
      };
      loadOrders();
      var ordRefresh = el('ord-refresh');
      if (ordRefresh) ordRefresh.addEventListener('click', loadOrders);

      /* Конструктор счета: собираем позиции из тарифов/допов, каждую правим, итог сам.
         Тариф раскладываем на позицию (по дефолту его цена — можно поменять/скинуть),
         допы добавляем сверху. Бэк принимает items[] + amount_total. */
      var tariffById = {}, ordItems = [];
      var ordMenu = el('ord-menu'), ordAddBtn = el('ord-addbtn');
      var addItem;  // задаётся ниже
      var closeMenu = function () { if (ordMenu) { ordMenu.hidden = true; ordAddBtn.classList.remove('on'); } };
      if (ordAddBtn) ordAddBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        ordMenu.hidden = !ordMenu.hidden;
        ordAddBtn.classList.toggle('on', !ordMenu.hidden);
      });
      document.addEventListener('click', function (e) { if (ordMenu && !ordMenu.hidden && !ordMenu.contains(e.target) && e.target !== ordAddBtn) closeMenu(); });
      api('/api/tariffs').then(function (r) {
        var tar = [], add = [];
        (r.tariffs || []).forEach(function (t) { tariffById[t.id] = t; (/^addon-/.test(t.id) ? add : tar).push(t); });
        var chips = function (label, list, cls) {
          if (!list.length) return '';
          return '<div class="ordm-g">' + esc(label) + '</div><div class="ordm-chips">' + list.map(function (t) {
            var price = t.price_amount ? fmtMoney(t.price_amount) + ' ₽' : (t.price_note || '');
            return '<button type="button" class="ordm-chip ' + cls + '" data-tid="' + esc(t.id) + '">' +
              '<span class="ordm-n">' + esc(t.name) + '</span>' + (price ? '<span class="ordm-p num">' + esc(price) + '</span>' : '') + '</button>';
          }).join('') + '</div>';
        };
        ordMenu.innerHTML = chips('Тарифы', tar, 'tar') + chips('Дополнительные услуги', add, 'add') +
          '<div class="ordm-chips"><button type="button" class="ordm-chip custom" data-tid="__custom">' + ic('plus', 12) + 'Своя позиция</button></div>';
        Array.prototype.forEach.call(ordMenu.querySelectorAll('.ordm-chip'), function (b) {
          b.addEventListener('click', function () { addItem(b.getAttribute('data-tid')); closeMenu(); });
        });
      }).catch(function () {});

      var renderItems = function () {
        var host = el('ord-items'); if (!host) return;
        if (!ordItems.length) { host.innerHTML = '<div class="ord-empty">Пусто. Добавьте тариф или услугу сверху — соберите счет из позиций.</div>'; }
        else host.innerHTML = ordItems.map(function (it, i) {
          return '<div class="ord-row" data-i="' + i + '">' +
            '<input class="ord-it-t" data-i="' + i + '" value="' + esc(it.title) + '" placeholder="Название позиции">' +
            '<input class="ord-it-a num" data-i="' + i + '" inputmode="numeric" value="' + (it.amount || '') + '" placeholder="₽">' +
            '<button class="icobtn del ord-it-x" data-i="' + i + '" title="Убрать">' + ic('x', 14) + '</button></div>';
        }).join('');
        var total = ordItems.reduce(function (s, it) { return s + (parseInt(it.amount, 10) || 0); }, 0);
        el('ord-total-v').textContent = fmtMoney(total) + ' ₽';
        el('ord-btn-lbl').textContent = total ? 'Выставить счет · ' + fmtMoney(total) + ' ₽' : 'Выставить счет';
        // навесить правку/удаление
        Array.prototype.forEach.call(host.querySelectorAll('.ord-it-t'), function (n) {
          n.addEventListener('input', function () { ordItems[+n.getAttribute('data-i')].title = n.value; });
        });
        Array.prototype.forEach.call(host.querySelectorAll('.ord-it-a'), function (n) {
          n.addEventListener('input', function () {
            ordItems[+n.getAttribute('data-i')].amount = parseInt(n.value.replace(/\D/g, ''), 10) || 0;
            var total = ordItems.reduce(function (s, it) { return s + (it.amount || 0); }, 0);
            el('ord-total-v').textContent = fmtMoney(total) + ' ₽';
            el('ord-btn-lbl').textContent = total ? 'Выставить счет · ' + fmtMoney(total) + ' ₽' : 'Выставить счет';
          });
        });
        Array.prototype.forEach.call(host.querySelectorAll('.ord-it-x'), function (b) {
          b.addEventListener('click', function () { ordItems.splice(+b.getAttribute('data-i'), 1); renderItems(); });
        });
      };
      renderItems();

      addItem = function (v) {
        if (!v) return;
        if (v === '__custom') { ordItems.push({ title: '', amount: 0, product_id: null }); renderItems();
          setTimeout(function () { var ins = el('ord-items').querySelector('.ord-row:last-child .ord-it-t'); if (ins) ins.focus(); }, 20); return; }
        var t = tariffById[v]; if (!t) return;
        ordItems.push({ title: t.name, amount: t.price_amount ? Math.round(t.price_amount) : 0, product_id: t.id });
        renderItems();
      };

      var ordMode = 'full', ordModeEl = el('ord-mode');
      if (ordModeEl) Array.prototype.forEach.call(ordModeEl.children, function (b) {
        b.addEventListener('click', function () {
          ordMode = b.getAttribute('data-v');
          Array.prototype.forEach.call(ordModeEl.children, function (x) { x.classList.toggle('on', x === b); });
          el('ord-n-wrap').hidden = ordMode !== 'installment';
        });
      });
      var ordBtn = el('ord-add-btn');
      if (ordBtn) ordBtn.addEventListener('click', function () {
        var items = ordItems.filter(function (it) { return (it.title || '').trim() && (it.amount || 0) > 0; });
        if (!items.length) { showToast('Добавьте хотя бы одну позицию с суммой'); return; }
        var total = items.reduce(function (s, it) { return s + it.amount; }, 0);
        var n = Math.max(2, parseInt(el('ord-n').value, 10) || 4);
        // название счета = единственная позиция или «тариф + N услуг»
        var title = items.length === 1 ? items[0].title : (items[0].title + ' + ещё ' + (items.length - 1));
        ordBtn.disabled = true;
        api('/admin/api/leads/' + id + '/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            items: items.map(function (it) { return { product_id: it.product_id || null, title: it.title, amount: it.amount, qty: 1 }; }),
            amount_total: total,
            pay_mode: ordMode, installments_count: ordMode === 'installment' ? n : 1,
          }),
        }).then(function () {
          ordBtn.disabled = false;
          ordItems = []; renderItems();
          showToast('Счет выставлен — клиент увидит его в кабинете');
          loadOrders();
        }).catch(function (e) {
          ordBtn.disabled = false;
          if (e.message !== '403') showToast('Счет не выставился — проверьте сеть');
        });
      });
    }

    var payBtn = el('pay-add-btn');
    if (payBtn) {
      var payStEl = el('pay-st'), payStatus = 'paid';
      if (payStEl) Array.prototype.forEach.call(payStEl.children, function (b) {
        b.addEventListener('click', function () {
          payStatus = b.getAttribute('data-v');
          Array.prototype.forEach.call(payStEl.children, function (x) { x.classList.toggle('on', x === b); });
        });
      });
      payBtn.addEventListener('click', function () {
        var title = (el('pay-title').value || '').trim();
        var amt = parseInt((el('pay-amt').value || '').replace(/\D/g, ''), 10) || 0;
        var date = el('pay-date') && el('pay-date').value ? el('pay-date').value : todayISO(0);
        if (!title) { el('pay-title').focus(); return; }
        var body = { title: title, amount_rub: amt, status: payStatus };
        if (payStatus === 'paid' || payStatus === 'refunded') body.paid_at = date;
        apiSend('/admin/api/leads/' + id + '/payments', 'POST', body, function (r) {
          if (stagedRcpt && r && r.id) {  // догружаем квитанцию и привязываем к созданной оплате
            var pid = r.id;
            uploadReceipt(stagedRcpt, function (docId) {
              stagedRcpt = null;
              if (docId) apiSend('/admin/api/payments/' + pid, 'PATCH', { receipt_doc_id: docId }, reloadPay);
              else reloadPay();
            });
          } else { reloadPay(); }
        });
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-delpay]'), function (b) {
      b.addEventListener('click', function () {
        var row = b.closest('.pay-row'); if (row) { row.style.opacity = '.4'; row.style.pointerEvents = 'none'; }
        apiSend('/admin/api/payments/' + b.getAttribute('data-delpay'), 'DELETE', null, function () {
          refreshDetail(id, function () { if (state.drawerId === id && state.modalSection === 'pay') renderDrawer(true); });
        });
      });
    });

    // инлайн-эдит контакт/email/город (раздел «Сейчас»)
    Array.prototype.forEach.call(host.querySelectorAll('.ef-v[data-edit]'), function (n) {
      bindInline(n, n.getAttribute('data-edit'), {
        ph: { contact: '@username или +7…', email: 'email', city: 'Город' }[n.getAttribute('data-edit')] });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.ef-copy[data-copy]'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); copyText(b.getAttribute('data-copy'), b); });
    });
    // свёртка анкеты в Разборе AI
    Array.prototype.forEach.call(host.querySelectorAll('.qa-fold .m-sec-h'), function (h) {
      h.addEventListener('click', function () { h.parentNode.classList.toggle('open'); });
    });
    // переключатель AI в диалоге (демо — храним локально) + взять/вернуть
    function setDlgAi(on) {
      state.dialogAi[id] = on;
      var dlg = getDialog(ctx.lead || ctx.base);
      if (on) dlg.handoff_req = false;
      renderModalContent();
      showToast(on ? 'AI снова ведёт диалог' : 'Диалог за тобой — AI выключен');
    }
    var aiT = el('dlg-ai');
    if (aiT) aiT.addEventListener('click', function () { setDlgAi(!getDialog(ctx.lead || ctx.base).ai_on); });
    var tk = el('dlg-take'); if (tk) tk.addEventListener('click', function () { setDlgAi(false); });
    var rt = el('dlg-return'); if (rt) rt.addEventListener('click', function () { setDlgAi(true); });

    // раздел «Написать»: режим/отправка/история
    if (state.modalSection === 'notify') {
      var ntfMode = 'event';
      var modeBar = el('ntf-mode');
      if (modeBar) Array.prototype.forEach.call(modeBar.children, function (b) {
        b.addEventListener('click', function () {
          ntfMode = b.getAttribute('data-m');
          Array.prototype.forEach.call(modeBar.children, function (x) { x.classList.toggle('on', x === b); });
          var inp = el('ntf-input');
          if (inp) inp.placeholder = ntfMode === 'event'
            ? 'Опиши, что написать — например: «напомни о созвоне завтра, предложи перенести»'
            : 'Готовый текст сообщения — отправится как есть';
        });
      });
      function loadNtfLog() {
        var log = el('ntf-log'); if (!log) return;
        log.innerHTML = '<span class="shim" style="display:block;width:60%;height:11px;border-radius:6px"></span>';
        api('/admin/api/leads/' + id + '/notifications').then(function (r) {
          var items = (r && r.notifications) || [];
          log.innerHTML = items.length ? items.map(function (n) {
            var ok = n.status === 'delivered';
            return '<div class="ntf-row' + (ok ? '' : ' skip') + '">' +
              '<span class="ntf-ic">' + ic(ok ? 'check' : 'x', 13) + '</span>' +
              '<div class="ntf-b"><div class="ntf-t">' + esc((n.body || n.event || '').slice(0, 140)) + '</div>' +
              '<div class="ntf-m num">' + (ok ? 'доставлено' : 'не отправлено' + (n.reason ? ' · ' + esc(n.reason) : '')) + ' · ' + fmtWhen(n.at) + '</div></div></div>';
          }).join('') : '<div class="field-empty">Пока ничего не отправлено.</div>';
        }).catch(function () { log.innerHTML = '<div class="field-empty">Не удалось загрузить историю.</div>'; });
      }
      loadNtfLog();
      var rf = el('ntf-refresh'); if (rf) rf.addEventListener('click', loadNtfLog);
      var sendBtn = el('ntf-send'), ntfInput = el('ntf-input'), ntfState = el('ntf-state');
      function ntfSend() {
        if (!ntfInput) return;
        var v = ntfInput.value.trim(); if (!v) { ntfInput.focus(); return; }
        if (sendBtn) { sendBtn.disabled = true; }
        if (ntfState) ntfState.textContent = 'отправляю…';
        var body = ntfMode === 'event' ? { event: v } : { text: v };
        apiSend('/admin/api/leads/' + id + '/notify', 'POST', body, function (res) {
          if (sendBtn) sendBtn.disabled = false;
          ntfInput.value = '';
          if (res && res.ok) { if (ntfState) ntfState.textContent = 'отправлено'; showToast('Отправлено клиенту'); }
          else { if (ntfState) ntfState.textContent = (res && res.error) ? esc(res.error) : 'не отправлено'; showToast('Не отправлено — нет Telegram у клиента или бот недоступен'); }
          loadNtfLog();
        });
      }
      if (sendBtn) sendBtn.addEventListener('click', ntfSend);
      if (ntfInput) ntfInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ntfSend(); }
      });
    }
  }
  function uploadDoc(id, file) {
    if (file.size > 12 * 1024 * 1024) { showToast('Файл больше 12 МБ'); return; }
    // моментальный фидбек — не ждём сервер
    var drop = el('m-drop');
    if (drop) { drop.classList.add('loading'); drop.innerHTML = '<div class="dz-ic">' + ic('dl', 18) + '</div><div><b>Загружаю</b> ' + esc(file.name) + '…</div>'; }
    var reader = new FileReader();
    reader.onload = function () {
      apiSend('/admin/api/leads/' + id + '/docs', 'POST',
        { name: file.name, mime: file.type || 'application/octet-stream', data_base64: String(reader.result) },
        function () { refreshDetail(id, function () { if (state.drawerId === id && state.modalSection === 'docs') renderDrawer(true); }); });
    };
    reader.readAsDataURL(file);
  }

  function sec(title, inner, extra) {
    if (!inner) return '';
    return '<div class="dr-sec"><div class="dr-h">' + title + (extra || '') + '</div>' + inner + '</div>';
  }

  /* ════ ВИТРИНА — продукты, которые семья видит на платформе ════
     Источник: каталог GET /api/products + lead_crm.offers ([{pid,on,reason,src,bought}]).
     AI-подбор: POST /admin/api/leads/:id/offers/ai {prompt} → {offers}. Сохранение —
     PATCH /admin/api/leads/:id {offers}. Включённые (on) продукты семья видит на
     платформе с фразой reason; bought — куплено, на витрину не возвращаем. */
  var PRODUCT_CAT_RU = { flagship: 'Флагман', strategy: 'Стратегия', language: 'Язык',
    exam: 'Экзамены', profile: 'Усиление профиля', documents: 'Документы', grants: 'Гранты',
    discovery: 'Профориентация', admissions: 'Поступление', short_program: 'Поездки', service: 'Сервис' };
  var PRODUCT_CAT_ORDER = ['flagship', 'strategy', 'short_program', 'discovery', 'language',
    'exam', 'profile', 'documents', 'grants', 'admissions', 'service'];

  function fetchCatalog(cb) {
    if (state._catalog) { cb(state._catalog); return; }
    api('/api/products').then(function (r) {
      state._catalog = Array.isArray(r) ? r : [];
      cb(state._catalog);
    }).catch(function (e) { if (e.message !== '403') cb(null); });
  }

  function fmtPrice(p) {
    if (p.price_amount == null) return 'по запросу';
    var n = Math.round(p.price_amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return n + ' ₽' + (p.price_note ? ' · ' + p.price_note : '');
  }

  function leadOffers(id) {
    var d = state.details[id];
    return (d && d.crm && Array.isArray(d.crm.offers)) ? d.crm.offers : [];
  }

  /* Витрина = то, что реально увидит родитель, поэтому и собрана она как экран родителя:
     сверху шапка блока (ее текст правится тут же), ниже карточки в том порядке, в каком
     они лягут в кабинете, у каждой — персональный заголовок и фраза «почему это вам».
     Каталог целиком не вываливаем: он живет ниже, свернутым, как источник добавления. */
  function offerRow(p, o, i, total) {
    var pitch = o.pitch || '';
    return '<div class="of-card" data-pid="' + esc(p.id) + '">' +
      '<div class="of-c-h">' +
        '<span class="of-num num">' + (i + 1) + '</span>' +
        '<span class="of-c-n">' + esc(p.name) + '</span>' +
        (o.src === 'ai' ? '<span class="of-src">' + ic('spark', 10) + 'AI</span>' : '') +
        '<span class="of-c-sp"></span>' +
        '<span class="of-ord">' +
          '<button class="of-mv" data-mv="up" data-pid="' + esc(p.id) + '"' + (i === 0 ? ' disabled' : '') + ' title="Выше">' + ic('go', 12) + '</button>' +
          '<button class="of-mv dn" data-mv="down" data-pid="' + esc(p.id) + '"' + (i === total - 1 ? ' disabled' : '') + ' title="Ниже">' + ic('go', 12) + '</button>' +
        '</span>' +
        '<button class="of-rm" data-ofoff="' + esc(p.id) + '" title="Убрать из витрины">' + ic('x', 12) + '</button>' +
      '</div>' +
      // то, что родитель видит на самой карточке
      '<label class="of-f"><span class="of-lb">Заголовок карточки</span>' +
        '<input class="of-hl" data-ofhl="' + esc(p.id) + '" maxlength="90" value="' + esc(o.headline || '') + '"' +
        ' placeholder="3-6 слов: польза для этого ребенка"></label>' +
      '<label class="of-f"><span class="of-lb">Короткая фраза под заголовком</span>' +
        '<textarea class="of-reason" data-ofreason="' + esc(p.id) + '" maxlength="300" rows="2"' +
        ' placeholder="Почему это им — одно-два предложения">' + esc(o.reason || '') + '</textarea></label>' +
      // длинный текст: его родитель читает, открыв карточку
      '<details class="of-pitch"' + (pitch ? '' : '') + '>' +
        '<summary><span class="of-lb">Полный текст — родитель видит, открыв карточку</span>' +
          '<span class="of-pl' + (pitch ? ' has' : '') + '">' +
            (pitch ? pitch.length + ' знаков' : 'пусто — покажем общее описание') + '</span></summary>' +
        '<textarea class="of-pitch-in" data-ofpitch="' + esc(p.id) + '" maxlength="1400" rows="7"' +
          ' placeholder="Зачем это нужно именно их ребенку: что у него сейчас, что мы делаем, что будет на выходе и кому это не нужно. 3-5 абзацев.">' + esc(pitch) + '</textarea>' +
      '</details>' +
      '<div class="of-c-f">' +
        '<label class="of-pr"><input type="checkbox" data-ofprice="' + esc(p.id) + '"' +
          (o.price_show === false ? '' : ' checked') + '><span>Показывать цену</span></label>' +
        '<span class="of-c-price num">' + esc(fmtPrice(p)) + '</span>' +
      '</div>' +
    '</div>';
  }

  function buildOffersSection(ctx) {
    if (!state._catalog) {
      fetchCatalog(function () { if (state.modalSection === 'offers') renderModalContent(); });
      return skeletonSection('offers');
    }
    var id = state.drawerId;
    var catalog = state._catalog;
    var byPid = {}; catalog.forEach(function (p) { byPid[p.id] = p; });
    var saved = {};
    leadOffers(id).forEach(function (o) { if (o && o.pid) saved[o.pid] = o; });
    var meta = leadShowcaseMeta(id);

    // витрину кто-то трогал руками или через AI → алгоритм ее больше не пересобирает
    var authored = Object.keys(saved).some(function (pid) {
      return saved[pid].src === 'mgr' || saved[pid].src === 'ai';
    });
    var shown = Object.keys(saved)
      .filter(function (pid) { var o = saved[pid]; return o.on && !o.bought && byPid[pid]; })
      .sort(function (a, b) { return (saved[a].pos || 0) - (saved[b].pos || 0); });
    var bought = Object.keys(saved).filter(function (pid) { return saved[pid].bought && byPid[pid]; });

    var html = '<div class="m-ctitle">Витрина продуктов</div>' +
      '<div class="m-csub">Ровно это родитель увидит у себя в кабинете. Тексты — персональные: ' +
      'их пишете вы или AI справа. Пока витрину никто не трогал, она живет сама: ' +
      'пересобирается под этап пути и то, что семья уже купила. Как только вы или AI ее правите — ' +
      'алгоритм отходит в сторону и больше в нее не лезет.</div>';

    // шапка блока предложений у родителя
    html += '<div class="of-banner">' +
      '<input class="of-bt" id="of-bt" maxlength="120" value="' + esc(meta.title || '') + '"' +
        ' placeholder="Заголовок блока у родителя — «Для Артема: что усилит путь»">' +
      '<input class="of-bn" id="of-bn" maxlength="240" value="' + esc(meta.note || '') + '"' +
        ' placeholder="Строка под заголовком — одна спокойная фраза">' +
    '</div>';

    html += '<div class="of-bar">' +
      '<span class="of-cnt' + (shown.length ? ' has' : '') + '">В витрине: <b class="num">' + shown.length + '</b></span>' +
      '<span class="of-mode' + (authored ? ' mgr' : '') + '">' +
        (authored ? 'настроена вручную' : 'собирается автоматически') + '</span>' +
      '<button class="bp ghost sm" id="of-def" title="Вернуть автоматический подбор: набор и тексты соберутся заново по этапу пути, классу и покупкам. Ваши правки в витрине пропадут.">' +
        ic('refresh', 13) + 'Пересобрать заново</button>' +
    '</div>';

    if (!shown.length) {
      html += '<div class="of-empty"><div class="of-empty-t">Витрина пустая</div>' +
        '<div class="of-empty-s">Родитель предложений не видит. Скажите AI справа, что подобрать, ' +
        'или соберите по умолчанию — потом поправите руками.</div></div>';
    } else {
      html += '<div class="of-cards">' +
        shown.map(function (pid, i) { return offerRow(byPid[pid], saved[pid], i, shown.length); }).join('') +
        '</div>';
    }

    if (bought.length) {
      html += '<div class="of-sub-h">Уже куплено</div><div class="of-bought">' +
        bought.map(function (pid) {
          return '<span class="of-bt-chip">' + ic('check', 11) + esc(byPid[pid].name) + '</span>';
        }).join('') + '</div>';
    }

    // каталог — источник добавления, свернут по категориям
    var byCat = {};
    catalog.forEach(function (p) {
      if (saved[p.id] && (saved[p.id].on || saved[p.id].bought)) return;
      (byCat[p.category] = byCat[p.category] || []).push(p);
    });
    var cats = PRODUCT_CAT_ORDER.filter(function (c) { return byCat[c]; })
      .concat(Object.keys(byCat).filter(function (c) { return PRODUCT_CAT_ORDER.indexOf(c) === -1; }));
    if (cats.length) {
      html += '<details class="of-more"' + (shown.length ? '' : ' open') + '>' +
        '<summary>Добавить из каталога</summary><div class="of-more-b">';
      cats.forEach(function (cat) {
        html += '<div class="of-group">' + esc(PRODUCT_CAT_RU[cat] || cat) + '</div>';
        byCat[cat].forEach(function (p) {
          html += '<div class="of-add" data-pid="' + esc(p.id) + '">' +
            '<div class="of-a-i"><div class="of-name">' + esc(p.name) + '</div>' +
            '<div class="of-desc">' + esc(p.description || '') + '</div></div>' +
            '<span class="of-price num">' + esc(fmtPrice(p)) + '</span>' +
            '<button class="bp ghost sm of-plus" data-ofon="' + esc(p.id) + '">В витрину</button>' +
          '</div>';
        });
      });
      html += '</div></details>';
    }
    return html;
  }

  function leadShowcaseMeta(id) {
    var d = state.details[id];
    return (d && d.crm && d.crm.showcaseMeta) || {};
  }

  /* Собрать полный массив offers из DOM + сохраненного состояния. Порядок = порядок карточек. */
  function collectOffers(id) {
    var saved = {};
    leadOffers(id).forEach(function (o) { if (o && o.pid) saved[o.pid] = o; });
    var out = [];
    var pos = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.of-card[data-pid]'), function (card) {
      var pid = card.getAttribute('data-pid');
      var was = saved[pid] || {};
      var hl = card.querySelector('.of-hl'), rs = card.querySelector('.of-reason'),
          pt = card.querySelector('.of-pitch-in'), pr = card.querySelector('[data-ofprice]');
      var headline = hl ? hl.value.trim() : (was.headline || '');
      var reason = rs ? rs.value.trim() : (was.reason || '');
      var pitch = pt ? pt.value.trim() : (was.pitch || '');
      var priceShow = pr ? pr.checked : (was.price_show !== false);
      // src переводим в «менеджер», только если куратор реально изменил текст
      var same = headline === (was.headline || '') && reason === (was.reason || '') &&
                 pitch === (was.pitch || '') &&
                 priceShow === (was.price_show !== false) && was.on;
      out.push({ pid: pid, on: true, bought: false, src: same ? (was.src || 'mgr') : 'mgr',
                 reason: reason, headline: headline, pitch: pitch,
                 pos: pos++, price_show: priceShow });
    });
    // все остальное сохраняем как было (скрытые и купленные)
    Object.keys(saved).forEach(function (pid) {
      if (out.some(function (o) { return o.pid === pid; })) return;
      var o = saved[pid];
      out.push({ pid: pid, on: false, bought: !!o.bought, src: o.src || 'mgr',
                 reason: o.reason || '', headline: o.headline || '', pitch: o.pitch || '',
                 pos: pos++, price_show: o.price_show !== false });
    });
    return out;
  }

  function collectShowcaseMeta(id) {
    var t = el('of-bt'), n = el('of-bn');
    var meta = Object.assign({}, leadShowcaseMeta(id));
    if (t) meta.title = t.value.trim();
    if (n) meta.note = n.value.trim();
    if (t || n) meta.src = 'mgr';
    return meta;
  }

  function saveOffers(id, offers, meta, cb) {
    var d = state.details[id];
    if (d && d.crm) {
      d.crm.offers = offers;
      if (meta) d.crm.showcaseMeta = meta;
      cacheSet(id, d);
    }
    var body = { offers: offers };
    if (meta) body.showcase_meta = meta;
    apiSend('/admin/api/leads/' + id, 'PATCH', body, function () { if (cb) cb(); });
  }

  /* сохранить текущее состояние DOM и перерисовать секцию */
  function offersApply(id, redraw) {
    saveOffers(id, collectOffers(id), collectShowcaseMeta(id));
    if (redraw) renderModalContent();
  }

  function wireOffersSection(id) {
    var host = el('m-content');
    if (!host) return;

    function setOn(pid, on) {
      var offers = collectOffers(id);
      var row = offers.filter(function (o) { return o.pid === pid; })[0];
      if (!row) { offers.push({ pid: pid, on: on, bought: false, src: 'mgr', reason: '', headline: '', pitch: '', pos: offers.length, price_show: true }); }
      else { row.on = on; row.src = 'mgr'; if (on) row.pos = -1; }
      offers.sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
      offers.forEach(function (o, i) { o.pos = i; });
      saveOffers(id, offers, collectShowcaseMeta(id));
      renderModalContent();
    }

    Array.prototype.forEach.call(host.querySelectorAll('[data-ofon]'), function (b) {
      b.addEventListener('click', function () { setOn(b.getAttribute('data-ofon'), true); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-ofoff]'), function (b) {
      b.addEventListener('click', function () { setOn(b.getAttribute('data-ofoff'), false); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-mv]'), function (b) {
      b.addEventListener('click', function () {
        var card = b.closest('.of-card'), box = card && card.parentNode;
        if (!card || !box) return;
        if (b.getAttribute('data-mv') === 'up' && card.previousElementSibling) {
          box.insertBefore(card, card.previousElementSibling);
        } else if (b.getAttribute('data-mv') === 'down' && card.nextElementSibling) {
          box.insertBefore(card.nextElementSibling, card);
        }
        offersApply(id, true);
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.of-hl, .of-reason, .of-pitch-in, .of-bt, .of-bn'), function (inp) {
      inp.addEventListener('change', function () { offersApply(id); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-ofprice]'), function (inp) {
      inp.addEventListener('change', function () { offersApply(id); });
    });

    var def = el('of-def');
    if (def) def.addEventListener('click', function () {
      if (!window.confirm('Пересобрать витрину заново по этапу пути, классу и покупкам? Ваши правки и тексты AI в ней пропадут.')) return;
      def.disabled = true;
      api('/admin/api/leads/' + id + '/offers/default', { method: 'POST' }).then(function (r) {
        var d = state.details[id];
        if (d && d.crm) { d.crm.offers = (r && r.offers) || []; d.crm.showcaseMeta = (r && r.showcaseMeta) || {}; cacheSet(id, d); }
        showToast('Собрал витрину по умолчанию');
        renderModalContent();
      }).catch(function (e) {
        def.disabled = false;
        if (e.message !== '403') showToast('Не получилось собрать витрину');
      });
    });
  }

  /* ── ЧАТ ВИТРИНЫ (правый столбец секции «Витрина») ──────────────────────────
     Тот же агент-коллега, что и в «Поступлении», только предметная область другая:
     он правит витрину операциями, а бэкенд их применяет и сохраняет сам. */
  var OCHAT = {}, OCHAT_LOADED = {}, OCHAT_BUSY = {};

  function offersChatPanel(id) {
    var msgs = OCHAT[id] || [];
    var empty = !leadOffers(id).some(function (o) { return o && o.on && !o.bought; });
    var body;
    if (!OCHAT_LOADED[id]) {
      body = '<div class="pchat-empty">Загружаю…</div>';
    } else if (!msgs.length) {
      var hints = empty
        ? ['Подбери витрину под этого клиента',
           'Собери витрину: бюджет ограничен, начни с входного продукта',
           'Что этой семье сейчас реально нужно?']
        : ['Перепиши описания под их ситуацию',
           'Убери лишнее — оставь два самых важных',
           'Сделай заголовки мягче, родитель тревожный'];
      body = '<div class="pchat-empty">' +
        '<div class="pchat-empty-t">' + (empty ? 'Витрины еще нет' : 'Скажите, что поправить') + '</div>' +
        '<div class="pchat-empty-s">' + (empty
          ? 'Подберу продукты по анкете, диагностике и этапу пути и напишу тексты для родителя.'
          : 'Правлю точечно: набор, тексты, порядок и заголовок блока у родителя.') + '</div>' +
        '<div class="pchat-hints">' +
          hints.map(function (h) {
            return '<button class="pchat-hint" data-ohint="' + esc(h) + '">' + esc(h) + '</button>';
          }).join('') +
        '</div></div>';
    } else {
      body = msgs.map(function (m) {
        if (m.me) return '<div class="pchat-m me"><div class="pchat-b">' + esc(m.text) + '</div></div>';
        return '<div class="pchat-m ai"><div class="pchat-b">' + esc(m.text) + '</div>' +
          ochatReport(m.report) + '</div>';
      }).join('');
    }
    if (OCHAT_BUSY[id]) {
      body += '<div class="pchat-m ai"><div class="pchat-b pchat-wait">' +
        '<span class="pchat-dots"><i></i><i></i><i></i></span>' +
        '<span class="pchat-wait-t" id="ochat-wait-t">Читаю профиль клиента</span></div></div>';
    }
    return '<aside class="pchat" id="ochat">' +
      '<div class="pchat-head">' + ic('spark', 14) +
        '<span class="pchat-title">Витрина с AI</span>' +
      '</div>' +
      '<div class="pchat-list" id="ochat-list">' + body + '</div>' +
      '<div class="pchat-foot">' +
        '<textarea class="pchat-in" id="ochat-in" rows="1" placeholder="' +
          (empty ? 'Что подобрать этой семье?' : 'Что поправить в витрине?') + '"' +
          (OCHAT_BUSY[id] ? ' disabled' : '') + '></textarea>' +
        '<button class="pchat-go" id="ochat-go" title="Отправить"' +
          (OCHAT_BUSY[id] ? ' disabled' : '') + '>' + ic('go', 14) + '</button>' +
      '</div>' +
    '</aside>';
  }

  /* Что AI сделал с витриной: куратору важно видеть не «поправил», а что именно стало
     другим — тексты читает родитель, тихая подмена недопустима. */
  function ochatReport(report) {
    if (!Array.isArray(report) || !report.length) return '';
    var VERB = { show: 'Поставил', hide: 'Убрал', edit: 'Поправил', order: 'Порядок', banner: 'Шапка' };
    var FIELD = { reason: 'фраза для родителя', headline: 'заголовок', price_show: 'цена',
      title: 'заголовок блока', note: 'подпись' };
    var ok = report.filter(function (r) { return r.ok; });
    var bad = report.filter(function (r) { return !r.ok && r.why && r.why !== 'нечего менять'; });
    if (!ok.length && !bad.length) return '';
    var rows = ok.map(function (r) {
      var diff = '';
      if (Array.isArray(r.changes) && r.changes.length) {
        diff = '<div class="pchat-diff">' + r.changes.map(function (c) {
          var from = c.from === true ? 'видна' : c.from === false ? 'скрыта' : (c.from || '—');
          var to = c.to === true ? 'видна' : c.to === false ? 'скрыта' : (c.to || '—');
          return '<div class="pchat-df"><span class="pchat-df-f">' + esc(FIELD[c.field] || c.field) + '</span>' +
            '<span class="pchat-df-a">' + esc(String(from).slice(0, 90)) + '</span>' +
            '<span class="pchat-df-ar">→</span>' +
            '<span class="pchat-df-b">' + esc(String(to).slice(0, 90)) + '</span></div>';
        }).join('') + '</div>';
      }
      var title = r.name || (r.names ? r.names.join(' · ') : '');
      return '<div class="pchat-rw ' + esc(r.op === 'hide' ? 'remove' : r.op === 'show' ? 'add' : 'edit') + '">' +
        '<div class="pchat-rw-h"><span class="pchat-rw-v">' + (VERB[r.op] || r.op) + '</span></div>' +
        (title ? '<div class="pchat-rw-t">' + esc(title) + '</div>' : '') + diff + '</div>';
    }).join('');
    var badRow = '';
    if (bad.length) {
      var why = bad.map(function (r) { return r.why; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      badRow = '<div class="pchat-rw bad"><div class="pchat-rw-h">' +
        '<span class="pchat-rw-v">Не применил</span>' +
        '<span class="pchat-rw-st">' + bad.length + '</span></div>' +
        '<div class="pchat-rw-t">' + esc(why.join('; ')) + '</div></div>';
    }
    return '<div class="pchat-rep">' + rows + badRow + '</div>';
  }

  function loadOffersChat(id) {
    if (OCHAT_LOADED[id]) return;
    api('/admin/api/leads/' + id + '/offers/chat').then(function (r) {
      OCHAT[id] = [];
      (r && r.messages || []).forEach(function (m) {
        OCHAT[id].push({ me: true, text: m.message });
        OCHAT[id].push({ me: false, text: m.reply, report: m.report });
      });
      OCHAT_LOADED[id] = true;
      if (state.drawerId === id && state.modalSection === 'offers') renderDrawer(true);
    }).catch(function () {
      OCHAT_LOADED[id] = true;
      if (state.drawerId === id && state.modalSection === 'offers') renderDrawer(true);
    });
  }

  function ochatSend(id, text) {
    if (!text || OCHAT_BUSY[id]) return;
    OCHAT[id] = OCHAT[id] || [];
    OCHAT[id].push({ me: true, text: text });
    OCHAT_BUSY[id] = true;
    renderDrawer(true);
    api('/admin/api/leads/' + id + '/offers/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    }).then(function (r) {
      OCHAT_BUSY[id] = false;
      OCHAT[id].push({ me: false, text: (r && r.reply) || 'Готово.', report: r && r.report });
      // бэкенд применил операции и сохранил сам — забираем готовую витрину
      if (r && r.changed) {
        var d = state.details[id];
        if (d && d.crm) {
          if (Array.isArray(r.offers)) d.crm.offers = r.offers;
          if (r.showcaseMeta) d.crm.showcaseMeta = r.showcaseMeta;
          cacheSet(id, d);
        }
      }
      renderDrawer(true);
    }).catch(function (e) {
      OCHAT_BUSY[id] = false;
      if (!(e && e.message === '403')) {
        OCHAT[id].push({ me: false, text: 'Не получилось — AI не ответил. Попробуйте еще раз.' });
      }
      renderDrawer(true);
    });
  }

  function bindOffersChat(id) {
    var inp = el('ochat-in'), go = el('ochat-go');
    var fire = function () {
      if (!inp) return;
      var v = (inp.value || '').trim();
      if (v) { inp.value = ''; ochatSend(id, v); }
    };
    if (go) go.addEventListener('click', fire);
    if (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire(); }
      });
      inp.addEventListener('input', function () {
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 132) + 'px';
      });
    }
    var list = el('ochat-list');
    if (list) list.scrollTop = list.scrollHeight;
    Array.prototype.forEach.call(document.querySelectorAll('[data-ohint]'), function (b) {
      b.addEventListener('click', function () { ochatSend(id, b.getAttribute('data-ohint')); });
    });
    if (OCHAT_BUSY[id]) {
      var steps = ['Читаю профиль клиента', 'Сверяю с продуктовой матрицей', 'Пишу тексты для родителя'];
      var i = 0;
      var t = setInterval(function () {
        var n = el('ochat-wait-t');
        if (!n || !OCHAT_BUSY[id]) { clearInterval(t); return; }
        i = Math.min(i + 1, steps.length - 1);
        n.textContent = steps[i];
      }, 4500);
    }
  }

  function aiSec(title, inner, hr) {
    if (!inner) return '';
    return '<div class="m-sec' + (hr ? ' qa-fold' : '') + '"><div class="m-sec-h">' + title +
      (hr ? '<span class="hr">' + hr + '</span>' : '') + '</div>' +
      (hr ? '<div class="qa-wrap">' + inner + '</div>' : inner) + '</div>';
  }

  function buildAiSections(d) {
    var diag = d.diagnostics || {};
    var plan = d.roadmap || {};
    var answers = d.answers || {};
    var html = '<div class="m-ctitle">Диагностика</div>' +
      '<div class="m-csub">Что AI показал человеку на платформе — с этим заходить на созвон.</div>';

    var v = diag.verdict || {};
    var score = diag.score;
    var tone = (score != null) ? scoreTone(score) : null;

    /* верхний блок — балл-кольцо + вердикт */
    if (score != null || v.headline || v.text) {
      var ring = (score != null && tone)
        ? '<div class="diag-ring" style="--p:' + Math.max(0, Math.min(100, score)) + '; --rc:' + tone.c + '">' +
            '<div class="dr-in"><b class="num" style="color:' + tone.c + '">' + score + '</b><small>из 100</small></div></div>'
        : '';
      var vtxt = '<div class="diag-vtext">' +
        '<span class="diag-vlabel"' + (tone ? ' style="color:' + tone.c + '"' : '') + '>' + ic('spark', 12) + (tone ? esc(tone.label) : 'Вердикт AI') + '</span>' +
        (v.headline ? '<div class="diag-vh">' + esc(v.headline) + '</div>' : '') +
        (v.text ? '<div class="diag-vs">' + esc(v.text) + '</div>' : '') +
      '</div>';
      html += '<div class="diag-top">' + ring + vtxt + '</div>';
    }

    /* разрыв «сейчас → цель → мост» */
    if (diag.gap && (diag.gap.point_a || diag.gap.point_b || diag.gap.bridge)) {
      html += '<div class="m-sec"><div class="ai-gap">' +
        (diag.gap.point_a ? '<div class="gr"><span class="gk">Сейчас</span><span class="gv">' + esc(diag.gap.point_a) + '</span></div>' : '') +
        (diag.gap.point_b ? '<div class="gr"><span class="gk">Цель</span><span class="gv">' + esc(diag.gap.point_b) + '</span></div>' : '') +
        (diag.gap.bridge ? '<div class="gr"><span class="gk">Мост</span><span class="gv">' + esc(diag.gap.bridge) + '</span></div>' : '') +
      '</div></div>';
    }

    var saleInner = '';
    if (plan.offer && plan.offer.title) {
      saleInner += '<div class="rec"><span class="ri">' + ic('spark', 12) + '</span><div>' +
        '<b>' + esc(plan.offer.title) + '</b>' +
        (plan.offer.outcome ? '<div class="sub">' + esc(plan.offer.outcome) + '</div>' : '') + '</div></div>';
    }
    if (plan.track && (plan.track.title || plan.track.why)) {
      saleInner += '<div class="mech" style="margin-top:' + (saleInner ? '14px' : '0') + '">Трек: <b>' + esc(plan.track.title || plan.track.kind) + '</b>' +
        (plan.track.why ? ' — ' + esc(plan.track.why) : '') + '</div>';
    }
    var prods = [];
    (plan.stages || []).forEach(function (st) { if (st && st.product && st.product.name) prods.push(st.product); });
    if (prods.length) {
      saleInner += '<div style="margin-top:12px">' + prods.map(function (p) {
        return '<div class="prod-r"><b>' + esc(p.name) + '</b><span>' + esc(p.because || '') + '</span></div>';
      }).join('') + '</div>';
    }
    html += aiSec('Что предложить — подбор AI', saleInner);

    var mInner = '';
    if (Array.isArray(diag.metrics) && diag.metrics.length) {
      mInner += '<div class="diag-metrics">' + diag.metrics.map(function (m) {
        var cls = m.tone === 'ok' ? 'good' : m.tone === 'bad' ? 'bad' : 'mid';
        return '<div class="dmetric ' + cls + '"><span class="dm-v">' + esc(m.value) + '</span>' +
          '<span class="dm-k">' + esc(m.label) + '</span>' +
          (m.note ? '<span class="dm-n">' + esc(m.note) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }
    if (Array.isArray(diag.categories) && diag.categories.length) {
      mInner += '<div class="diag-cats"' + (mInner ? ' style="margin-top:16px"' : '') + '>' + diag.categories.map(function (ct) {
        var t = scoreTone(ct.pct);
        return '<div class="catr"><span class="k">' + esc(ct.title) + '</span>' +
          '<div class="strack"><i style="width:' + (ct.pct || 0) + '%; background:' + t.c + '"></i></div>' +
          '<span class="p num" style="color:' + t.c + '">' + esc(ct.pct) + '%</span></div>';
      }).join('') + '</div>';
    }
    html += aiSec('Шансы на поступление', mInner);

    if (Array.isArray(diag.universities) && diag.universities.length) {
      html += aiSec('Вузы под профиль', diag.universities.map(function (u) {
        return '<div class="uni-r"><div><div class="uni-nm">' + esc(u.name_ru) + '</div>' +
          '<div class="uni-sub">' + esc(u.name_zh || '') + (u.city ? ' · ' + esc(u.city) : '') + (u.rank ? ' · ' + esc(u.rank) : '') + '</div></div>' +
          '<span class="uni-tag">' + esc(UNI_TYPE[u.type] || u.type || '') + '</span>' +
          '<div class="uni-right"><div class="uni-ch num">' + esc(u.chance_pct) + '%</div>' +
          (u.grant ? '<div class="uni-gr">' + esc(u.grant) + '</div>' : '') + '</div></div>';
      }).join(''));
    }

    function sgList(arr, isGrow) {
      if (!Array.isArray(arr) || !arr.length) return '';
      return '<ul>' + arr.map(function (it) {
        if (typeof it === 'string') return '<li><b>' + esc(it) + '</b></li>';
        var critHtml = '';
        if (isGrow && it.crit) {
          var critRu = { block: 'критично', imp: 'важно', nice: 'желательно' }[it.crit] || it.crit;
          critHtml = '<span class="crit ' + esc(it.crit) + '">' + esc(critRu) + '</span>';
        }
        return '<li><b>' + esc(it.title) + critHtml + '</b>' + (it.desc ? '<span>' + esc(it.desc) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    var sb = sgList(diag.strengths, false), gr = sgList(diag.growth, true);
    if (sb || gr) {
      html += aiSec('Сильное и зоны роста',
        '<div class="sg2">' +
        (sb ? '<div class="sg"><div class="sg-h ok">Сильные стороны</div>' + sb + '</div>' : '') +
        (gr ? '<div class="sg"><div class="sg-h grow">Зоны роста</div>' + gr + '</div>' : '') +
        '</div>');
    }

    if (Array.isArray(plan.stages) && plan.stages.length) {
      html += aiSec('План, который увидел человек', plan.stages.map(function (st, i) {
        var acts = (st.acts || st.actions || st.steps || []);
        return '<div class="stage"><div class="stage-n num">' + (i + 1) + '</div><div>' +
          '<div class="stage-t">' + esc(st.title) + (st.when ? '<span>' + esc(st.when) + (st.sub ? ' · ' + esc(st.sub) : '') + '</span>' : '') + '</div>' +
          (acts.length ? '<ul>' + acts.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
        '</div></div>';
      }).join(''));
    }

    var qaPairs = [], shown = {};
    SNAPSHOT.forEach(function (pp) {
      var val = fmtVal(answers[pp[0]]); if (val == null || val === '') return;
      shown[pp[0]] = 1; qaPairs.push([pp[1], val]);
    });
    (d.questions || []).forEach(function (pair) {
      var key = pair[0], label = pair[1]; if (shown[key]) return;
      var val = fmtVal(answers[key]); if (val == null || val === '') return;
      shown[key] = 1; qaPairs.push([label, val]);
    });
    Object.keys(answers).forEach(function (key) {
      if (shown[key] || key === 'name') return;
      var val = fmtVal(answers[key]); if (val == null || val === '') return;
      qaPairs.push([key.replace(/_/g, ' '), val]);
    });
    if (qaPairs.length) {
      html += aiSec('Анкета — ответы человека', '<div>' + qaPairs.map(function (pr) {
        return '<div class="qa-r"><span class="k">' + esc(pr[0]) + '</span><span class="v">' + esc(pr[1]) + '</span></div>';
      }).join('') + '</div>', 'показать');
    }
    return html;
  }
  function buildTimeline(d) {
    var items = [];
    if (d.created_at) items.push({ at: d.created_at, text: 'зашел на платформу', cls: '' });
    var maxStep = 0;
    (d.events || []).forEach(function (e) {
      if (e.type === 'anketa_step') {
        var s = (e.payload || {}).step || 0;
        if (s > maxStep) { maxStep = s; items.push({ at: e.at, text: 'анкета: дошел до шага ' + s + ' из 7', cls: '', step: true }); }
        return;
      }
      items.push({ at: e.at, text: evText(e),
        cls: (e.type === 'lead_submitted' || e.type === 'questionnaire_submitted' ||
          e.type === 'viewed_result' || e.type === 'magnet_registered') ? 'hi' : '' });
    });
    var stepItems = items.filter(function (i) { return i.step; });
    if (stepItems.length > 1) {
      var keep = stepItems[stepItems.length - 1];
      items = items.filter(function (i) { return !i.step || i === keep; });
    }
    ((d.crm || {}).comms || []).forEach(function (cm) {
      items.push({ at: cm.at, text: (COMM_KINDS[cm.kind] || cm.kind) + (cm.text ? ': ' + cm.text : ''), cls: 'comm' });
    });
    items.sort(function (a, b) { return new Date(a.at || 0) - new Date(b.at || 0); });
    if (!items.length) return '';
    return '<div class="tl">' + items.map(function (i) {
      return '<div class="tl-row ' + i.cls + '"><span class="tl-dot"></span>' +
        '<span class="tl-text">' + esc(i.text) + '</span>' +
        '<span class="tl-when num">' + fmtWhen(i.at) + '</span></div>';
    }).join('') + '</div>';
  }

  /* ── toast ────────────────────────────────────────────── */
  var toastTimer = null;
  function showToast(text, sub, leadId) {
    var t = el('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.innerHTML = esc(text) + (sub ? ' <span>' + esc(sub) + '</span>' : '');
    t.onclick = function () {
      t.classList.remove('show');
      if (leadId) openDrawer(leadId, [leadId]);
    };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 7000);
  }

  /* ── CSV ──────────────────────────────────────────────── */
  function exportCsv() {
    var arr = state.page === 'leads' ? segLeads(state.seg) : state.leads;
    var head = ['Имя', 'Балл', 'Статус', 'Этап', 'Контакт', 'Слот', 'Класс', 'Год', 'Направления', 'Заметка', 'Пришел'];
    var rows = arr.map(function (l) {
      return [
        l.name || '', l.score != null ? l.score : '', CRM[l.crm.status].label, FUNNEL[l.status],
        (l.booking || {}).contact || '', (l.booking || {}).slot || '',
        l.grade || '', l.target_year || '',
        Array.isArray(l.directions) ? l.directions.join(', ') : (l.directions || ''),
        l.crm.note || '', l.created_at ? l.created_at.slice(0, 16).replace('T', ' ') : '',
      ];
    });
    var csv = '﻿' + [head].concat(rows).map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'eastside-leads.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── загрузка ─────────────────────────────────────────── */
  /* подпись набора лидов — чтобы не перерисовывать (и не пере-анимировать) графики, когда ничего не поменялось */
  function leadsSig() {
    return state.leads.map(function (l) {
      return l.id + ':' + l.crm.status + ':' + (l.booking ? 1 : 0) + ':' + (l.score == null ? '' : l.score) + ':' + (l.crm.tasks || []).length;
    }).join('|');
  }
  function loadLeads(silent, cb) {
    var archive = state.page === 'leads' && state.seg === 'archive';
    api('/admin/api/leads' + (archive ? '?include_hidden=1' : '')).then(function (data) {
      var prevIds = {};
      if (silent) state.leads.forEach(function (l) { prevIds[l.id] = 1; });
      var prevSig = leadsSig();
      state.leads = (data.leads || []).map(function (l) {
        l.crm = l.crm || { status: 'new', note: '' };
        l.crm.tasks = l.crm.tasks || [];
        l.crm.comms = l.crm.comms || [];
        return l;
      });
      state.loaded = true;
      state.updatedAt = new Date();
      var unchanged = silent && leadsSig() === prevSig;
      if (silent) {
        var fresh = state.leads.filter(function (l) { return !prevIds[l.id] && l.booking; });
        if (fresh.length === 1) showToast('Новая заявка: ' + (fresh[0].name || 'Без имени'), 'открыть', fresh[0].id);
        else if (fresh.length > 1) showToast('Новых заявок: ' + fresh.length, 'смотри очередь');
        if (fresh.length && notifOn() && Notification.permission === 'granted') {
          fresh.slice(0, 3).forEach(function (f) {
            try {
              var n = new Notification('Новая заявка: ' + (f.name || 'Без имени'), {
                body: ((f.booking || {}).contact || '') + ((f.booking || {}).slot ? ' · разбор: ' + f.booking.slot : ''),
              });
              n.onclick = function () { window.focus(); openDrawer(f.id, [f.id]); n.close(); };
            } catch (e) {}
          });
        }
      }
      /* данные те же — обновляем только счётчики/время в сайдбаре, графики не трогаем (без мигания) */
      if (unchanged) { renderSide(); renderTopbar(); if (cb) cb(); return; }
      renderAll();
      if (cb) cb();
    }).catch(function (e) {
      if (e.message === '403' || silent) return;
      var v = el('view');
      if (v) v.innerHTML = '<div class="card"><div class="empty">Не получилось загрузить (' + esc(e.message) + ').<br>Проверь сеть и обнови страницу.</div></div>';
    });
  }

  /* ── boot ─────────────────────────────────────────────── */
  /* ссылка на карточку: #lead/<id> в адресе — открываем этого клиента */
  function openFromHash() {
    var id = hashLeadId();
    if (!id || id === state.drawerId) return;
    // ссылку на клиента могли вставить, стоя в разделе самозанятых: возвращаем в
    // клиентское пространство, чтобы после закрытия карточки человек остался при делах
    if (curSpace() !== 'crm') setPage(firstAllowedPage('crm'));
    openDrawer(id, [id]);
  }
  /* ссылка на раздел: #page/<id> — открываем сразу нужную страницу. Пространство
     выводится из самой страницы (spaceOf), поэтому ссылка на «Задания» приводит и в
     окружение самозанятых, а не только на вкладку. Нет доступа — молча остаёмся где были:
     ссылку могли переслать тому, у кого нет cap. */
  function openPageFromHash() {
    var p = hashRouteId('page');
    if (!p || p === state.page) return false;
    for (var i = 0; i < NAV_ALL.length; i++) {
      if (NAV_ALL[i].id === p && can(NAV_ALL[i].cap)) { setPage(p); return true; }
    }
    return false;
  }
  /* ссылка на переписку: #dialog/<id> — открываем инбокс сразу на этом диалоге.
     По такой ссылке приходит уведомление бота «клиенту нужен менеджер». */
  function openDialogFromHash() {
    var id = hashDialogId();
    if (!id) return;
    if (state.page === 'inbox' && state.inboxMode === 'bot' && String(state.inboxSel) === String(id)) return;
    if (state.drawerId) closeDrawer();
    state.page = 'inbox'; state.inboxMode = 'bot'; state.inboxSel = id;
    saveUi(); renderSide(); renderTopbar(); renderView();
  }
  window.addEventListener('hashchange', function () {
    if (!state.loaded) return;
    var id = hashLeadId();
    if (id) openFromHash();
    else if (hashDialogId()) openDialogFromHash();
    else if (openPageFromHash()) return;
    else if (state.drawerId) closeDrawer();
  });
  function startApp() {
    state.seenBefore = parseInt(localStorage.getItem(SEEN_LS) || '0', 10);
    localStorage.setItem(SEEN_LS, String(Date.now()));
    // manager не видит страницу «Путь» — если сохранилась, сбрасываем на Обзор
    if (!can(pageCap(state.page))) state.page = firstAllowedPage();
    // пришли по ссылке вида #page/<id> — открываем этот раздел, а не последний сохранённый
    var hp = hashRouteId('page');
    for (var i = 0; hp && i < NAV_ALL.length; i++) {
      if (NAV_ALL[i].id === hp && can(NAV_ALL[i].cap)) { state.page = hp; break; }
    }
    renderShell();
    /* Список людей и переписку тянем только тем, у кого есть на них права: у
       преподавателя их нет, а неудачный запрос CRM трактует как «сессия истекла»
       и выкидывает на вход. */
    if (can('clients')) loadLeads(false, openFromHash);
    else { state.loaded = true; renderView(); }
    openDialogFromHash();   // а по #dialog/<id> — сразу нужную переписку, список лидов не нужен
    // диалоги бота — подтянуть для бейджа «просят менеджера» в меню (не блокирует)
    if (can('inbox')) refreshBot(function () { renderSide(); });
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () {
      if (!getKey() || !can('clients')) return;
      var a = document.activeElement;
      if (a && (a.id === 'dr-note' || a.id === 'search' || a.id === 'dr-task-in' || a.id === 'tg-input')) return;
      // поллим диалоги бота всегда (для живого бейджа хэндоффа). Инбокс НЕ пересобираем:
      // у него свой шестисекундный поллинг (pollInboxLive), а полная пересборка раз в минуту
      // вырывала поле ввода из-под рук менеджера прямо на середине сообщения.
      if (can('inbox')) refreshBot(function () { renderSide(); });
      if (state.drawerId || state.botConvoId) return; // не дёргаем интерфейс под открытой карточкой/диалогом
      loadLeads(true);
    }, 60000);
    // РЕАЛТАЙМ инбокса: каждые 6с освежаем список + сообщения открытого чата (без скелетона/мельканий)
    if (state.inboxTimer) clearInterval(state.inboxTimer);
    state.inboxTimer = setInterval(function () {
      if (!getKey() || state.page !== 'inbox') return;
      pollInboxLive();
    }, 6000);
  }
  /* выход / смена аккаунта — сразу на логин (без ожидания фонового 403) */
  function logout() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (state.inboxTimer) { clearInterval(state.inboxTimer); state.inboxTimer = null; }
    closeSmenu();
    state.drawerId = null; state.botConvoId = null;
    localStorage.removeItem(KEY_LS);
    renderLogin();
  }
  function boot() {
    if (!getKey()) { renderLogin(); return; }
    // Резолвим роль по ключу/токену (?k= из телеграм-ссылки тоже сюда попадет)
    fetch(API + '/admin/api/me?k=' + encodeURIComponent(getKey())).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }).then(function (me) {
      state.role = me.role || 'manager'; state.userName = me.name || '';
      state.caps = me.caps || [];
      startApp();
    }).catch(function () {
      localStorage.removeItem(KEY_LS);
      renderLogin('Войди логином и паролем');
    });
  }
  boot();
})();
