/* ИстСайд CRM — логика. Vanilla JS, без сборки.
   3 страницы: Обзор (что происходит) · Лиды (работа: сегменты+таблица/канбан) ·
   Путь (drop-off по шагам платформы). Карточка лида — drawer справа. */
(function () {
  'use strict';

  var API = window.EASTSIDE_API_BASE || 'https://eastside-backend-production.up.railway.app';
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
    bot: { loaded: false, source: 'demo', list: null, msgs: {} }, botConvoId: null, botStats: null,
    drawerId: null, drawerList: [], modalSection: 'now',
    details: {}, inflight: {}, seenBefore: 0, updatedAt: null, timer: null,
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
  };
  var FUNNEL = {
    booked: 'оставил заявку', diagnosed: 'прошел диагностику',
    submitted: 'заполнил анкету', visited: 'без анкеты',
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
  };
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
      hand: '<path d="M7 9V4.5a1.3 1.3 0 0 1 2.6 0V9M9.6 9V3.7a1.3 1.3 0 0 1 2.6 0V9M12.2 9V5.2a1.3 1.3 0 0 1 2.6 0V12a5 5 0 0 1-5 5h-1a4 4 0 0 1-3-1.4L4 13s-.8-1 .2-1.8 2 .3 2 .3L7 13"/>',
      funnel: '<path d="M3.5 5h13l-5 6v4.5l-3 1.5V11L3.5 5z"/>',
      dialogs: '<path d="M2.5 6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H6l-3.5 2.5V6z"/><path d="M9 11v.5a2 2 0 0 0 2 2h3.5l3 2.2V10a2 2 0 0 0-2-2h-1"/>',
      cap: '<path d="M10 4 18 7.5 10 11 2 7.5 10 4z"/><path d="M5.5 9v4c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V9"/>',
      box: '<path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5z"/><path d="M3.5 6.5 10 10l6.5-3.5M10 10v7"/>',
      award: '<circle cx="10" cy="8" r="4.5"/><path d="M7.5 11.8 6.5 17l3.5-2 3.5 2-1-5.2"/>',
      mega: '<path d="M4 8.5 14 4.5v9L4 11.5z"/><path d="M4 8.5H3a1.5 1.5 0 0 0 0 4.5h1M6.5 12.5l1 3.5"/>',
      handshake: '<path d="M10 6 7.5 4.5 3 7v5l2 1.5M10 6l2.5-1.5L17 7v5l-2 1.5"/><path d="M10 6 7.5 8.5a1.3 1.3 0 0 0 1.8 1.8L10.5 9l2 2a1.3 1.3 0 0 0 1.8-1.8L13 8"/>',
      team: '<circle cx="7" cy="7.5" r="2.5"/><path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/><path d="M13 5.5a2.3 2.3 0 0 1 0 4.4M14.5 15.5c0-1.6-.6-2.9-1.6-3.6"/>',
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
    if (m) { localStorage.setItem(KEY_LS, decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); }
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
      var t = btn.textContent;
      btn.textContent = 'Скопировано';
      setTimeout(function () { btn.textContent = t; }, 1400);
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
  function isNewLead(l) {
    return state.seenBefore && l.created_at && new Date(l.created_at).getTime() > state.seenBefore;
  }
  function leadName(l) { return l.name || 'Без имени'; }
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
      if (r.status === 403) { localStorage.removeItem(KEY_LS); renderLogin('Сессия истекла — войди заново'); throw new Error('403'); }
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
  function apiSend(path, method, body, cb) {
    api(path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { if (cb) cb(r); }).catch(function (e) {
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
  function inQueue(l) { return !!l.booking && ACTIVE_STATUSES.indexOf(l.crm.status) !== -1; }
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
    var c = { queue: 0, all: state.leads.length, clients: 0, rejected: 0, hot: 0, week: 0, today: 0,
              anketa: 0, booked: 0 };
    var weekAgo = Date.now() - 7 * 86400000;
    state.leads.forEach(function (l) {
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
          '<input id="lg-login" type="text" placeholder="Логин" autocomplete="username">' +
          '<div class="lg-passwrap">' +
            '<input id="lg-pass" type="password" placeholder="Пароль" autocomplete="current-password">' +
            '<button class="lg-eye" id="lg-eye" type="button" tabindex="-1">показать</button>' +
          '</div>' +
          '<button class="bp" id="lg-go">Войти</button>' +
          '<div class="gate-err" id="lg-err">' + esc(err || '') + '</div>' +
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
          '<div class="side-sub" id="welc-sub"></div>' +
          '<nav id="side-nav"></nav>' +
          '<button class="navi mt" id="logout">' + ic('exit') + 'Выйти</button>' +
          '<div class="promo" id="promo" style="margin-top:auto"></div>' +
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
          if (a === 'refresh') { loadLeads(false); showToast('Данные обновлены'); }
          else logout();
        });
      });
    });
    el('mbg').addEventListener('click', closeDrawer);
    document.addEventListener('click', function (e) {
      if (smenu && !smenu.contains(e.target)) closeSmenu();
    });
    document.addEventListener('keydown', function (e) {
      var a = document.activeElement;
      var typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
      if (e.key === 'Escape') {
        if (typing && a.id === 'search') { a.value = ''; state.q = ''; a.blur(); renderView(); return; }
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
  }

  function renderAll() { renderSide(); renderTopbar(); renderHead(); renderView(); }

  /* ── РОЛИ И ДОСТУП ──────────────────────────────────────────────────────────
     Возможности (caps) = что роль видит/делает. Роль = набор caps. Чтобы добавить
     новый блок: (1) заведи cap в CAP_ALL, (2) добавь его нужным ролям ниже,
     (3) добавь nav-айтем с этим cap. Кто видит — определяется только caps. */
  var CAP_ALL = ['dash', 'inbox', 'clients', 'path', 'finance', 'analytics', 'products', 'students', 'grants', 'marketing', 'partners', 'team'];
  var ROLES = {
    super_admin:   { label: 'Super Admin',           short: 'полный доступ',        caps: CAP_ALL.slice() },
    head:          { label: 'Руководитель',          short: 'вся компания',         caps: ['dash', 'inbox', 'clients', 'path', 'finance', 'analytics', 'products', 'students', 'grants', 'marketing', 'partners', 'team'] },
    product_lead:  { label: 'Руководитель продукта', short: 'продукт и аналитика',  caps: ['dash', 'clients', 'path', 'analytics', 'products', 'students'] },
    sales_lead:    { label: 'Руководитель продаж',   short: 'продажи и деньги',     caps: ['dash', 'inbox', 'clients', 'path', 'finance'] },
    sales_manager: { label: 'Менеджер продаж',       short: 'заявки и диалоги',     caps: ['dash', 'inbox', 'clients'] },
    admin:         { label: 'Администратор',          short: 'операционка',          caps: ['dash', 'inbox', 'clients', 'students', 'grants', 'products'] },
    senior_tutor:  { label: 'Старший тьютор',        short: 'обучение',             caps: ['dash', 'clients', 'students'] },
    tutor:         { label: 'Тьютор',                 short: 'обучение',             caps: ['dash', 'students'] },
    teacher:       { label: 'Преподаватель',          short: 'обучение',             caps: ['dash', 'students'] },
    marketer:      { label: 'Маркетолог',             short: 'трафик и аналитика',   caps: ['dash', 'path', 'analytics', 'marketing'] },
    partner:       { label: 'Партнёр',                short: 'свои лиды',            caps: ['dash', 'partners'] },
    contractor:    { label: 'Подрядчик',              short: 'задачи',               caps: ['dash'] },
    diagnostician: { label: 'Диагност',               short: 'диагностика',          caps: ['dash', 'clients', 'analytics'] },
    curator:       { label: 'Куратор',                short: 'ведёт клиентов',       caps: ['dash', 'inbox', 'clients', 'students'] },
    grant_admin:   { label: 'Администратор гранта',   short: 'гранты',               caps: ['dash', 'grants', 'clients'] },
    // legacy-роли (старые аккаунты + admin_key) — маппятся на доступ
    owner:         { label: 'Владелец',               short: 'полный доступ',        caps: CAP_ALL.slice() },
    manager:       { label: 'Менеджер',               short: 'заявки и диалоги',     caps: ['dash', 'inbox', 'clients'] },
  };
  function roleInfo() { return ROLES[state.role] || ROLES.manager; }
  function can(cap) { return roleInfo().caps.indexOf(cap) !== -1; }

  /* сайдбар: нав + промо. Каждый пункт привязан к cap. */
  var NAV_ALL = [
    { id: 'dash', label: 'Дашборд', icon: 'dash', cap: 'dash' },
    { id: 'inbox', label: 'Диалоги', icon: 'dialogs', cap: 'inbox' },
    { id: 'leads', label: 'Люди', icon: 'leads', cap: 'clients' },
    { id: 'students', label: 'Обучение', icon: 'cap', cap: 'students' },
    { id: 'path', label: 'Путь', icon: 'path', cap: 'path' },
    { id: 'finance', label: 'Финансы', icon: 'coins', cap: 'finance' },
    { id: 'products', label: 'Продукты', icon: 'box', cap: 'products' },
    { id: 'grants', label: 'Гранты', icon: 'award', cap: 'grants' },
    { id: 'marketing', label: 'Маркетинг', icon: 'mega', cap: 'marketing' },
    { id: 'partners', label: 'Партнёры', icon: 'handshake', cap: 'partners' },
    { id: 'analytics', label: 'Аналитика бота', icon: 'chart', cap: 'analytics' },
    { id: 'team', label: 'Команда', icon: 'team', cap: 'team' },
  ];
  function navItems() { return NAV_ALL.filter(function (it) { return can(it.cap); }); }
  function pageCap(page) { for (var i = 0; i < NAV_ALL.length; i++) if (NAV_ALL[i].id === page) return NAV_ALL[i].cap; return 'dash'; }
  function firstAllowedPage() { var n = navItems(); return n.length ? n[0].id : 'dash'; }
  function renderSide() {
    var c = counts();
    var NAV = navItems();
    var nav = el('side-nav');
    if (nav) {
      var ho = botHandoffCount();
      nav.innerHTML = NAV.map(function (it) {
        var extra = '';
        if (it.id === 'leads' && c.hot) extra = '<span class="bdg num">' + c.hot + '</span>';
        else if (it.id === 'leads') extra = '<span class="cnt num">' + c.all + '</span>';
        else if (it.id === 'inbox' && ho) extra = '<span class="bdg num" title="просят менеджера">' + ho + '</span>';
        return '<button class="navi' + (state.page === it.id ? ' on' : '') + '" data-p="' + it.id + '">' +
          ic(it.icon) + it.label + extra + '</button>';
      }).join('');
      Array.prototype.forEach.call(nav.children, function (b) {
        b.addEventListener('click', function () { setPage(b.getAttribute('data-p')); });
      });
    }
    var ws = el('welc-sub');
    if (ws) ws.textContent = c.all + ' ' + plural(c.all, 'лид', 'лида', 'лидов') + ' · обновлено ' + (state.updatedAt ? pad(state.updatedAt.getHours()) + ':' + pad(state.updatedAt.getMinutes()) : '—');
    var promo = el('promo');
    if (promo) {
      if (!can('path')) { promo.style.display = 'none'; }
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
      var hoM = botHandoffCount();
      mt.innerHTML = NAV.map(function (it) {
        var bd = (it.id === 'leads' && c.hot) ? c.hot : (it.id === 'inbox' && hoM) ? hoM : 0;
        return '<button class="mtab' + (state.page === it.id ? ' on' : '') + '" data-p="' + it.id + '">' +
          ic(it.icon) + '<span>' + it.label + '</span>' +
          (bd ? '<span class="bdg num">' + bd + '</span>' : '') + '</button>';
      }).join('');
      Array.prototype.forEach.call(mt.children, function (b) {
        b.addEventListener('click', function () { setPage(b.getAttribute('data-p')); });
      });
    }
    document.title = (c.hot ? '(' + c.hot + ') ' : '') + 'ИстСайд · CRM';
  }

  function setPage(p) {
    if (state.page === p) return;
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
    if (state.page === 'leads') {
      tb.innerHTML = '<nav class="tabs">' + Object.keys(SEGS).map(function (s) {
        var n = s === 'queue' ? c.queue : s === 'all' ? c.all : s === 'clients' ? c.clients : c.rejected;
        return '<a class="tab' + (state.seg === s ? ' on' : '') + '" data-seg="' + s + '">' +
          SEGS[s].label + (n ? '<span class="n num">' + n + '</span>' : '') + '</a>';
      }).join('') + '</nav>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () {
          state.seg = t.getAttribute('data-seg');
          state.sort = null;
          saveUi(); renderTopbar(); renderHead(); renderView();
        });
      });
    } else if (state.page === 'path') {
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
    } else if (state.page === 'inbox') {
      var bsrc = state.bot.source === 'api' ? 'диалоги из бота · live' : 'омниканальный инбокс';
      tb.innerHTML = '<div class="freshchip"><span class="fok">' + ic('chat', 11) + '</span>' + bsrc + '</div>';
    } else if (state.page === 'analytics') {
      tb.innerHTML = '<div class="freshchip"><span class="fok">' + ic('bolt', 11) + '</span>аналитика бота</div>';
    } else if (state.page === 'dash') {
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
    if (state.page === 'dash') {
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
    if (state.page === 'path') {
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
    ch.innerHTML = html;
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  /* ── view ─────────────────────────────────────────────── */
  var STUB_PAGES = { students: 1, products: 1, grants: 1, marketing: 1, partners: 1 };
  function renderView() {
    var view = el('view');
    if (!view) return;
    // гард доступа: нет cap у текущей страницы → на первую доступную роли
    if (!can(pageCap(state.page))) state.page = firstAllowedPage();
    document.body.classList.toggle('inbox-mode', state.page === 'inbox');
    if (!state.loaded) {
      if (state.page === 'dash') view.innerHTML = dashSkeleton();
      else if (state.page === 'leads') return renderLeads(view); // тулбар + скелетон строк
      else view.innerHTML = '<div class="loadwrap"><div class="loaddot"></div><div class="loaddot"></div><div class="loaddot"></div></div>';
      return;
    }
    if (state.page === 'inbox') return renderInbox(view);  // фикс-высота, без анимации страницы
    if (state.page === 'dash') renderDash(view);
    else if (state.page === 'path') renderPath(view);
    else if (state.page === 'finance') renderFinance(view);
    else if (state.page === 'analytics') renderBotAnalytics(view);
    else if (state.page === 'team') renderTeam(view);
    else if (STUB_PAGES[state.page]) renderStub(view);
    else renderLeads(view);
    pageAnim(view);
  }
  /* ── заглушки будущих разделов (роль их видит, но фич ещё нет) ── */
  var STUB_TEXT = {
    students:  'Ученики, расписание, прогресс по языку и экзаменам, материалы и домашки. Появится, когда подключим обучение.',
    products:  'Каталог услуг — что продаём, цены, привязка к оплатам клиентов и финансам.',
    grants:    'Гранты CSC и провинциальные: заявки, статусы, дедлайны, пакет документов по каждому ученику.',
    marketing: 'Источники трафика, кампании, стоимость лида и ROI по каналам.',
    partners:  'Кабинет партнёров: их приведённые лиды, статистика и выплаты.',
  };
  function navMeta(id) { for (var i = 0; i < NAV_ALL.length; i++) if (NAV_ALL[i].id === id) return NAV_ALL[i]; return null; }
  function renderStub(view) {
    var m = navMeta(state.page) || { label: 'Раздел', icon: 'box' };
    view.innerHTML = '<div class="stub">' +
      '<div class="stub-ic">' + ic(m.icon, 30) + '</div>' +
      '<div class="stub-t">' + esc(m.label) + '</div>' +
      '<div class="stub-s">' + esc(STUB_TEXT[state.page] || 'Раздел в разработке.') + '</div>' +
      '<div class="stub-tag">' + ic('spark', 12) + 'В разработке</div></div>';
  }
  /* ── Команда и роли (Super Admin) ── */
  function renderTeam(view) {
    if (!state._team) {
      view.innerHTML = dashSkeleton();
      api('/admin/api/team').then(function (r) { state._team = (r && r.users) || []; if (state.page === 'team') renderView(); })
        .catch(function () { state._team = 'none'; if (state.page === 'team') renderView(); });
      return;
    }
    if (state._team === 'none') { view.innerHTML = '<div class="card"><div class="empty">Не удалось загрузить команду. Нужен доступ Super Admin.</div></div>'; return; }
    var assignable = Object.keys(ROLES).filter(function (k) { return k !== 'owner' && k !== 'manager'; });
    var rows = state._team.map(function (u) {
      var opts = assignable.map(function (k) { return '<option value="' + k + '"' + (u.role === k ? ' selected' : '') + '>' + ROLES[k].label + '</option>'; }).join('');
      var legacy = (u.role === 'owner' || u.role === 'manager') ? '<option value="' + u.role + '" selected>' + (ROLES[u.role] ? ROLES[u.role].label : u.role) + ' (legacy)</option>' : '';
      return '<div class="tm-row"><span class="tm-av">' + esc(initials(u.name || u.login)) + '</span>' +
        '<div class="tm-i"><div class="tm-n">' + esc(u.name || u.login) + '</div><div class="tm-l">@' + esc(u.login) + '</div></div>' +
        '<select class="tm-sel" data-uid="' + u.id + '">' + legacy + opts + '</select></div>';
    }).join('');
    view.innerHTML = '<div class="card" style="padding:24px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('team', 14) + '</span><div><div class="t">Команда и роли</div>' +
      '<div class="s">кто в системе и что видит — роль определяет доступ к разделам</div></div>' +
      '<span class="cnt num">' + state._team.length + '</span></div>' +
      '<div class="tm-list">' + (rows || '<div class="empty">Пока только базовые аккаунты.</div>') + '</div></div>';
    Array.prototype.forEach.call(view.querySelectorAll('.tm-sel'), function (sel) {
      sel.addEventListener('change', function () {
        var u = (state._team || []).filter(function (x) { return String(x.id) === sel.getAttribute('data-uid'); })[0];
        if (u) u.role = sel.value;
        apiSend('/admin/api/users/' + sel.getAttribute('data-uid'), 'PATCH', { role: sel.value }, function () { showToast('Роль обновлена'); });
      });
    });
  }
  /* мягкое появление контента ТОЛЬКО при смене страницы (не на фильтрах/сегментах
     внутри той же страницы — иначе мелькает). CSS гасит при reduced-motion. */
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

  function fillTable(host) {
    var arr = segLeads(state.seg);
    if (!arr.length) {
      host.innerHTML = emptyState();
      var lc = el('le-clear');
      if (lc) lc.addEventListener('click', function () { state.q = ''; state.quick = ''; renderView(); });
      return;
    }
    var rows = arr.map(function (l) {
      var tone = l.score != null ? scoreTone(l.score) : null;
      var contact = (l.booking || {}).contact;
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

    host.innerHTML = '<div class="trow lr-grid thead">' +
        thCell('crm', 'Статус', '') +
        thCell('name', 'Лид', '') +
        thCell('score', 'Балл', ' hidem') +
        '<span class="th hidem">Контакт</span>' +
        thCell('created', 'Пришел', ' r') +
        '<span class="th hidem"></span>' +
      '</div>' + rows;

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
    site:     { label: 'Сайт',      icon: 'ext',  c: '#2F6BFF' },
    platform: { label: 'Платформа', icon: 'bolt', c: '#1C2B4A' },
  };
  var CHAN_ORDER = ['telegram', 'whatsapp', 'vk', 'site', 'platform'];
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
      // НЕ затираем свежий тумблер бэкенд-данными первые 5с (иначе реалтайм-полл откатит
      // оптимистичное включение/выключение, пока POST ещё не дошёл — выглядит как «не работает»)
      var now = Date.now();
      (fresh || []).forEach(function (c) {
        var t = (state._aiToggleAt || {})[c.user_id];
        if (t && now - t < 5000) { c.ai_enabled = (state._aiToggleVal || {})[c.user_id]; c.taken_by = c.ai_enabled ? null : c.taken_by; }
      });
      // сообщения открытого чата — тянем только если чат выбран и уже загружен (без скелетона)
      var sel = state.inboxSel;
      if (sel && state.bot.msgs[sel]) {
        api('/admin/api/bot/conversations/' + sel + '/messages').then(function (d) {
          var old = state.bot.msgs[sel];
          var oldN = (old && old.messages) ? old.messages.length : -1;
          var newN = (d && d.messages) ? d.messages.length : 0;
          // сохраняем актуальные флаги (могли поменяться тумблером) + новые сообщения
          state.bot.msgs[sel] = d;
          if (newN !== oldN) { refreshOpenThread(true); }       // появились новые — дорисуем, докрутим вниз
          else if (changed) { refreshOpenThread(false); }
        }).catch(function () {});
      } else if (changed) {
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
        return { who: who, text: m.text, at: m.at, id: m.id };
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
      return sep + '<div class="tg-msg ' + side + (m.who === 'manager' ? ' mgr' : m.who === 'bot' ? ' ai' : '') + '">' +
        '<div class="tg-bub">' + mdMsg(m.text) + '<span class="tg-mt num">' + fmtTime(m.at) + '</span>' +
          (m.id ? '<button class="tg-del" data-del="' + m.id + '" title="Удалить сообщение">' + ic('x', 11) + '</button>' : '') +
        '</div>' +
        (by ? '<span class="tg-by">' + (m.who === 'bot' ? ic('bot', 9) : ic('hand', 9)) + by + '</span>' : '') + '</div>';
    }).join('');
  }
  /* единый бейдж статуса диалога (список + точечное обновление при тумблере) */
  function inboxTag(c) {
    return c.handoff ? '<span class="tg-tag wait">' + ic('hand', 10) + 'просит менеджера</span>'
      : (c.ai_on === false) ? '<span class="tg-tag mgr">' + ic('hand', 10) + (c.taken_by ? esc(c.taken_by) : 'ведёт менеджер') + '</span>'
      : '<span class="tg-tag ai">' + ic('bot', 10) + 'AI</span>';
  }
  function inboxSetAi(c, on) {
    if (c.api) {
      apiSend('/admin/api/bot/conversations/' + c.id + '/ai', 'POST', { enabled: on }, function () {});
      state._aiToggleAt = state._aiToggleAt || {}; state._aiToggleVal = state._aiToggleVal || {};
      state._aiToggleAt[c.id] = Date.now(); state._aiToggleVal[c.id] = on;
      // вкл → бот снова сам отвечает, снимаем «ведёт менеджер»; выкл → диалог за менеджером
      function apply(o) { if (!o) return; o.ai_enabled = on; o.handoff_requested = on ? false : o.handoff_requested; o.taken_by = on ? null : state.userName; }
      apply(state.bot.msgs[c.id]);
      apply((state.bot.list || []).filter(function (x) { return String(x.user_id) === String(c.id); })[0]);
      c.ai_on = on; c.handoff = on ? false : c.handoff; c.taken_by = on ? null : state.userName;
      // точечно: перерисовываем только чат + бейдж строки, без пересборки списка (без дёрганья)
      if (state.page === 'inbox') {
        renderInboxChat([c]);
        var r3 = document.querySelector('.tg-row[data-id="' + c.id + '"] .tg-r3');
        if (r3) r3.innerHTML = inboxTag(c);
      }
      renderSide();
    } else {
      state.dialogAi[c.id] = on; var dl = getDialog(c.lead); if (on) dl.handoff_req = false; else dl.handed = false;
      renderView(); renderSide();
    }
    showToast(on ? 'Бот снова отвечает сам' : 'Бот выключен — диалог ведёшь ты');
  }
  function inboxMarkSeen(c) {
    if (c.api) apiSend('/admin/api/bot/conversations/' + c.id + '/seen', 'POST', null, function () {});
    else state.dialogSeen[c.id] = 1;
  }

  /* отправить сообщение менеджером (демо — локально; реал — POST) */
  function inboxSend(c, text) {
    text = (text || '').trim(); if (!text) return;
    var nowISO = new Date().toISOString();
    if (c.api) {
      var d = state.bot.msgs[c.id];
      var tmp = { role: 'assistant', sender: 'manager', text: text, at: nowISO };
      if (d) d.messages = (d.messages || []).concat([tmp]);
      if (c.ai_on !== false) inboxSetAi(c, false); else renderView();
      // реальная доставка; при ошибке — откатываем пузырь, чтобы не казалось, что ушло
      api('/admin/api/bot/conversations/' + c.id + '/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }),
      }).catch(function () {
        var dd = state.bot.msgs[c.id];
        if (dd && dd.messages) dd.messages = dd.messages.filter(function (m) { return m !== tmp; });
        showToast('Сообщение не отправлено — проверь связь с ботом');
        if (state.page === 'inbox') renderView();
      });
    } else {
      var dlg = getDialog(c.lead);
      dlg.messages.push({ from: 'manager', text: text, at: nowISO });
      dlg.last = dlg.messages[dlg.messages.length - 1]; dlg.msgs = dlg.messages.length;
      if (dlg.ai_on) { state.dialogAi[c.id] = false; }
      renderView();
    }
  }

  function renderInbox(view) {
    if (!state.bot.loaded) {
      // скелетон инбокса: список-плейсхолдеры + пустая панель чата (не три точки)
      var skRows = ''; for (var i = 0; i < 7; i++) skRows += '<div class="tg-skrow"><span class="shim tg-skava"></span><span class="tg-skrb"><span class="shim tg-skl w50"></span><span class="shim tg-skl w30"></span></span></div>';
      view.innerHTML = '<div class="tg show-chat"><aside class="tg-list"><div class="tg-search"><span class="searchwrap"><span class="shim" style="width:100%;height:34px;border-radius:9px;display:block"></span></span></div><div class="tg-rows">' + skRows + '</div></aside><main class="tg-chat"><div class="tg-sk">' +
        '<span class="shim tg-skb in" style="width:48%"></span><span class="shim tg-skb out" style="width:40%"></span><span class="shim tg-skb in" style="width:60%"></span></div></main></div>';
      loadBotData(function () { if (state.page === 'inbox') renderView(); });
      return;
    }
    if (state.bot.source !== 'api') {
      view.innerHTML = '<div class="tg"><div class="tg-blank"><div class="tg-blank-ic">' + ic('chat', 26) + '</div>' +
        '<div style="font-weight:600;color:var(--ink)">Бот ещё не подключён к CRM</div>' +
        '<div style="max-width:360px;text-align:center;line-height:1.5">Как только бэкенд получит доступ к базе бота, сюда поедут реальные переписки из Telegram. Демо-данных больше нет.</div>' +
        '<button class="bp" id="ib-retry">' + ic('refresh', 14) + 'Проверить снова</button></div></div>';
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
        '<aside class="tg-list">' +
          '<div class="tg-search"><span class="searchwrap">' + ic('leads', 15) + '<input id="tg-q" class="search" type="search" placeholder="Поиск диалога" autocomplete="off"></span></div>' +
          '<div class="tg-fchips">' + chips + '</div>' +
          '<div class="tg-rows" id="tg-rows">' + rows + '</div>' +
        '</aside>' +
        '<main class="tg-chat" id="tg-chat"></main>' +
      '</div>';

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
          : '<span>Диалог ведёшь ты — бот молчит. Нажми <b>«Бот вкл»</b>, чтобы вернуть авто-ответы.</span>') +
      '</div>' +
      '<div class="tg-compose">' +
        '<input id="tg-input" placeholder="' + (aiOn ? 'Написать — вы перехватите диалог у бота' : 'Написать сообщение') + '" autocomplete="off">' +
        '<button class="tg-send" id="tg-send" title="Отправить">' + ic('send', 16) + '</button>' +
      '</div>';

    var th = el('tg-thread'); if (th) th.scrollTop = th.scrollHeight;
    var bk = el('tg-back'); if (bk) bk.addEventListener('click', function () { el('tg').classList.remove('show-chat'); });
    var ai = el('tg-ai'); if (ai) ai.addEventListener('click', function () { inboxSetAi(c, !aiOn); });
    var inp = el('tg-input'), snd = el('tg-send');
    function send() { if (!inp) return; var t = inp.value; inp.value = ''; inboxSend(c, t); }
    if (snd) snd.addEventListener('click', send);
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
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
    { id: 'main',   label: 'Главное',    icon: 'target' },
    { id: 'now',    label: 'Сейчас',     icon: 'flame' },
    { id: 'path',   label: 'Путь',       icon: 'path' },
    { id: 'notes',  label: 'Заметки',    icon: 'note' },
    { id: 'docs',   label: 'Документы',  icon: 'doc' },
    { id: 'pay',    label: 'Оплаты',     icon: 'card' },
    { id: 'notify', label: 'Написать',   icon: 'send' },
    { id: 'ai',     label: 'Диагностика', icon: 'spark' },
  ];

  function openDrawer(id, listIds) {
    state.drawerId = id;
    if (listIds && listIds.length) state.drawerList = listIds;
    state.modalSection = 'main';
    renderDrawer(false);
    el('mbg').classList.add('open');
    el('modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    warm(id);
    if (!state.details[id]) fetchDetail(id, function (got) {
      if (state.drawerId === id && got) renderDrawer(true);
    });
  }
  function closeDrawer() {
    state.drawerId = null;
    state.botConvoId = null;
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
      renderDrawer(false);
      warm(next);
      if (!state.details[next]) fetchDetail(next, function (got) {
        if (state.drawerId === next && got) renderDrawer(true);
      });
    }
  }
  function setModalSection(s) {
    state.modalSection = s;
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
    if (!base) { modal.innerHTML = ''; return; }
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
    ].filter(Boolean).join('<span class="dot-sep"></span>');

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
      '</div>' +
      '<div class="m-foot">' +
        '<a class="bpwide" target="_blank" rel="noopener" href="' + API + '/admin/' + esc(id) + '?k=' + encodeURIComponent(getKey()) + '">Полная аналитика клиента' + ic('go', 14) + '</a>' +
      '</div>';

    el('m-close').addEventListener('click', closeDrawer);
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
    else if (s === 'path') host.innerHTML = buildPathSection(ctx);
    else if (s === 'notes') host.innerHTML = buildNotesSection(ctx);
    else if (s === 'docs') host.innerHTML = ctx.d ? buildDocsSection(ctx) : skeletonSection('docs');
    else if (s === 'pay') host.innerHTML = ctx.d ? buildPaySection(ctx) : skeletonSection('pay');
    else if (s === 'notify') host.innerHTML = buildNotifySection(ctx);
    else if (s === 'ai') host.innerHTML = ctx.d ? buildAiSections(ctx.d) : skeletonSection('ai');
    attachContentHandlers(id, ctx);
    animBars(host);
  }
  function skeletonSection(kind) {
    var head = { docs: ['Документы', 'Собираю файлы клиента'],
                 pay: ['Оплаты', 'Считаю платежи'],
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

  /* Путь — единый богатый таймлайн: 7 шагов платформы + под-события из лога */
  function buildPathSection(ctx) {
    var lead = ctx.lead, d = ctx.d, base = ctx.base;
    var L = lead || base;
    var html = '<div class="m-ctitle">Путь по платформе</div>' +
      '<div class="m-csub">Что человек сделал и где остановился — с этим заходи на разговор.</div>';
    html += buildPathTimeline(L, d || null);
    return html;
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
      var label = EVENTS_RU[e.type] || e.type;
      if (e.type === 'opened_product' && e.payload && e.payload.product) label += ': ' + e.payload.product;
      if (e.type === 'clicked_messenger' && e.payload && e.payload.channel) label += ' (' + e.payload.channel + ')';
      var hi = (e.type === 'questionnaire_submitted' || e.type === 'viewed_result' || e.type === 'lead_submitted');
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

    return '<div class="m-ctitle">Оплаты</div>' +
      '<div class="m-csub">Финансовый учет по клиенту. Позже подвяжем ЮKassa — будет автоматически.</div>' +
      board +
      (pays.length ? '<div>' + rows + '</div>' : '<div class="field-empty">Платежей пока нет.</div>') +
      '<div class="m-sec" style="margin-top:14px"><div class="m-sec-h">Добавить платеж</div>' +
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
      '<input type="file" id="pay-rcpt-file" style="display:none">';
  }
  function fmtMoney(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  /* ── обработчики активного раздела ── */
  function attachContentHandlers(id, ctx) {
    var host = el('m-content');
    if (!host) return;
    var crm = ctx.crm;

    // advance-кнопки и copy в «Сейчас»
    Array.prototype.forEach.call(host.querySelectorAll('[data-adv]'), function (b) {
      b.addEventListener('click', function () { patch(id, { status: b.getAttribute('data-adv') }); });
    });
    var cc = el('c-copy'), ndc = el('nd-copy');
    var contact = ((ctx.base.booking || {}).contact) || '';
    if (cc) cc.addEventListener('click', function () { copyText(contact, cc); });
    if (ndc) ndc.addEventListener('click', function () { copyText(contact, ndc); });
    var stHost = el('m-st');
    if (stHost) Array.prototype.forEach.call(stHost.querySelectorAll('[data-s]'), function (b) {
      b.addEventListener('click', function () { var s = b.getAttribute('data-s'); if (s !== crm.status) patch(id, { status: s }); });
    });

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
      var label = EVENTS_RU[e.type] || e.type;
      if (e.type === 'opened_product' && e.payload && e.payload.product) label += ': ' + e.payload.product;
      if (e.type === 'clicked_messenger' && e.payload && e.payload.channel) label += ' (' + e.payload.channel + ')';
      items.push({ at: e.at, text: label,
        cls: (e.type === 'lead_submitted' || e.type === 'questionnaire_submitted' || e.type === 'viewed_result') ? 'hi' : '' });
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
  function loadLeads(silent) {
    api('/admin/api/leads').then(function (data) {
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
      if (unchanged) { renderSide(); renderTopbar(); return; }
      renderAll();
    }).catch(function (e) {
      if (e.message === '403' || silent) return;
      var v = el('view');
      if (v) v.innerHTML = '<div class="card"><div class="empty">Не получилось загрузить (' + esc(e.message) + ').<br>Проверь сеть и обнови страницу.</div></div>';
    });
  }

  /* ── boot ─────────────────────────────────────────────── */
  function startApp() {
    state.seenBefore = parseInt(localStorage.getItem(SEEN_LS) || '0', 10);
    localStorage.setItem(SEEN_LS, String(Date.now()));
    // manager не видит страницу «Путь» — если сохранилась, сбрасываем на Обзор
    if (!can(pageCap(state.page))) state.page = firstAllowedPage();
    renderShell();
    loadLeads(false);
    // диалоги бота — подтянуть для бейджа «просят менеджера» в меню (не блокирует)
    refreshBot(function () { renderSide(); });
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () {
      if (!getKey()) return;
      var a = document.activeElement;
      if (a && (a.id === 'dr-note' || a.id === 'search' || a.id === 'dr-task-in')) return;
      // поллим диалоги бота всегда (для живого бейджа хэндоффа); инбокс обновляем, если открыт
      refreshBot(function () {
        renderSide();
        if (state.page === 'inbox' && !state.botConvoId) renderView();
      });
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
      startApp();
    }).catch(function () {
      localStorage.removeItem(KEY_LS);
      renderLogin('Войди логином и паролем');
    });
  }
  boot();
})();
