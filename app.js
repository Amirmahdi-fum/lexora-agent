/* ============================================================
   LEXORA 5 — Core Engine
   Modules: utils · state · TTS · dictionary · rendering · SRS ·
   bidi chat · agent (streaming + tools) · Gist sync · settings ·
   mobile/keyboard · boot
   ============================================================ */
(() => {
'use strict';

/* ========================= 1. UTILITIES ========================= */
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const STORAGE = 'lexora_state_v1', SETTINGS = 'lexora_settings_v1', SYNC_KEY = 'lexora_sync_v1';
/* Storage that survives sandboxed/private contexts (falls back to in-memory) */
function safeStorage(name) {
  try {
    const s = window[name];
    s.setItem('__lexora_probe', '1');
    s.removeItem('__lexora_probe');
    return s;
  } catch {
    const mem = new Map();
    return { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); } };
  }
}
const LS = safeStorage('localStorage'), SS = safeStorage('sessionStorage');
const now = () => Date.now();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fa = n => Number(n || 0).toLocaleString('en-US');
const faDate = ts => { const d = new Date(Number(ts) || Date.now()); return d.toLocaleDateString('fa-IR'); };
const todayKey = () => new Date().toLocaleDateString('en-CA');
const safeParse = (raw, fallback = null) => { try { return JSON.parse(raw) || fallback; } catch { return fallback; } };
const asList = v => (Array.isArray(v) ? v.filter(Boolean) : []);
const isMobile = () => matchMedia('(max-width:720px)').matches;
const finePointer = () => matchMedia('(pointer:fine)').matches;

function escapeHtml(s = '') {
  return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function toast(text, type = 'ok', ms = 3400) {
  const e = document.createElement('div');
  e.className = 'toast ' + type;
  e.textContent = text;
  $('#toasts').append(e);
  setTimeout(() => e.remove(), ms);
  return e;
}
const timeAgo = ts => {
  if (!ts) return '—';
  const s = Math.max(1, Math.round((now() - ts) / 1000));
  if (s < 60) return 'لحظاتی پیش';
  if (s < 3600) return fa(Math.round(s / 60)) + ' دقیقه پیش';
  if (s < 86400) return fa(Math.round(s / 3600)) + ' ساعت پیش';
  return faDate(ts);
};

/* ========================= 2. STATE & SETTINGS ========================= */
const demo = [
  { word: 'serendipity', meaning: 'کشف خوشایند و اتفاقی', phonetic: '/ˌser.ənˈdɪp.ə.ti/', example: 'Finding that little bookstore was pure serendipity.', tags: ['advanced'], level: 'C1' },
  { word: 'resilient', meaning: 'تاب‌آور، انعطاف‌پذیر', phonetic: '/rɪˈzɪl.i.ənt/', example: 'She remained resilient despite the setbacks.', tags: ['work'], level: 'B2' },
  { word: 'wander', meaning: 'پرسه زدن، بی‌هدف گشتن', phonetic: '/ˈwɒn.dər/', example: 'We wandered through the old streets at sunset.', tags: ['travel'], level: 'B1' },
  { word: 'subtle', meaning: 'ظریف، نامحسوس', phonetic: '/ˈsʌt.əl/', example: 'There was a subtle change in his tone.', tags: ['daily'], level: 'B2' },
  { word: 'thrive', meaning: 'رشد و شکوفایی کردن', phonetic: '/θraɪv/', example: 'Some plants thrive in low light.', tags: ['daily'], level: 'B1' }
].map((x, i) => ({ ...x, id: uid(), createdAt: now() - i * 86400000, updatedAt: now() - i * 86400000, due: now() - (i % 3) * 86400000, interval: 0, ease: 2.5, reps: 0, lapses: 0, mastery: i * 15 }));

const normalizeCard = (raw, index = 0) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const word = String(raw.word || '').trim(), meaning = String(raw.meaning || '').trim();
  if (!word || !meaning) return null;
  const createdAt = Number(raw.createdAt) || now() - index * 86400000;
  return {
    id: String(raw.id || uid()), word, meaning,
    phonetic: String(raw.phonetic || ''),
    example: String(raw.example || ''),
    audio: String(raw.audio || ''),
    tags: asList(raw.tags).map(String),
    collocations: asList(raw.collocations).map(String),
    partOfSpeech: String(raw.partOfSpeech || ''),
    mnemonic: String(raw.mnemonic || ''),
    level: String(raw.level || 'NEW'),
    starred: !!raw.starred, suspended: !!raw.suspended,
    difficulty: Number.isFinite(Number(raw.difficulty)) ? Number(raw.difficulty) : 5,
    stability: Number.isFinite(Number(raw.stability)) ? Number(raw.stability) : Math.max(.4, Number(raw.interval) || .4),
    createdAt, updatedAt: Number(raw.updatedAt) || createdAt,
    due: Number(raw.due) || now(),
    interval: Number(raw.interval) || 0,
    ease: Number(raw.ease) || 2.5,
    reps: Number(raw.reps) || 0,
    lapses: Number(raw.lapses) || 0,
    mastery: Number.isFinite(Number(raw.mastery)) ? Math.max(0, Math.min(100, Number(raw.mastery))) : 0,
    lastReviewed: raw.lastReviewed || null
  };
};
const normalizeState = (raw, fallback) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const cardSource = Array.isArray(source.cards) ? source.cards : fallback.cards;
  return {
    ...fallback, ...source,
    cards: cardSource.map(normalizeCard).filter(Boolean),
    logs: asList(source.logs).filter(x => x && typeof x === 'object'),
    chat: asList(source.chat).filter(x => x && typeof x === 'object' && ['user', 'assistant', 'system'].includes(x.role) && typeof x.content === 'string'),
    mistakes: asList(source.mistakes).filter(x => x && typeof x === 'object' && x.text),
    deleted: asList(source.deleted).filter(x => x && x.id)
  };
};
const defaultState = { cards: demo, reviewsToday: 0, xp: 120, streak: 1, bestStreak: 1, lastStudy: new Date().toDateString(), logs: [], chat: [], mistakes: [], deleted: [] };
let state = normalizeState(safeParse(LS.getItem(STORAGE), null), defaultState);

const defaultSettings = {
  baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini',
  userName: '', userAge: '', level: 'B1 — متوسط', goal: 'مکالمه روزمره',
  dailyGoal: 10, correction: true, tools: true, remember: false,
  speechRate: .85, speechAccent: 'en-US', voiceURI: '', dictAudio: true, updatedAt: 0
};
const loadedSettings = safeParse(LS.getItem(SETTINGS) || SS.getItem(SETTINGS), {});
let settings = { ...defaultSettings, ...(loadedSettings && typeof loadedSettings === 'object' && !Array.isArray(loadedSettings) ? loadedSettings : {}) };
settings.dailyGoal = Math.max(1, Number(settings.dailyGoal) || 10);
settings.baseUrl = String(settings.baseUrl || defaultSettings.baseUrl);
settings.model = String(settings.model || defaultSettings.model);

for (const k of ['reviewsToday', 'xp', 'streak', 'bestStreak']) state[k] = Number.isFinite(Number(state[k])) ? Number(state[k]) : defaultState[k];
if (!state.lastStudy || Number.isNaN(new Date(state.lastStudy).getTime())) state.lastStudy = new Date().toDateString();
if (state.reviewDate !== todayKey()) { state.reviewsToday = 0; state.reviewDate = todayKey(); }

let reviewQueue = [], reviewIndex = 0, reviewMode = 'flip', smartFilter = 'all',
  selectedCards = new Set(), activeCardId = null, agentMode = 'coach',
  quickCardId = null, quickRevealed = false, chatBusy = false, chatAbort = null, syncDirty = false;

function ensureToday() {
  if (state.reviewDate !== todayKey()) { state.reviewsToday = 0; state.reviewDate = todayKey(); persistState(); }
}
function persistState() {
  try {
    const persisted = settings.chatMemory === false ? { ...state, chat: [] } : state;
    LS.setItem(STORAGE, JSON.stringify(persisted));
    syncDirty = true;
    scheduleSyncPush();
    return true;
  } catch (e) {
    console.error('Lexora state save failed', e);
    toast('فضای ذخیره‌سازی در دسترس نیست یا پر شده است', 'err');
    return false;
  }
}
const save = () => { const ok = persistState(); renderAll(); return ok; };
function saveSettingsData() {
  try {
    settings.updatedAt = now();
    const store = settings.remember ? LS : SS;
    const other = settings.remember ? SS : LS;
    store.setItem(SETTINGS, JSON.stringify(settings));
    other.removeItem(SETTINGS);
    syncDirty = true;
    scheduleSyncPush();
    return true;
  } catch (e) {
    console.error('Lexora settings save failed', e);
    toast('ذخیره تنظیمات ناموفق بود', 'err');
    return false;
  }
}
const dueCards = () => state.cards.filter(c => !c.suspended && (c.due || 0) <= now());

/* ========================= 3. TTS ENGINE ========================= */
const TTS = (() => {
  let voices = [];
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  function load() {
    if (!supported) return;
    const list = speechSynthesis.getVoices() || [];
    if (list.length) { voices = list; populateVoicePicker(); }
  }
  if (supported) {
    load();
    try { speechSynthesis.onvoiceschanged = load; } catch {}
    setTimeout(load, 250); setTimeout(load, 1200); setTimeout(load, 3000);
  }
  const enVoices = () => voices.filter(v => /^en([-_]|$)/i.test(v.lang || ''));
  function best(accent) {
    accent = String(accent || 'en-US').toLowerCase().replace('_', '-');
    const pool = enVoices();
    if (!pool.length) return null;
    const score = v => {
      let s = 0;
      const lang = String(v.lang || '').toLowerCase().replace('_', '-'), name = String(v.name || '').toLowerCase();
      if (lang === accent) s += 40; else if (lang.startsWith('en')) s += 10;
      if (name.includes('google')) s += 25;
      if (/natural|neural|premium|enhanced|online/.test(name)) s += 30;
      if (/aria|jenny|guy|libby|sonia|ryan|michelle/.test(name)) s += 12;
      if (/samantha|daniel|karen|moira|alex|ava/.test(name)) s += 14;
      if (name.includes('compact') || name.includes('espeak')) s -= 20;
      return s;
    };
    return [...pool].sort((a, b) => score(b) - score(a))[0];
  }
  function pick() {
    if (settings.voiceURI) {
      const v = voices.find(x => x.voiceURI === settings.voiceURI);
      if (v && /^en/i.test(v.lang || '')) return v;
    }
    return best(settings.speechAccent);
  }
  function chunkText(text) {
    const parts = String(text).match(/[^.!?;\n]+[.!?;\n]*/g) || [String(text)];
    const chunks = []; let cur = '';
    for (const p of parts) {
      if ((cur + p).length > 190 && cur) { chunks.push(cur); cur = p; } else cur += p;
    }
    if (cur.trim()) chunks.push(cur);
    return chunks.map(c => c.trim()).filter(Boolean);
  }
  let activeBtn = null, session = 0;
  function stop() {
    session++;
    if (supported) { try { speechSynthesis.cancel(); } catch {} }
    activeBtn?.classList.remove('speaking');
    activeBtn = null;
  }
  function speak(text, button = null) {
    text = String(text || '').trim();
    if (!text) return;
    if (!supported) return toast('مرورگر شما پخش صدا را پشتیبانی نمی‌کند', 'err');
    stop();
    load();
    const voice = pick();
    if (!voice) {
      if (!voices.length) { toast('صداها هنوز آماده نشده‌اند؛ یک لحظه بعد دوباره بزن', 'err'); return; }
      toast('صدای انگلیسی روی این دستگاه پیدا نشد؛ از تنظیمات سیستم یک صدای English نصب کن', 'err');
      return;
    }
    const rate = Number(settings.speechRate);
    const r = Number.isFinite(rate) && rate > 0 ? rate : .85;
    const chunks = chunkText(text);
    const mySession = ++session;
    activeBtn = button; button?.classList.add('speaking');
    let i = 0;
    const done = () => { if (session === mySession) { button?.classList.remove('speaking'); if (activeBtn === button) activeBtn = null; } };
    const next = () => {
      if (session !== mySession) return;
      if (i >= chunks.length) return done();
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.voice = voice; u.lang = voice.lang || 'en-US'; u.rate = r; u.pitch = 1;
      u.onend = next;
      u.onerror = done;
      speechSynthesis.speak(u);
    };
    next();
  }
  if (supported) setInterval(() => { try { if (speechSynthesis.paused && speechSynthesis.speaking) speechSynthesis.resume(); } catch {} }, 4000);
  return { speak, stop, enVoices, getVoices: () => voices, supported };
})();

function populateVoicePicker() {
  const sel = $('#voiceSelect');
  if (!sel) return;
  const en = TTS.enVoices();
  const cur = settings.voiceURI || '';
  sel.innerHTML = '<option value="">خودکار (بهترین صدای انگلیسی)</option>' +
    en.map(v => `<option value="${escapeHtml(v.voiceURI)}" ${v.voiceURI === cur ? 'selected' : ''}>${escapeHtml(v.name)} — ${escapeHtml(v.lang)}${v.localService ? '' : ' ☁'}</option>`).join('');
  const hint = $('#voiceHint');
  if (hint) hint.textContent = en.length
    ? `${fa(en.length)} صدای انگلیسی روی این دستگاه موجود است. انتخاب صدا برای هر دستگاه جداگانه ذخیره می‌شود.`
    : 'هنوز صدای انگلیسی روی این دستگاه شناسایی نشده؛ اگر تازه صفحه را باز کرده‌ای چند ثانیه صبر کن.';
}

/* Speak only English fragments of a mixed-language text */
function speakEnglishParts(text, button) {
  const runs = String(text || '').replace(/```[\s\S]*?```/g, ' ').match(/[A-Za-z][A-Za-z0-9 ,.'’"!?;:()\-]{3,}/g) || [];
  const speech = runs.map(r => r.trim()).filter(r => /[A-Za-z]{2,}/.test(r)).join('. ');
  if (!speech) return toast('متن انگلیسی برای پخش پیدا نشد', 'err');
  TTS.speak(speech, button);
}

/* ========================= 4. DICTIONARY (free, CORS-enabled) ========================= */
const Dict = (() => {
  const cache = new Map();
  async function lookup(word) {
    word = String(word || '').trim().toLowerCase();
    if (!word || word.split(/\s+/).length > 3) return null;
    if (cache.has(word)) return cache.get(word);
    try {
      const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word));
      if (!res.ok) { cache.set(word, null); return null; }
      const data = await res.json();
      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry) { cache.set(word, null); return null; }
      const ph = entry.phonetics || [];
      const audio = (ph.find(p => p.audio && /-us\./i.test(p.audio)) || ph.find(p => p.audio))?.audio || '';
      const text = entry.phonetic || ph.find(p => p.text)?.text || '';
      const m0 = (entry.meanings || [])[0] || {};
      const withEx = (entry.meanings || []).flatMap(m => m.definitions || []).find(d => d.example);
      const out = { phonetic: text, audio, partOfSpeech: m0.partOfSpeech || '', example: withEx?.example || '', definition: (m0.definitions || [])[0]?.definition || '' };
      cache.set(word, out);
      return out;
    } catch { return null; }
  }
  async function enrich(card, { overwrite = false } = {}) {
    if (!card || !navigator.onLine) return false;
    const d = await lookup(card.word);
    if (!d) return false;
    let changed = false;
    if (d.phonetic && (overwrite || !card.phonetic)) { card.phonetic = d.phonetic; changed = true; }
    if (d.audio && card.audio !== d.audio) { card.audio = d.audio; changed = true; }
    if (d.partOfSpeech && (overwrite || !card.partOfSpeech)) { card.partOfSpeech = d.partOfSpeech; changed = true; }
    if (d.example && (overwrite || !card.example)) { card.example = d.example; changed = true; }
    if (changed) card.updatedAt = now();
    return changed;
  }
  return { lookup, enrich };
})();

let currentAudio = null;
function playCardAudio(card, button = null) {
  if (!card) return;
  if (settings.dictAudio !== false && card.audio) {
    try {
      TTS.stop();
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      const a = new Audio(card.audio);
      currentAudio = a;
      button?.classList.add('speaking');
      a.onended = () => { button?.classList.remove('speaking'); if (currentAudio === a) currentAudio = null; };
      a.onerror = () => { button?.classList.remove('speaking'); if (currentAudio === a) currentAudio = null; TTS.speak(card.word, button); };
      a.play().catch(() => { button?.classList.remove('speaking'); TTS.speak(card.word, button); });
      return;
    } catch {}
  }
  TTS.speak(card.word, button);
}
const cardById = id => state.cards.find(x => x.id === id);

/* ========================= 5. NAVIGATION & RENDERING ========================= */
function navigate(page) {
  $$('.page').forEach(x => x.classList.toggle('active', x.id === 'page-' + page));
  $$('[data-page]').forEach(x => x.classList.toggle('active', x.dataset.page === page));
  document.body.className = document.body.className.replace(/\bpage-\S+/g, '').trim();
  document.body.classList.add('page-' + page);
  const titles = {
    home: [(settings.userName ? 'سلام ' + settings.userName + '، آماده‌ای؟ 👋' : 'سلام، آماده‌ای؟ 👋'), 'امروز فقط یک قدم کوچک تا انگلیسی روان‌تر فاصله داری.'],
    agent: ['اتاق تمرین با Lexi', 'مربی‌ای که فقط حرف نمی‌زند؛ در برنامه هم عمل می‌کند.'],
    cards: ['کتابخانه واژه‌ها', 'واژه‌هایت را بساز، مرتب کن و به حافظه بلندمدت بسپار.'],
    review: ['مرور هوشمند', 'هر کارت درست در لحظه‌ای برمی‌گردد که نزدیک فراموشی است.'],
    profile: ['پروفایل من', 'اطلاعات شخصی و اهداف یادگیری خود را مدیریت کن.'],
    settings: ['تنظیمات و اتصال', 'مدل، همگام‌سازی، حریم خصوصی و سبک یادگیری را کنترل کن.']
  };
  $('#pageTitle').textContent = titles[page][0];
  $('#pageSub').textContent = titles[page][1];
  if (page === 'review') startReview();
  if (page === 'agent') requestAnimationFrame(() => {
    scrollMessagesToEnd(false);
    if (finePointer() && !isMobile()) $('#chatInput').focus({ preventScroll: true });
  });
  if (page !== 'agent') window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateProfileHeader() {
  if ($('#profileNameDisplay')) {
    $('#profileNameDisplay').innerText = settings.userName || 'کاربر مهمان';
    $('#profileLevelDisplay').innerText = settings.level || 'B1 — متوسط';
  }
}

function renderAll() {
  ensureToday();
  updateProfileHeader();
  const activePage = (document.querySelector('.page.active') || {}).id || 'page-home';
  if (activePage === 'page-home' && $('#pageTitle')) $('#pageTitle').textContent = settings.userName ? `سلام ${settings.userName}، آماده‌ای؟ 👋` : 'سلام، آماده‌ای؟ 👋';
  const due = dueCards().length, total = state.cards.length;
  const mastery = total ? Math.round(state.cards.reduce((a, c) => a + (c.mastery || 0), 0) / total) : 0;
  $('#totalCards').textContent = fa(total);
  $('#dueCards').textContent = fa(due);
  $('#mastery').textContent = fa(mastery) + '%';
  $('#xp').textContent = fa(state.xp);
  $('#streakNum').textContent = fa(state.streak);
  $('#bestStreak').textContent = fa(state.bestStreak) + ' days';
  $('#streakRing').style.setProperty('--p', Math.min(100, state.streak / 7 * 100) + '%');
  const gp = Math.min(100, (state.reviewsToday / settings.dailyGoal) * 100);
  $('#goalBar').style.width = gp + '%';
  $('#goalMini').textContent = fa(state.reviewsToday) + '/' + fa(settings.dailyGoal);
  if ($('#deckDue')) {
    $('#deckDue').textContent = fa(due);
    $('#deckNew').textContent = fa(state.cards.filter(c => !c.reps).length);
    $('#deckKnown').textContent = fa(state.cards.filter(c => (c.mastery || 0) >= 80).length);
  }
  if ($('#agentDue')) {
    $('#agentDue').textContent = fa(due);
    $('#agentWeak').textContent = fa(state.cards.filter(c => (c.mastery || 0) < 35).length);
    $('#agentKnown').textContent = fa(state.cards.filter(c => (c.mastery || 0) >= 80).length);
    $('#agentStreak').textContent = fa(state.streak);
  }
  renderRecent(); renderCards(); renderLogs(); renderQuickRecall(); renderMistakes();
}

function getQuickCard() {
  let c = state.cards.find(x => x.id === quickCardId && !x.suspended);
  if (!c) {
    c = dueCards().sort((a, b) => (a.mastery || 0) - (b.mastery || 0))[0] || state.cards.filter(x => !x.suspended).sort((a, b) => (a.mastery || 0) - (b.mastery || 0))[0];
    quickCardId = c?.id || null;
    quickRevealed = false;
  }
  return c;
}
function renderQuickRecall() {
  if (!$('#quickStage')) return;
  const c = getQuickCard(), empty = !c;
  $('#quickContent').classList.toggle('hide', empty);
  $('#quickEmpty').classList.toggle('hide', !empty);
  if (empty) return;
  $('#quickWord').textContent = c.word;
  $('#quickPhonetic').textContent = c.phonetic || '';
  $('#quickMeaning').textContent = c.meaning;
  $('#quickExample').textContent = c.example || '';
  $('#quickAnswer').classList.toggle('hide', !quickRevealed);
  $('#quickReveal').classList.toggle('hide', quickRevealed);
  $('#quickAgain').classList.toggle('hide', !quickRevealed);
  $('#quickKnow').classList.toggle('hide', !quickRevealed);
  $('#quickStatus').textContent = ((c.due || 0) <= now() ? 'DUE NOW' : 'WARM UP') + ' · ' + Math.round(c.mastery || 0) + '%';
}
function gradeQuick(known) {
  const c = getQuickCard();
  if (!c) return;
  if (known) {
    c.mastery = Math.min(100, (c.mastery || 0) + 6);
    c.stability = Math.max(1, (c.stability || .4) * 1.55);
    c.due = now() + Math.max(1, Math.round(c.stability)) * 86400000;
    state.xp += 4;
  } else {
    c.mastery = Math.max(0, (c.mastery || 0) - 6);
    c.due = now() + 10 * 60 * 1000;
    c.lapses = (c.lapses || 0) + 1;
    state.xp += 1;
  }
  c.lastReviewed = now(); c.updatedAt = now();
  state.reviewsToday++;
  updateStreak();
  const candidates = state.cards.filter(x => !x.suspended && x.id !== c.id).sort((a, b) => (a.due || 0) - (b.due || 0));
  quickCardId = candidates[0]?.id || null;
  quickRevealed = false;
  save();
  toast(known ? 'ثبت شد؛ فاصله مرور بیشتر شد' : 'ثبت شد؛ کارت زودتر برمی‌گردد');
}

function renderRecent() {
  if (!$('#recentList')) return;
  const list = [...state.cards].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  $('#recentList').innerHTML = list.length ? list.map(c => `<div class="list-item"><div class="word-avatar">${escapeHtml(c.word[0]?.toUpperCase() || '?')}</div><div class="grow"><b class="en">${escapeHtml(c.word)}</b><small>${escapeHtml(c.meaning)}</small></div><span class="tag">${(c.due || 0) <= now() ? 'مرور امروز' : 'در حال یادگیری'}</span></div>`).join('') : '<div class="empty">هنوز واژه‌ای نداری.</div>';
}

function cardMatches(c) {
  const q = $('#cardSearch').value.trim().toLowerCase(), f = $('#cardFilter').value;
  const hay = [c.word, c.meaning, c.example, c.mnemonic, c.partOfSpeech, (c.tags || []).join(' '), (c.collocations || []).join(' ')].join(' ').toLowerCase();
  const smart = smartFilter === 'all'
    || (smartFilter === 'due' && !c.suspended && (c.due || 0) <= now())
    || (smartFilter === 'new' && !c.reps)
    || (smartFilter === 'weak' && (c.mastery || 0) < 35)
    || (smartFilter === 'starred' && c.starred)
    || (smartFilter === 'suspended' && c.suspended);
  const level = f === 'all' || String(c.level || '').startsWith(f);
  return (!q || hay.includes(q)) && smart && level;
}
function renderCards() {
  if (!$('#deckGrid')) return;
  const cards = state.cards.filter(cardMatches);
  $('#deckGrid').innerHTML = cards.length ? cards.map((c, i) => `<article class="card flash ${c.starred ? 'starred' : ''} ${c.suspended ? 'suspended' : ''}" data-card="${c.id}" style="--accent:${['#5de4ff', '#b174ff', '#5ee6a8', '#ffbb66'][i % 4]}"><input class="flash-select" type="checkbox" data-select="${c.id}" ${selectedCards.has(c.id) ? 'checked' : ''} aria-label="انتخاب کارت"><div class="flash-top"><div><span class="level">${escapeHtml(c.level || 'WORD')}</span> ${c.partOfSpeech ? `<span class="pos">· ${escapeHtml(c.partOfSpeech)}</span>` : ''}</div><button class="kebab" data-edit="${c.id}" title="ویرایش" type="button">•••</button></div><h3>${escapeHtml(c.word)}</h3><div class="phonetic">${escapeHtml(c.phonetic || '')}</div><div class="meaning">${escapeHtml(c.meaning)}</div><div class="tag-row">${(c.tags || []).slice(0, 3).map(t => `<span class="mini-tag">${escapeHtml(t)}</span>`).join('')}</div><div class="example">${escapeHtml(c.example || 'برای این واژه هنوز مثال ثبت نشده است.')}</div><div class="mastery-track"><i style="width:${c.mastery || 0}%"></i></div><div class="flash-foot"><span class="due">${c.suspended ? 'تعلیق‌شده' : (c.due || 0) <= now() ? 'آماده مرور' : 'مرور: ' + faDate(c.due)}</span><div class="flash-actions"><button class="icon-mini" data-star="${c.id}" title="منتخب" type="button">${c.starred ? '★' : '☆'}</button><button class="icon-mini" data-speak="${c.id}" title="تلفظ" type="button">🔊</button><button class="icon-mini danger-mini" data-delete="${c.id}" title="حذف" type="button">×</button></div></div></article>`).join('') : '<div class="card empty"><h3>کارت پیدا نشد</h3><p>فیلتر را تغییر بده یا یک واژه تازه بساز.</p></div>';
  updateBulkBar();
}
function updateBulkBar() {
  $('#bulkbar').classList.toggle('hide', !selectedCards.size);
  $('#selectedCount').textContent = fa(selectedCards.size);
}

function addTombstones(cards) {
  state.deleted = asList(state.deleted);
  cards.forEach(c => state.deleted.push({ id: c.id, word: c.word, at: now() }));
  state.deleted = state.deleted.slice(-300);
}
function deleteCards(ids, allowUndo = true) {
  const removed = state.cards.filter(c => ids.includes(c.id));
  if (!removed.length) return;
  state.cards = state.cards.filter(c => !ids.includes(c.id));
  addTombstones(removed);
  selectedCards.clear();
  const undoBatch = [...removed];
  logAction('حذف کارت', removed.map(c => c.word).join('، '));
  save();
  if (allowUndo) {
    const e = document.createElement('div');
    e.className = 'toast err';
    e.innerHTML = `${fa(removed.length)} کارت حذف شد <button class="undo-delete" type="button">بازگردانی</button>`;
    $('#toasts').append(e);
    e.querySelector('.undo-delete').onclick = () => {
      const removedIds = new Set(undoBatch.map(c => c.id));
      undoBatch.forEach(c => { c.updatedAt = now(); });
      state.cards.unshift(...undoBatch);
      state.deleted = asList(state.deleted).filter(t => !removedIds.has(t.id));
      e.remove();
      save();
      toast('کارت‌ها بازگردانی شدند');
    };
    setTimeout(() => e.remove(), 6500);
  }
}

function openDrawer(id) {
  const c = cardById(id);
  if (!c) return;
  activeCardId = id;
  $('#drawerWord').textContent = c.word;
  $('#drawerPhonetic').textContent = c.phonetic || '';
  $('#drawerMeaning').textContent = c.meaning;
  $('#drawerExample').textContent = c.example || '—';
  $('#drawerCollocations').innerHTML = (c.collocations || []).map(x => `<span class="mini-tag en">${escapeHtml(x)}</span>`).join('') || '<span class="tiny">ثبت نشده</span>';
  $('#drawerMnemonic').textContent = c.mnemonic || 'هنوز یادسپار شخصی ثبت نشده است.';
  $('#drawerMastery').textContent = 'تسلط ' + fa(c.mastery || 0) + '%';
  $('#drawerNext').textContent = c.suspended ? 'تعلیق‌شده' : (c.due || 0) <= now() ? 'آماده مرور' : faDate(c.due);
  $('#drawerMasteryBar').style.width = (c.mastery || 0) + '%';
  $('#cardDrawer').classList.add('show');
}

function renderLogs() {
  if (!$('#actionLog')) return;
  $('#actionLog').innerHTML = (state.logs || []).slice(0, 8).map(l => `<div class="log"><em>${escapeHtml(l.action)}</em> · ${escapeHtml(l.detail)}<br><small>${new Date(l.time).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('') || '<div class="tiny">هنوز اقدامی انجام نشده.</div>';
}
function logAction(action, detail) {
  state.logs.unshift({ action, detail: String(detail || ''), time: now() });
  state.logs = state.logs.slice(0, 30);
}

function renderMistakes() {
  const box = $('#errorLedger');
  if (!box) return;
  const items = asList(state.mistakes).slice(0, 8);
  $('#mistakeCount').textContent = state.mistakes?.length ? fa(state.mistakes.length) + ' الگو' : '';
  $('#drillMistakes')?.classList.toggle('hide', !items.length);
  box.innerHTML = items.length
    ? items.map(m => `<div class="mistake-item"><div class="grow"><b class="en">${escapeHtml(m.text)}</b><small>${escapeHtml(m.fix || '')}${m.type ? ' · ' + escapeHtml(m.type) : ''}</small></div><span class="mistake-count">${fa(m.count || 1)}</span></div>`).join('')
    : '<p class="tiny">هنوز الگوی تکراری ثبت نشده است. Lexi حین تمرین، خطاهای مهم را اینجا ثبت می‌کند.</p>';
}
function logMistake({ mistake, correction, type }) {
  mistake = String(mistake || '').trim();
  if (!mistake) throw new Error('mistake متن لازم دارد');
  state.mistakes = asList(state.mistakes);
  const norm = mistake.toLowerCase();
  const existing = state.mistakes.find(m => String(m.text || '').toLowerCase() === norm);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastAt = now();
    if (correction) existing.fix = String(correction);
    if (type) existing.type = String(type);
  } else {
    state.mistakes.unshift({ id: uid(), text: mistake, fix: String(correction || ''), type: String(type || ''), count: 1, lastAt: now() });
  }
  state.mistakes = state.mistakes.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)).slice(0, 40);
  persistState();
  renderMistakes();
  return { ok: true, tracked: mistake };
}

/* ========================= 6. CARD CRUD & SRS ========================= */
function openCard(c = null) {
  $('#editId').value = c?.id || '';
  $('#fWord').value = c?.word || '';
  $('#fMeaning').value = c?.meaning || '';
  $('#fPhonetic').value = c?.phonetic || '';
  $('#fExample').value = c?.example || '';
  $('#fTags').value = (c?.tags || []).join('، ');
  $('#fPos').value = c?.partOfSpeech || '';
  $('#fLevel').value = c?.level || 'NEW';
  $('#fCollocations').value = (c?.collocations || []).join(', ');
  $('#fMnemonic').value = c?.mnemonic || '';
  $('#modalDelete').classList.toggle('hide', !c);
  $('#modalTitle').textContent = c ? 'ویرایش کارت' : 'کلمه جدید';
  $('#cardModal').classList.add('show');
  if (finePointer()) setTimeout(() => $('#fWord').focus(), 80);
}
function closeModal() { $('#cardModal').classList.remove('show'); }

const CARD_FIELDS = ['word', 'meaning', 'phonetic', 'example', 'audio', 'tags', 'collocations', 'partOfSpeech', 'mnemonic', 'level', 'starred', 'suspended'];
function addCard(args, byAgent = false) {
  if (!args.word || !args.meaning) throw new Error('word و meaning لازم‌اند');
  const existing = state.cards.find(c => c.word.toLowerCase() === String(args.word).toLowerCase());
  if (existing) {
    CARD_FIELDS.forEach(k => { if (args[k] !== undefined && args[k] !== null && k !== 'word') existing[k] = args[k]; });
    existing.tags = Array.isArray(args.tags) ? args.tags.map(String) : existing.tags;
    existing.updatedAt = now();
    logAction('ویرایش کارت', existing.word);
    if (!byAgent) toast('کارت موجود به‌روزرسانی شد');
    save();
    return { ok: true, action: 'updated', card: { id: existing.id, word: existing.word } };
  }
  const c = normalizeCard({
    id: uid(), word: String(args.word).trim(), meaning: String(args.meaning).trim(),
    phonetic: args.phonetic || '', example: args.example || '', audio: args.audio || '',
    tags: Array.isArray(args.tags) ? args.tags : [], collocations: Array.isArray(args.collocations) ? args.collocations : [],
    partOfSpeech: args.partOfSpeech || '', mnemonic: args.mnemonic || '', level: args.level || 'NEW',
    createdAt: now(), updatedAt: now(), due: now()
  });
  state.cards.unshift(c);
  state.xp += 10;
  logAction('ساخت کارت', c.word);
  if (!byAgent) toast('فلش‌کارت ساخته شد');
  save();
  Dict.enrich(c).then(changed => { if (changed) { persistState(); renderAll(); } });
  return { ok: true, action: 'created', card: { id: c.id, word: c.word } };
}
function updateCard(args) {
  const c = state.cards.find(x => x.id === args.id) || state.cards.find(x => x.word.toLowerCase() === String(args.word || '').toLowerCase());
  if (!c) throw new Error('کارت پیدا نشد');
  CARD_FIELDS.forEach(k => { if (args[k] !== undefined && args[k] !== null) c[k] = args[k]; });
  c.word = String(c.word).trim();
  c.updatedAt = now();
  logAction('ویرایش کارت', c.word);
  save();
  return { ok: true, card: { id: c.id, word: c.word } };
}
function deleteCard(args) {
  const i = state.cards.findIndex(x => x.id === args.id || x.word.toLowerCase() === String(args.word || '').toLowerCase());
  if (i < 0) throw new Error('کارت پیدا نشد');
  const [c] = state.cards.splice(i, 1);
  addTombstones([c]);
  logAction('حذف کارت', c.word);
  save();
  return { ok: true, deleted: c.word };
}
function listCards(args = {}) {
  let a = state.cards;
  if (args.due_only) a = a.filter(c => !c.suspended && (c.due || 0) <= now());
  if (args.query) a = a.filter(c => (c.word + ' ' + c.meaning).toLowerCase().includes(String(args.query).toLowerCase()));
  return a.slice(0, args.limit || 20).map(({ id, word, meaning, example, tags, due, mastery }) => ({ id, word, meaning, example, tags, due, mastery }));
}

function startReview() {
  reviewQueue = dueCards().slice().sort((a, b) => ((a.due || 0) - (b.due || 0)) || ((a.mastery || 0) - (b.mastery || 0)));
  reviewIndex = 0;
  renderReview();
}
function intervalPreview(c) {
  const base = Math.max(.4, c.stability || c.interval || .4);
  return { again: '۱۰ دقیقه', hard: fa(Math.max(1, Math.round(base * .8))) + ' روز', good: fa(Math.max(2, Math.round(base * 2.4))) + ' روز', easy: fa(Math.max(4, Math.round(base * 4))) + ' روز' };
}
function normalizePersian(str) {
  return String(str || '').trim().toLowerCase().replace(/[\u200C\u200F\u064B-\u065F]/g, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, '');
}
function makeCloze(c) {
  const word = String(c.word || '').trim();
  if (!word) return escapeHtml(c.example || '');
  let ex = c.example || `I want to use the word ${word} correctly.`;
  ex = escapeHtml(ex);
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replaced = ex.replace(new RegExp('\\b' + esc + '\\b', 'i'), '<span class="cloze-blank">••••••</span>');
  return replaced === ex ? ex.replace(new RegExp(esc, 'i'), '<span class="cloze-blank">••••••</span>') : replaced;
}
function renderReview() {
  const done = reviewIndex, total = reviewQueue.length, left = total - done;
  $('#reviewBar').style.width = (total ? done / total * 100 : 100) + '%';
  $('#reviewRemain').textContent = fa(Math.max(0, left)) + ' باقی‌مانده';
  $('#reviewCount').textContent = 'مرور امروز · ' + fa(done) + ' از ' + fa(total);
  const empty = left <= 0;
  $('#reviewEmpty').classList.toggle('hide', !empty);
  $('#reviewArea').classList.toggle('hide', empty);
  if (empty) return;
  const c = reviewQueue[reviewIndex], iv = intervalPreview(c);
  $('#reviewWord').textContent = c.word;
  $('#reviewPhonetic').textContent = c.phonetic || '';
  $('#reviewMeaning').textContent = c.meaning;
  $('#reviewExample').textContent = c.example || '';
  $('#reviewCollocations').innerHTML = (c.collocations || []).map(x => `<span class="mini-tag en">${escapeHtml(x)}</span>`).join('');
  $('#reviewDifficulty').textContent = 'سختی ' + Number(c.difficulty || 5).toFixed(1);
  $('#reviewStability').textContent = 'پایداری ' + Number(c.stability || .4).toFixed(1) + ' روز';
  Object.entries(iv).forEach(([k, v]) => $('#' + k + 'Interval').textContent = v);
  $('#reviewCard').classList.remove('flipped');
  $('#rating').classList.add('hide');
  $('#answerBox').classList.toggle('hide', reviewMode !== 'type');
  $('#choiceGrid').classList.toggle('hide', reviewMode !== 'choice');
  $('#clozeSentence').classList.toggle('hide', reviewMode !== 'cloze');
  $('#reviewWord').classList.toggle('hide', reviewMode === 'cloze');
  $('#flipHint').classList.toggle('hide', reviewMode !== 'flip' && reviewMode !== 'cloze');
  $('#answerFeedback').classList.add('hide');
  $('#typedAnswer').value = '';
  $('#reviewInstruction').textContent = reviewMode === 'type' ? 'TYPE THE PERSIAN MEANING' : reviewMode === 'cloze' ? 'COMPLETE THE SENTENCE' : reviewMode === 'choice' ? 'CHOOSE THE MEANING' : 'RECALL THE MEANING';
  if (reviewMode === 'cloze') $('#clozeSentence').innerHTML = makeCloze(c);
  if (reviewMode === 'choice') {
    const pool = [...new Set(state.cards.filter(x => x.id !== c.id && x.meaning !== c.meaning).map(x => x.meaning))].sort(() => Math.random() - .5);
    const fallback = ['یک معنی متفاوت', 'گزینه نامرتبط', 'مفهوم دیگری'];
    while (pool.length < 3) pool.push(fallback[pool.length] || ('گزینه ' + (pool.length + 1)));
    const choices = [c.meaning, ...pool.slice(0, 3)].sort(() => Math.random() - .5);
    $('#choiceGrid').innerHTML = choices.map(x => `<button class="choice" type="button" data-choice="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('');
  }
  if (finePointer()) setTimeout(() => { if (reviewMode === 'type') $('#typedAnswer').focus(); }, 100);
}
function revealReview() {
  $('#reviewCard').classList.add('flipped');
  $('#rating').classList.remove('hide');
}
function rateCard(rate) {
  const c = reviewQueue[reviewIndex];
  if (!c) return;
  const oldS = Math.max(.4, c.stability || .4), oldD = c.difficulty || 5;
  if (rate === 'again') {
    c.lapses = (c.lapses || 0) + 1;
    c.reps = 0;
    c.stability = Math.max(.2, oldS * .55);
    c.difficulty = Math.min(10, oldD + .7);
    c.due = now() + 10 * 60 * 1000;
    c.mastery = Math.max(0, (c.mastery || 0) - 12);
    state.xp += 1;
  } else {
    const mult = rate === 'hard' ? 1.25 : rate === 'good' ? 2.4 : 4;
    c.reps = (c.reps || 0) + 1;
    c.stability = Math.max(1, oldS * mult * (1 + (10 - oldD) * .025));
    c.difficulty = Math.max(1, Math.min(10, oldD + (rate === 'hard' ? .2 : rate === 'easy' ? -.35 : -.08)));
    const days = Math.max(rate === 'hard' ? 1 : rate === 'good' ? 2 : 4, Math.round(c.stability));
    c.interval = days;
    c.due = now() + days * 86400000;
    c.mastery = Math.min(100, (c.mastery || 0) + (rate === 'hard' ? 3 : rate === 'good' ? 9 : 15));
    state.xp += rate === 'hard' ? 3 : rate === 'good' ? 5 : 7;
  }
  c.lastReviewed = now(); c.updatedAt = now();
  state.reviewsToday++;
  updateStreak();
  reviewIndex++;
  save();
  renderReview();
}
function updateStreak() {
  const today = new Date(), last = new Date(state.lastStudy);
  const day = Math.floor((new Date(today.toDateString()) - new Date(last.toDateString())) / 86400000);
  if (day === 1) state.streak++;
  else if (day > 1) state.streak = 1;
  state.lastStudy = today.toDateString();
  state.bestStreak = Math.max(state.bestStreak, state.streak);
}

/* ========================= 7. BIDI CHAT FORMATTING ========================= */
function sanitizeChatText(value = '') {
  return String(value ?? '').normalize('NFC').replace(/\uFFFD+/g, '').replace(/\u0000/g, '');
}
function firstStrongDirection(text = '') {
  const clean = sanitizeChatText(text).replace(/https?:\/\/\S+|www\.\S+|`[^`]*`/g, '');
  for (const ch of clean) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(ch)) return 'rtl';
    if (/[A-Za-z]/.test(ch)) return 'ltr';
  }
  return 'auto';
}
function formatBidiInline(raw = '') {
  raw = sanitizeChatText(raw);
  const tokens = [];
  const hold = (type, value) => {
    const key = '\uE000' + String.fromCharCode(0xE100 + tokens.length) + '\uE001';
    tokens.push({ key, type, value });
    return key;
  };
  raw = raw
    .replace(/`([^`\n]+)`/g, (_, v) => hold('code', v))
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, v => hold('url', v))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, v => hold('email', v));
  const run = /[A-Za-z][A-Za-z0-9]*(?:(?:[._+#@/'’:-])[A-Za-z0-9]+)*(?:\s+[A-Za-z0-9][A-Za-z0-9]*(?:(?:[._+#@/'’:-])[A-Za-z0-9]+)*)*|\d+(?:[.,:/-]\d+)*%?/g;
  let out = '', last = 0, m;
  while ((m = run.exec(raw))) {
    out += escapeHtml(raw.slice(last, m.index));
    out += '<bdi class="bidi-ltr" dir="ltr">' + escapeHtml(m[0]) + '</bdi>';
    last = m.index + m[0].length;
  }
  out += escapeHtml(raw.slice(last));
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  for (const t of tokens) {
    let html;
    if (t.type === 'code') html = '<code class="bidi-code" dir="ltr">' + escapeHtml(t.value) + '</code>';
    else if (t.type === 'email') html = '<a class="bidi-link" dir="ltr" href="mailto:' + escapeHtml(t.value) + '">' + escapeHtml(t.value) + '</a>';
    else {
      const href = t.value.startsWith('www.') ? 'https://' + t.value : t.value;
      html = '<a class="bidi-link" dir="ltr" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(t.value) + '</a>';
    }
    out = out.split(t.key).join(html);
  }
  return out;
}
function splitTableRow(line = '') {
  line = sanitizeChatText(line).trim();
  if (line.startsWith('|')) line = line.slice(1);
  if (line.endsWith('|')) line = line.slice(0, -1);
  const cells = [];
  let cell = '', code = false, escaped = false;
  for (const ch of line) {
    if (escaped) { cell += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '`') { code = !code; cell += ch; continue; }
    if (ch === '|' && !code) { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}
function isTableDivider(line = '') {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every(c => /^:?-{3,}:?$/.test(c.replace(/\s/g, '')));
}
function tableAlignment(spec = '') {
  spec = spec.replace(/\s/g, '');
  if (spec.startsWith(':') && spec.endsWith(':')) return 'center';
  if (spec.endsWith(':')) return 'right';
  if (spec.startsWith(':')) return 'left';
  return 'start';
}
function renderMdTable(lines, start) {
  const headers = splitTableRow(lines[start]), specs = splitTableRow(lines[start + 1]);
  const align = headers.map((_, i) => tableAlignment(specs[i] || ''));
  let i = start + 2, rows = [];
  while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
    const cells = splitTableRow(lines[i]);
    rows.push(headers.map((_, n) => cells[n] ?? ''));
    i++;
  }
  const cell = (tag, value, n) => `<${tag} dir="${firstStrongDirection(value)}" style="text-align:${align[n] || 'start'}">${formatBidiInline(value)}</${tag}>`;
  return {
    html: `<div class="chat-table-wrap" role="region" aria-label="جدول پاسخ" tabindex="0"><table class="chat-table" dir="${firstStrongDirection(lines[start])}"><thead><tr>${headers.map((v, n) => cell('th', v, n)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((v, n) => cell('td', v, n)).join('')}</tr>`).join('')}</tbody></table></div>`,
    next: i
  };
}
function formatAgentText(text = '') {
  const lines = sanitizeChatText(text).replace(/\r\n?/g, '\n').split('\n'), out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      let codeContent = '';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { codeContent += lines[i] + '\n'; i++; }
      i++;
      out.push(`<pre class="chat-code-wrap"><code class="bidi-code block" dir="ltr">${escapeHtml(codeContent.trim())}</code></pre>`);
      continue;
    }
    if (i + 1 < lines.length && /\|/.test(line) && isTableDivider(lines[i + 1])) {
      const table = renderMdTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }
    if (!line.trim()) { out.push('<div class="bidi-spacer" aria-hidden="true"></div>'); i++; continue; }
    let m;
    if ((m = line.match(/^\s*(#{1,3})\s+(.+)$/))) {
      const level = Math.min(4, m[1].length + 2), content = m[2];
      out.push(`<h${level} class="chat-heading" dir="${firstStrongDirection(content)}">${formatBidiInline(content)}</h${level}>`);
      i++; continue;
    }
    if (/^\s*---+\s*$/.test(line)) { out.push('<hr class="chat-divider">'); i++; continue; }
    if ((m = line.match(/^\s*>\s?(.*)$/))) {
      const content = m[1];
      out.push(`<blockquote class="chat-quote" dir="${firstStrongDirection(content)}">${formatBidiInline(content)}</blockquote>`);
      i++; continue;
    }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.+)$/))) {
      const content = m[2];
      out.push(`<div class="bidi-line bidi-list" dir="${firstStrongDirection(content)}"><span class="bidi-list-mark" dir="ltr">${m[1]}.</span><span>${formatBidiInline(content)}</span></div>`);
      i++; continue;
    }
    const bullet = /^\s*[-•*]\s+/.test(line);
    const content = bullet ? line.replace(/^\s*[-•*]\s+/, '') : line;
    const dir = firstStrongDirection(content);
    out.push('<div class="bidi-line' + (bullet ? ' bidi-bullet' : '') + '" dir="' + dir + '">' + (bullet ? '<span class="bidi-bullet-mark" aria-hidden="true">•</span>' : '') + '<span>' + formatBidiInline(content) + '</span></div>');
    i++;
  }
  return out.join('');
}
async function copyChatText(text) {
  text = sanitizeChatText(text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(area);
      area.select();
      if (!document.execCommand('copy')) throw new Error('copy failed');
      area.remove();
    }
    toast('متن پیام کپی شد');
  } catch { toast('کپی‌کردن در این مرورگر ممکن نیست', 'err'); }
}

/* ========================= 8. CHAT RENDERING ========================= */
const messagesBox = () => $('#messages');
function isPinnedToBottom(box = messagesBox()) {
  return box.scrollHeight - box.scrollTop - box.clientHeight < 90;
}
function scrollMessagesToEnd(smooth = true) {
  const box = messagesBox();
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}
function renderMessages() {
  const box = messagesBox();
  if (!box) return;
  const pinned = isPinnedToBottom(box);
  $('#composer')?.classList.toggle('has-chat', !!state.chat.length);
  if (!state.chat.length) {
    box.innerHTML = `<div class="chat-welcome"><div class="welcome-mark">✦</div><h3>استودیوی تمرین شخصی تو</h3><p>یک هدف انتخاب کن؛ من مکالمه را هدایت می‌کنم، اشتباه‌ها را تحلیل می‌کنم و فلش‌کارت‌ها را مستقیماً مدیریت می‌کنم.</p><div class="starter-grid"><button class="starter" type="button" data-starter="یک مکالمه واقعی در فرودگاه شروع کن و فقط اشتباه‌های مهمم را اصلاح کن."><b>مکالمه واقعی</b><small>Role-play تطبیقی با سطح تو</small></button><button class="starter" type="button" data-starter="با پنج سؤال کوتاه ضعف گرامری من را تشخیص بده."><b>Grammar Scan</b><small>تشخیص سریع نقاط ضعف</small></button><button class="starter" type="button" data-starter="از واژه‌های ضعیفم یک تمرین cloze بساز و بعد از پاسخ‌ها کارت‌ها را به‌روزرسانی کن."><b>Memory Workout</b><small>تمرین از روی فلش‌کارت‌ها</small></button><button class="starter" type="button" data-starter="یک آزمون کوتاه IELTS Speaking Part 2 بگیر و نمره تقریبی بده."><b>IELTS Sprint</b><small>تمرین هدفمند و بازخورد فوری</small></button></div></div>`;
  } else {
    box.innerHTML = state.chat.map((m, i) => {
      const time = new Date(m.createdAt || Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const label = m.role === 'user' ? 'YOU · ' + time : m.role === 'assistant' ? 'LEXI · ' + time : 'SYSTEM';
      const actions = m.role === 'system' ? '' :
        `<div class="msg-actions">${m.role === 'assistant' ? `<button class="msg-btn" type="button" data-speak-msg="${i}" title="پخش بخش‌های انگلیسی">🔊</button>` : ''}<button class="msg-btn" type="button" data-copy-msg="${i}" aria-label="کپی پیام" title="کپی پیام">⧉</button></div>`;
      return `<div class="msg-row ${m.role}"><div class="msg ${m.role}"><div class="msg-head"><div class="msg-time">${label}</div>${actions}</div><div class="msg-content">${formatAgentText(m.content || '')}</div>${m.toolNote ? `<div class="tool-note" dir="auto"><bdi dir="ltr">ACTION</bdi> · ${formatBidiInline(m.toolNote)}</div>` : ''}</div></div>`;
    }).join('');
  }
  if (pinned) box.scrollTop = box.scrollHeight;
  updateScrollDown();
}
function updateScrollDown() {
  const box = messagesBox();
  $('#scrollDown')?.classList.toggle('hide', !box || box.scrollHeight - box.scrollTop - box.clientHeight < 250);
}

/* ========================= 9. AGENT TOOLS ========================= */
const toolDefs = [
  { type: 'function', function: { name: 'add_flashcard', description: 'Create a flashcard in the user app. Use when a useful English word or phrase should be saved.', parameters: { type: 'object', properties: { word: { type: 'string' }, meaning: { type: 'string', description: 'Persian meaning' }, phonetic: { type: 'string' }, example: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, level: { type: 'string' } }, required: ['word', 'meaning'] } } },
  { type: 'function', function: { name: 'update_flashcard', description: 'Update an existing flashcard by id or word.', parameters: { type: 'object', properties: { id: { type: 'string' }, word: { type: 'string' }, meaning: { type: 'string' }, phonetic: { type: 'string' }, example: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, level: { type: 'string' } } } } },
  { type: 'function', function: { name: 'delete_flashcard', description: 'Delete a flashcard by id or exact word.', parameters: { type: 'object', properties: { id: { type: 'string' }, word: { type: 'string' } } } } },
  { type: 'function', function: { name: 'list_flashcards', description: 'Read flashcards, search them, or inspect due cards.', parameters: { type: 'object', properties: { query: { type: 'string' }, due_only: { type: 'boolean' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'get_learning_stats', description: 'Read current learning statistics.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'bulk_add_flashcards', description: 'Create multiple high-quality flashcards in one action.', parameters: { type: 'object', properties: { cards: { type: 'array', items: { type: 'object', properties: { word: { type: 'string' }, meaning: { type: 'string' }, example: { type: 'string' }, phonetic: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, collocations: { type: 'array', items: { type: 'string' } }, partOfSpeech: { type: 'string' }, level: { type: 'string' } }, required: ['word', 'meaning'] } } }, required: ['cards'] } } },
  { type: 'function', function: { name: 'set_flashcard_state', description: 'Star, unstar, suspend or resume an existing flashcard.', parameters: { type: 'object', properties: { id: { type: 'string' }, word: { type: 'string' }, starred: { type: 'boolean' }, suspended: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'open_review', description: 'Open the smart review screen for the learner.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'log_mistake', description: 'Record a recurring learner mistake in the visible Error Ledger. Use whenever the learner makes a meaningful, reusable mistake (grammar, word choice, pronunciation).', parameters: { type: 'object', properties: { mistake: { type: 'string', description: 'The wrong form the learner produced, short' }, correction: { type: 'string', description: 'The corrected form' }, type: { type: 'string', enum: ['grammar', 'vocabulary', 'pronunciation', 'spelling', 'other'] } }, required: ['mistake'] } } },
  { type: 'function', function: { name: 'get_mistakes', description: 'Read the learner recurring-mistakes ledger to plan targeted drills.', parameters: { type: 'object', properties: {} } } }
];
const TOOL_LABELS = { add_flashcard: 'ساخت کارت', update_flashcard: 'ویرایش کارت', delete_flashcard: 'حذف کارت', list_flashcards: 'خواندن کارت‌ها', get_learning_stats: 'خواندن آمار', bulk_add_flashcards: 'ساخت گروهی کارت', set_flashcard_state: 'تغییر وضعیت کارت', open_review: 'بازکردن مرور', log_mistake: 'ثبت خطا', get_mistakes: 'خواندن دفتر خطاها' };

function executeTool(name, args) {
  if (!settings.tools) throw new Error('اجرای ابزارها در تنظیمات غیرفعال است');
  args = args && typeof args === 'object' ? args : {};
  const destructive = ['delete_flashcard'];
  const mutating = ['add_flashcard', 'update_flashcard', 'delete_flashcard', 'bulk_add_flashcards', 'set_flashcard_state'];
  const needsApproval = (settings.toolApproval === 'all' && mutating.includes(name)) || ((settings.toolApproval === 'destructive' || !settings.toolApproval) && destructive.includes(name));
  if (needsApproval && !confirm('Lexi می‌خواهد این عمل را انجام دهد: «' + (TOOL_LABELS[name] || name) + '». تأیید می‌کنی؟')) return { ok: false, cancelled: true, note: 'user declined' };
  if (name === 'add_flashcard') return addCard(args, true);
  if (name === 'update_flashcard') return updateCard(args);
  if (name === 'delete_flashcard') return deleteCard(args);
  if (name === 'list_flashcards') return listCards(args);
  if (name === 'get_learning_stats') return { total: state.cards.length, due: dueCards().length, weak: state.cards.filter(c => (c.mastery || 0) < 35).length, reviewsToday: state.reviewsToday, streak: state.streak, xp: state.xp };
  if (name === 'bulk_add_flashcards') {
    const items = Array.isArray(args.cards) ? args.cards : [];
    return { ok: true, created: items.map(x => addCard(x, true).card.word) };
  }
  if (name === 'set_flashcard_state') {
    const c = state.cards.find(x => x.id === args.id) || state.cards.find(x => x.word.toLowerCase() === String(args.word || '').toLowerCase());
    if (!c) throw new Error('کارت پیدا نشد');
    if (typeof args.starred === 'boolean') c.starred = args.starred;
    if (typeof args.suspended === 'boolean') c.suspended = args.suspended;
    c.updatedAt = now();
    save();
    return { ok: true, card: c.word, starred: c.starred, suspended: c.suspended };
  }
  if (name === 'open_review') { navigate('review'); return { ok: true, due: dueCards().length }; }
  if (name === 'log_mistake') return logMistake(args);
  if (name === 'get_mistakes') return asList(state.mistakes).slice(0, 12).map(({ text, fix, type, count }) => ({ mistake: text, correction: fix, type, count }));
  throw new Error('ابزار ناشناخته: ' + name);
}

/* ========================= 10. SYSTEM PROMPT ========================= */
function systemPrompt() {
  const modeGuides = {
    coach: 'Blend conversation, correction and retrieval. Open each session by proposing ONE concrete drill based on weaknesses and due cards, then run it.',
    conversation: 'Run a realistic role-play. Stay mostly in English, adapt difficulty to the learner level, keep the scene alive with follow-up turns, and give a short correction recap after every 3 learner turns.',
    grammar: 'Act as Grammar Doctor: diagnose the error precisely, explain the smallest useful rule in Persian, give 2 contrasting examples, then require a corrected retry from the learner before moving on.',
    ielts: 'Act as an IELTS examiner and coach. Ask ONE question at a time, time-box parts realistically, track fluency, lexical resource, grammar and coherence, then give band-oriented feedback with concrete upgrades.',
    interview: 'Simulate a professional job interview in English. Ask realistic follow-ups, then upgrade the learner answer while keeping it natural and personal.',
    vocab: 'Focus on active vocabulary: collocations, contrast, cloze and production. Recycle the learner weak words. Use app tools to keep cards accurate.'
  };
  const learner = {
    name: settings.userName || 'the learner', age: settings.userAge || null,
    level: settings.level, goal: settings.goal, targetDate: settings.targetDate || null,
    nativeLanguage: settings.nativeLanguage || 'fa',
    interests: settings.interests || '', contexts: settings.contexts || '',
    targetAccent: settings.targetAccent || settings.speechAccent || 'en-US',
    skills: settings.skills || {},
    correctionStyle: settings.correctionStyle || 'balanced',
    explanationDepth: settings.explanationDepth || 'brief',
    englishFirst: !!settings.englishFirst,
    retrievalFirst: settings.retrievalFirst !== false,
    autoCards: !!settings.autoCards,
    initiative: Number(settings.agentInitiative) || 2
  };
  const weakWords = state.cards.filter(c => !c.suspended && (c.mastery || 0) < 35).slice(0, 8).map(c => c.word);
  const topMistakes = asList(state.mistakes).slice(0, 6).map(m => `${m.text}${m.fix ? ' → ' + m.fix : ''} (x${m.count || 1})`);
  return `You are Lexi — a rigorous, warm, high-agency English tutor living inside the Lexora app. The learner is Persian (Farsi) speaking.

## WORK ETHIC — non-negotiable
- NEVER be lazy. No filler, no "let me know if you want more", no cutting exercises short. Deliver the complete drill, the complete feedback, the complete plan — now.
- Run the FULL teaching loop every time: (1) set a micro-task → (2) learner attempts → (3) precise correction with WHY → (4) targeted retry on the exact error → (5) confirm before moving on.
- Ask ONE question at a time during drills and assessments. Wait for the answer. Never dump a list of questions.
- Track the session actively: remember what you asked, close every loop you open, and reference earlier answers.
- Adapt difficulty in real time: if the learner struggles, simplify; if they cruise, push harder.

## ACTIVE MODE: ${agentMode}
${modeGuides[agentMode]}

## LEARNER PROFILE
${JSON.stringify(learner)}
Weak words to recycle: ${JSON.stringify(weakWords)}
Recurring mistakes ledger: ${JSON.stringify(topMistakes)}

## LANGUAGE POLICY
- ${learner.englishFirst ? 'Default to English during practice; use Persian only for tricky explanations.' : 'Use Persian for explanations and meta-talk; use natural English for all practice content.'}
- Correct mistakes ${settings.correction ? `following correctionStyle="${learner.correctionStyle}"` : 'only when explicitly asked'}. Explanation depth: ${learner.explanationDepth}.
- ${learner.retrievalFirst ? 'Retrieval first: always give the learner a chance to recall/produce BEFORE revealing answers.' : ''}
- Personalize examples with the learner's interests and contexts.
- Whenever the learner produces a meaningful recurring-type error, call log_mistake with the wrong form and correction.

## TOOLS
- You have real tools that modify the app. Use them for card actions; NEVER claim an action succeeded unless the tool result confirms it. If a tool fails or is declined, say so honestly.
- ${learner.autoCards ? 'Proactively suggest valuable flashcards, but ask before saving unless the learner explicitly requested cards.' : 'Do not create cards unless the learner explicitly asks.'}
- Card meanings must be Persian; examples must be natural English. Include phonetic (IPA) when you know it.

## FORMATTING
- Clean, compact answers: short headings, numbered steps.
- ALWAYS use GFM Markdown tables (2-4 columns) for grammar comparisons, tense charts and vocabulary contrasts. One concept per row, English examples + concise Persian notes.
- Never output raw HTML.

## APP CONTEXT
${JSON.stringify({ totalCards: state.cards.length, due: dueCards().length, reviewsToday: state.reviewsToday, dailyGoal: settings.dailyGoal, streak: state.streak, recent: state.cards.slice(0, 8).map(c => c.word) })}`;
}

/* ========================= 11. CHAT ENGINE (streaming + tools) ========================= */
function endpoint() {
  return settings.baseUrl.replace(/\/+$/, '') + (settings.baseUrl.includes('/chat/completions') ? '' : '/chat/completions');
}
function apiHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey };
}
function friendlyHttpError(status, text = '') {
  const snippet = String(text).slice(0, 180);
  if (status === 401 || status === 403) return 'کلید API نامعتبر است یا دسترسی ندارد (HTTP ' + status + ')';
  if (status === 404) return 'آدرس یا نام مدل اشتباه است (HTTP 404)';
  if (status === 429) return 'سقف تعداد درخواست‌ها پر شده؛ کمی صبر کن (HTTP 429)';
  if (status >= 500) return 'سرور سرویس هوش مصنوعی در دسترس نیست (HTTP ' + status + ')';
  return 'HTTP ' + status + (snippet ? ' · ' + snippet : '');
}
async function parseNonStream(res, onDelta) {
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error('پاسخ مدل قابل خواندن نیست');
  if (msg.content) onDelta?.(msg.content);
  return msg;
}
async function requestCompletion(messages, { signal, onDelta, stream = true } = {}) {
  const body = { model: settings.model, messages, temperature: .65 };
  if (settings.tools) body.tools = toolDefs;
  if (stream) body.stream = true;
  let res;
  try {
    res = await fetch(endpoint(), { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('اتصال برقرار نشد؛ اینترنت یا CORS سرویس را بررسی کن');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (stream && res.status === 400 && /stream/i.test(t)) return requestCompletion(messages, { signal, onDelta, stream: false });
    throw new Error(friendlyHttpError(res.status, t));
  }
  const ctype = res.headers.get('content-type') || '';
  if (!stream || !ctype.includes('text/event-stream') || !res.body) return parseNonStream(res, onDelta);
  /* SSE parse */
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const out = { role: 'assistant', content: '', tool_calls: [] };
  let sawDone = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { sawDone = true; continue; }
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      if (json.error) throw new Error(json.error.message || 'خطای سرویس');
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string' && delta.content) { out.content += delta.content; onDelta?.(out.content); }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          out.tool_calls[idx] = out.tool_calls[idx] || { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) out.tool_calls[idx].id = tc.id;
          if (tc.function?.name) out.tool_calls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) out.tool_calls[idx].function.arguments += tc.function.arguments;
        }
      }
    }
  }
  out.tool_calls = out.tool_calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || 'call_' + i }));
  if (!out.tool_calls.length) delete out.tool_calls;
  if (!out.content && !out.tool_calls && !sawDone) throw new Error('پاسخ ناقص دریافت شد؛ دوباره تلاش کن');
  return out;
}
function setChatBusy(busy) {
  chatBusy = busy;
  $('#sendBtn').classList.toggle('hide', busy);
  $('#stopBtn').classList.toggle('hide', !busy);
  $('#agentStatus').textContent = busy ? 'در حال فکر کردن…' : 'آماده برای یادگیری';
  $('#agentStatus').classList.toggle('busy', busy);
}
async function sendChat(text) {
  text = sanitizeChatText(text).trim();
  if (!text) return;
  if (chatBusy) return toast('لطفاً تا پایان پاسخ فعلی صبر کن', 'err');
  if (!settings.apiKey) {
    toast('اول اتصال هوش مصنوعی را در تنظیمات کامل کن', 'err');
    navigate('settings');
    $$('[data-settings-tab]').find(b => b.dataset.settingsTab === 'ai')?.click();
    return;
  }
  setChatBusy(true);
  chatAbort = new AbortController();
  state.chat.push({ role: 'user', content: text, createdAt: now() });
  state.chat = state.chat.slice(-200);
  persistState();
  renderMessages();
  scrollMessagesToEnd(false);

  const box = messagesBox();
  const liveRow = document.createElement('div');
  liveRow.className = 'msg-row assistant';
  liveRow.innerHTML = `<div class="msg assistant streaming"><div class="msg-head"><div class="msg-time">LEXI · LIVE</div></div><div class="msg-content"></div></div>`;
  const liveContent = liveRow.querySelector('.msg-content');
  const typing = document.createElement('div');
  typing.className = 'typing-card';
  typing.innerHTML = '<span class="typing-label">Lexi در حال فکر کردن</span><i></i><i></i><i></i>';
  box.append(typing);
  box.scrollTop = box.scrollHeight;

  let rafPending = false, pendingText = '', liveMounted = false;
  const onDelta = txt => {
    pendingText = txt;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!liveMounted) { typing.remove(); box.append(liveRow); liveMounted = true; }
      const pinned = isPinnedToBottom(box);
      liveContent.textContent = pendingText;
      if (pinned) box.scrollTop = box.scrollHeight;
    });
  };

  const history = state.chat.filter(m => m.role === 'user' || m.role === 'assistant').slice(-24).map(({ role, content }) => ({ role, content }));
  let messages = [{ role: 'system', content: systemPrompt() }, ...history];
  let notes = [], finalText = '', retried = false;

  try {
    let loops = 0;
    while (loops++ < 8) {
      let msg;
      try {
        msg = await requestCompletion(messages, { signal: chatAbort.signal, onDelta });
      } catch (e) {
        if (e.name !== 'AbortError' && !retried && /اتصال برقرار نشد/.test(e.message)) {
          retried = true;
          await new Promise(r => setTimeout(r, 900));
          msg = await requestCompletion(messages, { signal: chatAbort.signal, onDelta });
        } else throw e;
      }
      messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
      if (msg.tool_calls?.length) {
        for (const call of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
          let result;
          try {
            result = executeTool(call.function.name, args);
            notes.push(TOOL_LABELS[call.function.name] || call.function.name);
          } catch (e) { result = { ok: false, error: e.message }; }
          messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
        }
        continue;
      }
      finalText = sanitizeChatText(msg.content || '');
      break;
    }
    typing.remove(); liveRow.remove();
    state.chat.push({ role: 'assistant', content: finalText || 'انجام شد.', toolNote: [...new Set(notes)].join(' · '), createdAt: now() });
    persistState();
    renderMessages();
  } catch (e) {
    typing.remove(); liveRow.remove();
    if (e.name === 'AbortError') {
      const partial = sanitizeChatText(pendingText || '');
      if (partial) state.chat.push({ role: 'assistant', content: partial, toolNote: 'پاسخ متوقف شد', createdAt: now() });
      else state.chat.push({ role: 'system', content: 'پاسخ توسط شما متوقف شد.', createdAt: now() });
      toast('پاسخ متوقف شد');
    } else {
      state.chat.push({ role: 'system', content: 'خطا در اتصال: ' + e.message, createdAt: now() });
      toast(e.message, 'err');
    }
    persistState();
    renderMessages();
  } finally {
    chatAbort = null;
    setChatBusy(false);
    renderAll();
  }
}
async function testConnection() {
  if (!settings.apiKey) return toast('API Key را وارد کن', 'err');
  const b = $('#testConnection');
  b.disabled = true; b.textContent = 'در حال تست…';
  const t0 = now();
  try {
    const res = await fetch(endpoint(), { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 8 }) });
    if (!res.ok) throw new Error(friendlyHttpError(res.status, await res.text().catch(() => '')));
    await res.json();
    toast(`اتصال برقرار شد ✓ (${fa(now() - t0)}ms)`);
  } catch (e) {
    toast('اتصال ناموفق: ' + e.message, 'err', 5000);
  } finally {
    b.disabled = false; b.textContent = 'تست اتصال';
  }
}

/* ========================= 12. GITHUB GIST SYNC ========================= */
let sync = safeParse(LS.getItem(SYNC_KEY), null) || { token: '', gistId: '', auto: true, lastPush: 0, lastPull: 0 };
const syncConnected = () => !!(sync.token && sync.gistId);
function saveSyncLocal() { try { LS.setItem(SYNC_KEY, JSON.stringify(sync)); } catch {} }
const SYNC_FILE = 'lexora-sync.json';
const deviceName = (() => {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  return os + (isMobile() ? ' · Mobile' : ' · Desktop');
})();
async function ghFetch(path, opts = {}, { keepalive = false } = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...opts, keepalive,
    headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + sync.token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) }
  });
  if (res.status === 401) throw new Error('توکن گیت‌هاب نامعتبر یا منقضی است');
  if (res.status === 403 || res.status === 429) throw new Error('محدودیت GitHub API؛ چند دقیقه بعد دوباره تلاش کن');
  if (res.status === 404) throw new Error('Gist همگام‌سازی پیدا نشد');
  if (!res.ok) throw new Error('GitHub HTTP ' + res.status);
  return res;
}
function syncPayload() {
  const cleanSettings = { ...settings };
  delete cleanSettings.voiceURI;
  if (!settings.remember) delete cleanSettings.apiKey;
  const st = { ...state };
  st.chat = settings.chatMemory === false ? [] : (st.chat || []).slice(-120);
  st.logs = (st.logs || []).slice(0, 30);
  return { app: 'Lexora', schema: 2, updatedAt: now(), device: deviceName, state: st, settings: cleanSettings };
}
async function fetchRemote() {
  const res = await ghFetch('/gists/' + sync.gistId);
  const gist = await res.json();
  const f = gist.files?.[SYNC_FILE];
  if (!f) return null;
  let content = f.content;
  if (f.truncated && f.raw_url) {
    const raw = await fetch(f.raw_url);
    content = await raw.text();
  }
  return safeParse(content, null);
}
function mergeRemote(remote) {
  if (!remote || typeof remote !== 'object' || !remote.state) return false;
  const rState = remote.state || {}, rSettings = remote.settings || {};
  /* tombstones */
  const tomb = new Map();
  [...asList(state.deleted), ...asList(rState.deleted)].forEach(t => {
    if (!t || !t.id) return;
    const prev = tomb.get(t.id);
    if (!prev || (t.at || 0) > (prev.at || 0)) tomb.set(t.id, t);
  });
  /* cards: per-card newest wins, tombstone-aware, then word-level dedupe */
  const byId = new Map();
  const put = c => {
    if (!c) return;
    const t = tomb.get(c.id);
    if (t && (t.at || 0) >= (c.updatedAt || c.createdAt || 0)) return;
    const prev = byId.get(c.id);
    if (!prev || (c.updatedAt || 0) > (prev.updatedAt || 0)) byId.set(c.id, c);
  };
  state.cards.forEach(put);
  asList(rState.cards).map(normalizeCard).filter(Boolean).forEach(put);
  const seenWord = new Set(), merged = [];
  [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach(c => {
    const w = c.word.toLowerCase();
    if (seenWord.has(w)) return;
    seenWord.add(w);
    merged.push(c);
  });
  merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  state.cards = merged;
  state.deleted = [...tomb.values()].filter(t => now() - (t.at || 0) < 90 * 86400000).slice(-300);
  /* scalars */
  const localStudy = new Date(state.lastStudy || 0).getTime() || 0;
  const remoteStudy = new Date(rState.lastStudy || 0).getTime() || 0;
  state.xp = Math.max(Number(state.xp) || 0, Number(rState.xp) || 0);
  state.bestStreak = Math.max(Number(state.bestStreak) || 0, Number(rState.bestStreak) || 0);
  if (remoteStudy > localStudy) { state.streak = Number(rState.streak) || state.streak; state.lastStudy = rState.lastStudy; }
  if (rState.reviewDate === state.reviewDate) state.reviewsToday = Math.max(state.reviewsToday, Number(rState.reviewsToday) || 0);
  else if (String(rState.reviewDate || '') > String(state.reviewDate || '')) { state.reviewsToday = Number(rState.reviewsToday) || 0; state.reviewDate = rState.reviewDate; }
  /* chat: whole-array latest-wins */
  const lastTs = arr => { const a = asList(arr); return a.length ? (a[a.length - 1].createdAt || 0) : 0; };
  if (lastTs(rState.chat) > lastTs(state.chat)) state.chat = asList(rState.chat).filter(m => m && typeof m.content === 'string').slice(-200);
  /* mistakes union */
  const mm = new Map();
  [...asList(state.mistakes), ...asList(rState.mistakes)].forEach(m => {
    if (!m || !m.id) return;
    const p = mm.get(m.id);
    if (!p || (m.lastAt || 0) > (p.lastAt || 0)) mm.set(m.id, m);
  });
  state.mistakes = [...mm.values()].sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)).slice(0, 40);
  /* logs union */
  const lm = new Map();
  [...asList(rState.logs), ...asList(state.logs)].forEach(l => { if (l && l.time) lm.set(l.time + '|' + (l.action || ''), l); });
  state.logs = [...lm.values()].sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 30);
  /* settings LWW (device-local keys preserved) */
  if ((rSettings.updatedAt || 0) > (settings.updatedAt || 0)) {
    const keepLocal = { remember: settings.remember, voiceURI: settings.voiceURI };
    const incoming = { ...rSettings };
    delete incoming.voiceURI;
    if (!incoming.apiKey) delete incoming.apiKey;
    settings = { ...settings, ...incoming, ...keepLocal };
  }
  return true;
}
function setSyncUi(status, detail = '') {
  const dot = $('#syncDot'), txt = $('#syncStatusText'), time = $('#syncLastTime'), top = $('#topSync');
  const states = {
    off: ['متصل نیست', 'برای شروع، توکن گیت‌هاب را وارد کن'],
    ok: ['همگام است ✓', (sync.lastPush || sync.lastPull) ? 'آخرین همگام‌سازی: ' + timeAgo(Math.max(sync.lastPush, sync.lastPull)) : ''],
    busy: ['در حال همگام‌سازی…', ''],
    err: ['خطا در همگام‌سازی', detail]
  };
  const [t, d] = states[status] || states.off;
  if (dot) dot.className = 'sync-dot' + (status === 'off' ? '' : ' ' + status);
  if (txt) txt.textContent = t;
  if (time) time.textContent = d || (status === 'ok' ? 'تغییرات به‌صورت خودکار ارسال می‌شوند' : d);
  if (top) top.className = 'icon-btn sync-chip ' + (syncConnected() ? status : 'off');
  const set = (id, v, ok) => { const e = $(id); if (e) { e.textContent = v; e.className = ok === undefined ? '' : ok ? 'ok' : 'warn'; } };
  set('#syncCheckConn', syncConnected() ? 'متصل' : 'قطع', syncConnected());
  set('#syncCheckPush', sync.lastPush ? timeAgo(sync.lastPush) : '—', !!sync.lastPush);
  set('#syncCheckPull', sync.lastPull ? timeAgo(sync.lastPull) : '—', !!sync.lastPull);
}
function updateSyncUi() {
  const connected = syncConnected();
  $('#syncConnectForm')?.classList.toggle('hide', connected);
  $('#syncManage')?.classList.toggle('hide', !connected);
  $('#syncNow')?.classList.toggle('hide', !connected);
  $('#syncAutoToggle')?.classList.toggle('on', sync.auto !== false);
  setSyncUi(connected ? 'ok' : 'off');
}
let pushTimer = null, pushing = false;
function scheduleSyncPush() {
  if (!syncConnected() || sync.auto === false) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushSync(), 4000);
}
async function pushSync({ keepalive = false, silent = true } = {}) {
  if (!syncConnected() || pushing) return false;
  pushing = true;
  setSyncUi('busy');
  try {
    const content = JSON.stringify(syncPayload());
    await ghFetch('/gists/' + sync.gistId, { method: 'PATCH', body: JSON.stringify({ files: { [SYNC_FILE]: { content } } }) }, { keepalive });
    sync.lastPush = now(); syncDirty = false;
    saveSyncLocal(); setSyncUi('ok');
    if (!silent) toast('همگام‌سازی انجام شد ✓');
    return true;
  } catch (e) {
    setSyncUi('err', e.message);
    if (!silent) toast('ارسال ناموفق: ' + e.message, 'err');
    return false;
  } finally { pushing = false; }
}
async function pullSync({ silent = true } = {}) {
  if (!syncConnected()) return false;
  setSyncUi('busy');
  try {
    const remote = await fetchRemote();
    if (remote && mergeRemote(remote)) {
      persistState();
      try { settings.updatedAt = Math.max(settings.updatedAt || 0, remote.settings?.updatedAt || 0); const store = settings.remember ? LS : SS; store.setItem(SETTINGS, JSON.stringify(settings)); } catch {}
      fillAllSettings();
      renderAll();
      renderMessages();
    }
    sync.lastPull = now();
    saveSyncLocal(); setSyncUi('ok');
    if (!silent) toast('دریافت از فضای ابری انجام شد ✓');
    return true;
  } catch (e) {
    setSyncUi('err', e.message);
    if (!silent) toast('دریافت ناموفق: ' + e.message, 'err');
    return false;
  }
}
async function connectSync(token) {
  token = String(token || '').trim();
  if (!token) throw new Error('توکن را وارد کن');
  sync.token = token;
  setSyncUi('busy');
  const res = await ghFetch('/gists?per_page=100');
  const gists = await res.json();
  const existing = Array.isArray(gists) ? gists.find(x => x.files && x.files[SYNC_FILE]) : null;
  if (existing) {
    sync.gistId = existing.id;
    saveSyncLocal();
    await pullSync({ silent: true });
    await pushSync({ silent: true });
  } else {
    const created = await ghFetch('/gists', { method: 'POST', body: JSON.stringify({ description: 'Lexora sync data (private)', public: false, files: { [SYNC_FILE]: { content: JSON.stringify(syncPayload()) } } }) });
    const g = await created.json();
    sync.gistId = g.id;
    sync.lastPush = now();
    saveSyncLocal();
  }
  sync.auto = sync.auto !== false;
  saveSyncLocal();
  updateSyncUi();
}
function pairLink() {
  const code = btoa(unescape(encodeURIComponent(JSON.stringify({ t: sync.token, g: sync.gistId })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return location.origin + location.pathname + '#pair=' + code;
}
function tryHandlePairLink() {
  const m = location.hash.match(/#pair=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try {
    const pad = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(decodeURIComponent(escape(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))));
    if (data.t && data.g) {
      sync.token = data.t;
      sync.gistId = data.g;
      sync.auto = true;
      saveSyncLocal();
      history.replaceState(null, '', location.pathname + location.search);
      toast('این دستگاه متصل شد؛ در حال دریافت داده‌ها…');
      pullSync({ silent: false }).then(() => updateSyncUi());
      return true;
    }
  } catch { toast('لینک اتصال معتبر نیست', 'err'); }
  history.replaceState(null, '', location.pathname + location.search);
  return false;
}

/* ========================= 13. SETTINGS UI ========================= */
const PROVIDER_PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  avalai: { baseUrl: 'https://api.avalai.ir/v1', model: 'gpt-4o-mini' },
  gapgpt: { baseUrl: 'https://api.gapgpt.app/v1', model: 'gpt-4o-mini' }
};
function markActivePreset() {
  const url = ($('#baseUrl')?.value || '').trim().replace(/\/+$/, '');
  $$('#providerPresets button').forEach(b => b.classList.toggle('active', PROVIDER_PRESETS[b.dataset.preset]?.baseUrl === url));
}
function initTabs(buttonSel, paneAttr, key) {
  $$(buttonSel).forEach(b => b.addEventListener('click', () => {
    $$(buttonSel).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll(`[${paneAttr}]`).forEach(x => x.classList.toggle('active', x.getAttribute(paneAttr) === b.dataset[key]));
  }));
}
function collectSettings(ids) {
  const out = {};
  ids.forEach(id => {
    const e = $('#' + id);
    if (e) out[id] = e.type === 'checkbox' ? e.checked : e.type === 'range' ? Number(e.value) : e.value;
  });
  return out;
}
function mergeSave(data) {
  Object.assign(settings, data || {});
  saveSettingsData();
  applyExperience();
  renderProfileCards();
  renderHealth();
  renderAll();
}
function renderProfileCards() {
  const s = settings, fields = ['userName', 'level', 'goal', 'targetDate', 'interests', 'contexts', 'dailyMinutes', 'correctionStyle'];
  const score = Math.round(fields.filter(k => String(s[k] || '').trim()).length / fields.length * 100);
  if ($('#profileScore')) $('#profileScore').textContent = score + '%';
  if ($('#profileScoreRing')) $('#profileScoreRing').style.setProperty('--p', score * 3.6 + 'deg');
  if ($('#profileGoalBadge')) $('#profileGoalBadge').textContent = s.goal || 'مسیر شخصی';
  if ($('#profileAvatarDisplay')) $('#profileAvatarDisplay').textContent = (s.userName || 'LX').trim().slice(0, 2).toUpperCase();
  if ($('#memoryPreview')) {
    const items = [`هدف: ${s.goal || 'ثبت نشده'}`, `سطح: ${s.level || 'ثبت نشده'}`, `علایق: ${s.interests || 'ثبت نشده'}`, `پیام‌های جلسه: ${fa((state.chat || []).length)}`];
    $('#memoryPreview').innerHTML = items.map(x => `<span>${escapeHtml(x)}</span>`).join('');
  }
}
function renderHealth() {
  const s = settings;
  const checks = [['httpsCheck', String(s.baseUrl || '').startsWith('https://')], ['modelCheck', !!s.model], ['keyCheck', !!s.apiKey]];
  checks.forEach(([id, ok]) => {
    const e = $('#' + id);
    if (e) { e.textContent = ok ? 'آماده' : 'نیاز به تنظیم'; e.className = ok ? 'ok' : 'warn'; }
  });
  const good = checks.every(x => x[1]);
  const chip = $('#systemHealth');
  if (chip) {
    chip.classList.toggle('ok', good);
    chip.querySelector('span').textContent = good ? 'سیستم آماده است' : 'تنظیمات ناقص است';
  }
  try {
    const size = new Blob([LS.getItem(STORAGE) || '', LS.getItem(SETTINGS) || '', SS.getItem(SETTINGS) || '']).size;
    if ($('#storageSize')) $('#storageSize').textContent = (size / 1024).toFixed(1) + ' KB';
    if ($('#storageBar')) $('#storageBar').style.width = Math.min(100, size / 5000000 * 100) + '%';
  } catch {}
}
function applyExperience() {
  const s = settings;
  const systemSoft = s.themeMode === 'system' && matchMedia('(prefers-color-scheme: light)').matches;
  document.body.classList.toggle('theme-soft', s.themeMode === 'soft' || systemSoft);
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
  document.body.classList.toggle('compact', !!s.compactMode);
  $('#chatMemoryToggle')?.classList.toggle('on', s.chatMemory !== false);
  $('#chatMemoryToggle')?.setAttribute('aria-pressed', String(s.chatMemory !== false));
}
function updateSkillLabels() {
  const keys = ['Speaking', 'Listening', 'Reading', 'Writing', 'Vocabulary', 'Grammar'];
  let weak = null;
  keys.forEach(k => {
    const e = $('#skill' + k), v = $('#' + k.toLowerCase() + 'Val');
    if (e && v) {
      v.textContent = e.value;
      if (!weak || +e.value < weak.v) weak = { k, v: +e.value };
    }
  });
  if (weak && $('#skillInsight')) $('#skillInsight').textContent = `اولویت پیشنهادی این هفته: ${({ Speaking: 'مکالمه', Listening: 'شنیدار', Reading: 'خواندن', Writing: 'نوشتن', Vocabulary: 'واژگان', Grammar: 'گرامر' })[weak.k]} · تمرین‌های ایجنت روی این مهارت متمرکز می‌شوند.`;
}
function fillAllSettings() {
  const set = (id, v) => { const e = $('#' + id); if (e) e.value = v ?? ''; };
  set('baseUrl', settings.baseUrl);
  set('apiKey', settings.apiKey);
  set('modelName', settings.model);
  const values = { userName: '', userAge: '', level: 'B1 — متوسط', goal: 'مکالمه روزمره', nativeLanguage: 'fa', targetDate: '', dailyMinutes: '20', interests: '', contexts: '', targetAccent: 'en-US', correctionStyle: 'balanced', explanationDepth: 'normal', toolApproval: 'destructive', agentInitiative: '2', speechRate: .85, speechAccent: 'en-US', themeMode: 'dark', dailyGoal: 10 };
  Object.entries(values).forEach(([id, d]) => { const e = $('#' + id); if (e) e.value = settings[id] ?? d; });
  ['autoRecap', 'retrievalFirst', 'englishFirst', 'autoCards', 'reduceMotion', 'compactMode'].forEach(id => {
    const e = $('#' + id);
    if (e) e.checked = settings[id] ?? (['autoRecap', 'retrievalFirst'].includes(id));
  });
  const da = $('#dictAudio');
  if (da) da.checked = settings.dictAudio !== false;
  const skills = settings.skills || { speaking: 50, listening: 50, reading: 50, writing: 50, vocabulary: 50, grammar: 50 };
  Object.entries(skills).forEach(([k, v]) => { const e = $('#skill' + k[0].toUpperCase() + k.slice(1)); if (e) e.value = v; });
  if ($('#dailyGoalVal')) $('#dailyGoalVal').textContent = settings.dailyGoal || 10;
  if ($('#speechRateVal')) $('#speechRateVal').textContent = Number(settings.speechRate || .85).toFixed(2) + '×';
  $('#rememberToggle')?.classList.toggle('on', !!settings.remember);
  $('#correctionToggle')?.classList.toggle('on', settings.correction !== false);
  $('#toolsToggle')?.classList.toggle('on', settings.tools !== false);
  populateVoicePicker();
  markActivePreset();
  applyExperience();
  renderProfileCards();
  renderHealth();
  updateSkillLabels();
  updateSyncUi();
}
function readConnection() {
  settings.baseUrl = $('#baseUrl').value.trim();
  settings.apiKey = $('#apiKey').value.trim();
  settings.model = $('#modelName').value.trim();
  if (!settings.baseUrl || !settings.model) throw new Error('Base URL و نام مدل لازم است');
}

/* ========================= 14. IMPORT / EXPORT / BACKUP ========================= */
function prepareBackup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.state || typeof raw.state !== 'object' || Array.isArray(raw.state) || !Array.isArray(raw.state.cards) || !raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings)) throw Error('ساختار فایل پشتیبان معتبر نیست');
  if (raw.state.cards.some(card => !normalizeCard(card))) throw Error('یک یا چند کارت در فایل پشتیبان معتبر نیست');
  return { state: normalizeState(raw.state, { cards: [], reviewsToday: 0, xp: 0, streak: 0, bestStreak: 0, lastStudy: new Date().toDateString(), logs: [], chat: [], mistakes: [], deleted: [] }), settings: raw.settings };
}
function restoreBackup(raw) {
  const backup = prepareBackup(raw);
  const previousState = LS.getItem(STORAGE), previousSettings = LS.getItem(SETTINGS);
  try {
    LS.setItem(STORAGE, JSON.stringify(backup.state));
    LS.setItem(SETTINGS, JSON.stringify(backup.settings));
    SS.removeItem(SETTINGS);
  } catch {
    if (previousState === null) LS.removeItem(STORAGE); else LS.setItem(STORAGE, previousState);
    if (previousSettings === null) LS.removeItem(SETTINGS); else LS.setItem(SETTINGS, previousSettings);
    throw Error('بازیابی به‌دلیل کمبود فضای ذخیره‌سازی انجام نشد');
  }
}

/* ========================= 15. EVENT WIRING ========================= */
$$('[data-page]').forEach(b => b.onclick = () => navigate(b.dataset.page));
$$('[data-go]').forEach(b => b.onclick = () => navigate(b.dataset.go));
$$('[data-prompt]').forEach(b => b.onclick = () => { navigate('agent'); setTimeout(() => sendChat(b.dataset.prompt), 100); });
initTabs('[data-profile-tab]', 'data-profile-pane', 'profileTab');
initTabs('[data-settings-tab]', 'data-settings-pane', 'settingsTab');

/* modal & drawer */
$('#quickAdd').onclick = () => openCard();
$$('.close').forEach(b => b.onclick = () => { closeModal(); $('#cardDrawer').classList.remove('show'); });
$('#cardModal').onclick = e => { if (e.target === $('#cardModal')) closeModal(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); $('#cardDrawer').classList.remove('show'); }
});
$('#cardForm').onsubmit = e => {
  e.preventDefault();
  const id = $('#editId').value;
  const args = {
    word: $('#fWord').value.trim(),
    meaning: $('#fMeaning').value.trim(),
    phonetic: $('#fPhonetic').value.trim(),
    example: $('#fExample').value.trim(),
    tags: $('#fTags').value.split(/[،,]/).map(x => x.trim()).filter(Boolean),
    collocations: $('#fCollocations').value.split(',').map(x => x.trim()).filter(Boolean),
    partOfSpeech: $('#fPos').value,
    mnemonic: $('#fMnemonic').value.trim(),
    level: $('#fLevel').value
  };
  if (lastDictFetch.word && lastDictFetch.word === args.word.toLowerCase() && lastDictFetch.audio) args.audio = lastDictFetch.audio;
  try {
    id ? updateCard({ id, ...args }) : addCard(args);
    closeModal();
  } catch (err) { toast(err.message, 'err'); }
};
let lastDictFetch = { word: '', audio: '' };
$('#fetchDictBtn').onclick = async () => {
  const word = $('#fWord').value.trim();
  if (!word) return toast('اول واژه انگلیسی را بنویس', 'err');
  const b = $('#fetchDictBtn');
  b.disabled = true; b.textContent = '…';
  try {
    const d = await Dict.lookup(word);
    if (!d) { toast('در دیکشنری پیدا نشد', 'err'); return; }
    if (d.phonetic && !$('#fPhonetic').value.trim()) $('#fPhonetic').value = d.phonetic;
    if (d.example && !$('#fExample').value.trim()) $('#fExample').value = d.example;
    if (d.partOfSpeech && !$('#fPos').value) $('#fPos').value = d.partOfSpeech;
    lastDictFetch = { word: word.toLowerCase(), audio: d.audio || '' };
    toast(d.audio ? 'تلفظ و اطلاعات دیکشنری دریافت شد ✓ (با صدای انسانی)' : 'اطلاعات دیکشنری دریافت شد ✓');
  } finally { b.disabled = false; b.textContent = '✨ دیکشنری'; }
};

/* deck grid */
$('#deckGrid').onclick = e => {
  const edit = e.target.closest('[data-edit]'), sp = e.target.closest('[data-speak]'),
    star = e.target.closest('[data-star]'), del = e.target.closest('[data-delete]'),
    sel = e.target.closest('[data-select]'), card = e.target.closest('[data-card]');
  if (edit) { e.stopPropagation(); openCard(cardById(edit.dataset.edit)); return; }
  if (sp) { e.stopPropagation(); playCardAudio(cardById(sp.dataset.speak), sp); return; }
  if (star) {
    e.stopPropagation();
    const c = cardById(star.dataset.star);
    if (c) { c.starred = !c.starred; c.updatedAt = now(); save(); }
    return;
  }
  if (del) { e.stopPropagation(); deleteCards([del.dataset.delete]); return; }
  if (sel) { sel.checked ? selectedCards.add(sel.dataset.select) : selectedCards.delete(sel.dataset.select); updateBulkBar(); return; }
  if (card) openDrawer(card.dataset.card);
};
let searchTimer = null;
$('#cardSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderCards, 140); };
$('#cardFilter').onchange = renderCards;
$$('[data-smart]').forEach(b => b.onclick = () => {
  $$('[data-smart]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  smartFilter = b.dataset.smart;
  renderCards();
});
$$('[data-view]').forEach(b => b.onclick = () => {
  $$('[data-view]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $('#deckGrid').classList.toggle('list-view', b.dataset.view === 'list');
});
$('#bulkDelete').onclick = () => { if (confirm('کارت‌های انتخاب‌شده حذف شوند؟')) deleteCards([...selectedCards]); };
$('#bulkStar').onclick = () => {
  state.cards.filter(c => selectedCards.has(c.id)).forEach(c => { c.starred = true; c.updatedAt = now(); });
  selectedCards.clear();
  save();
};
$('#bulkSuspend').onclick = () => {
  state.cards.filter(c => selectedCards.has(c.id)).forEach(c => { c.suspended = !c.suspended; c.updatedAt = now(); });
  selectedCards.clear();
  save();
};
$('#modalDelete').onclick = () => {
  const id = $('#editId').value;
  if (id && confirm('این کارت حذف شود؟')) { closeModal(); deleteCards([id]); }
};
$('#closeDrawer').onclick = () => $('#cardDrawer').classList.remove('show');
$('#cardDrawer').onclick = e => { if (e.target === $('#cardDrawer')) $('#cardDrawer').classList.remove('show'); };
$('#drawerSpeak').onclick = e => { const c = cardById(activeCardId); if (c) playCardAudio(c, e.currentTarget); };
$('#drawerEdit').onclick = () => { const c = cardById(activeCardId); $('#cardDrawer').classList.remove('show'); openCard(c); };
$('#drawerDelete').onclick = () => { if (confirm('این کارت حذف شود؟')) { $('#cardDrawer').classList.remove('show'); deleteCards([activeCardId]); } };
$('#drawerPractice').onclick = () => {
  const c = cardById(activeCardId);
  $('#cardDrawer').classList.remove('show');
  navigate('agent');
  if (c) setTimeout(() => sendChat(`با کلمه ${c.word} یک تمرین کوتاه و کاربردی برای من طراحی کن.`), 100);
};

/* review */
const currentReviewCard = () => reviewQueue[reviewIndex] || null;
$('#reviewCard').onclick = e => {
  if (e.target.closest('button,input') || reviewMode === 'choice' || reviewMode === 'type') return;
  if (!currentReviewCard()) return;
  revealReview();
};
$$('[data-rate]').forEach(b => b.onclick = () => rateCard(b.dataset.rate));
$$('[data-mode]').forEach(b => b.onclick = () => {
  $$('[data-mode]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  reviewMode = b.dataset.mode;
  renderReview();
});
$('#speakFront').onclick = e => { e.stopPropagation(); const c = currentReviewCard(); if (c) playCardAudio(c, e.currentTarget); };
$('#speakReview').onclick = e => { e.stopPropagation(); const c = currentReviewCard(); if (c) playCardAudio(c, e.currentTarget); };
$('#checkAnswer').onclick = () => {
  const c = currentReviewCard();
  if (!c) return;
  const a = normalizePersian($('#typedAnswer').value), correct = normalizePersian(c.meaning);
  const ok = a && correct.split(/[،,]/).some(x => {
    const t = normalizePersian(x.trim());
    if (!t || !a) return false;
    if (a === t) return true;
    if (a.length >= 2 && t.length >= 2) {
      const tWords = t.split(/\s+/);
      if (tWords.includes(a)) return true;
      if (a.length >= Math.max(2, t.length * 0.6) && t.includes(a)) return true;
    }
    return false;
  });
  $('#answerFeedback').textContent = ok ? 'عالی! پاسخ نزدیک و درست بود ✓' : 'پاسخ پیشنهادی: ' + c.meaning;
  $('#answerFeedback').style.color = ok ? 'var(--green)' : 'var(--orange)';
  $('#answerFeedback').classList.remove('hide');
  setTimeout(revealReview, 450);
};
$('#typedAnswer').onkeydown = e => { if (e.key === 'Enter') $('#checkAnswer').click(); };
$('#choiceGrid').onclick = e => {
  const b = e.target.closest('[data-choice]');
  if (!b) return;
  const c = currentReviewCard();
  if (!c) return;
  const ok = b.dataset.choice === c.meaning;
  $$('.choice', $('#choiceGrid')).forEach(x => x.disabled = true);
  b.classList.add(ok ? 'correct' : 'wrong');
  if (!ok) $$('.choice', $('#choiceGrid')).find(x => x.dataset.choice === c.meaning)?.classList.add('correct');
  setTimeout(revealReview, 650);
};
document.addEventListener('keydown', e => {
  if (!$('#page-review').classList.contains('active') || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); $('#reviewCard').click(); }
  if (e.key.toLowerCase() === 'p') { e.preventDefault(); const c = currentReviewCard(); if (c) playCardAudio(c, $('#speakFront')); }
  if (!$('#rating').classList.contains('hide')) {
    const map = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
    if (map[e.key]) { e.preventDefault(); rateCard(map[e.key]); }
  }
});

/* quick recall */
$('#quickReveal').onclick = () => { quickRevealed = true; renderQuickRecall(); };
$('#quickAgain').onclick = () => gradeQuick(false);
$('#quickKnow').onclick = () => gradeQuick(true);
$('#quickSpeak').onclick = () => { const c = getQuickCard(); if (c) playCardAudio(c, $('#quickSpeak')); };

/* chat */
$('#messages').onclick = e => {
  const starter = e.target.closest('[data-starter]');
  if (starter) { sendChat(starter.dataset.starter); return; }
  const copy = e.target.closest('[data-copy-msg]');
  if (copy) { const m = state.chat[Number(copy.dataset.copyMsg)]; if (m) copyChatText(m.content); return; }
  const spk = e.target.closest('[data-speak-msg]');
  if (spk) { const m = state.chat[Number(spk.dataset.speakMsg)]; if (m) speakEnglishParts(m.content, spk); }
};
$('#messages').addEventListener('scroll', updateScrollDown, { passive: true });
$('#scrollDown').onclick = () => scrollMessagesToEnd(true);
$('#newChat').onclick = () => {
  if (!state.chat.length || confirm('گفت‌وگوی تازه شروع شود؟ تاریخچه فعلی پاک می‌شود.')) {
    state.chat = [];
    persistState();
    renderMessages();
    if (finePointer()) $('#chatInput').focus();
  }
};
const resizeChatInput = () => {
  const x = $('#chatInput');
  x.style.height = 'auto';
  const h = Math.min(150, Math.max(42, x.scrollHeight));
  x.style.height = h + 'px';
  x.style.overflowY = x.scrollHeight > 150 ? 'auto' : 'hidden';
};
$('#chatInput').oninput = resizeChatInput;
$('#sendBtn').onclick = () => {
  if (chatBusy) return;
  const x = $('#chatInput'), t = x.value.trim();
  if (!t) return;
  x.value = '';
  resizeChatInput();
  sendChat(t);
};
$('#stopBtn').onclick = () => { chatAbort?.abort(); };
$('#chatInput').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#sendBtn').click(); }
};
$$('.chip').forEach(b => b.onclick = () => sendChat(b.textContent.trim()));
$$('[data-agent-mode]').forEach(b => b.onclick = () => {
  $$('[data-agent-mode]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  agentMode = b.dataset.agentMode;
  const prompts = {
    coach: 'امروز بر اساس نقاط ضعفم چه تمرینی انجام بدهیم؟',
    conversation: 'یک موقعیت واقعی انتخاب کن و مکالمه را شروع کن.',
    grammar: 'سه سؤال بپرس تا ضعف گرامری من را پیدا کنی.',
    ielts: 'یک آزمون کوتاه IELTS Speaking شروع کن.',
    interview: 'مصاحبه کاری انگلیسی را شروع کن.',
    vocab: 'از واژه‌های ضعیفم یک تمرین تولیدی بساز.'
  };
  $('#chatInput').placeholder = prompts[agentMode];
});
$('#drillMistakes').onclick = () => {
  navigate('agent');
  setTimeout(() => sendChat('از روی دفتر خطاهای من (با ابزار get_mistakes بخوان) یک تمرین هدفمند بساز؛ روی هر خطا یک سؤال، تا وقتی درست جواب بدهم.'), 100);
};
$('#micBtn').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('گفتار به متن در این مرورگر فعال نیست', 'err');
  const btn = $('#micBtn');
  if (btn.dataset.active === '1') { btn.dataset.rec?.stop?.(); return; }
  const r = new SR();
  r.lang = settings.speechAccent || 'en-US';
  r.interimResults = false;
  btn.dataset.active = '1';
  btn.classList.add('listening');
  btn.textContent = '●';
  r.onresult = e => {
    const t = e.results[0][0].transcript;
    const x = $('#chatInput');
    x.value = (x.value ? x.value + ' ' : '') + t;
    resizeChatInput();
  };
  r.onerror = e => toast('تشخیص صدا ناموفق بود: ' + (e.error === 'not-allowed' ? 'دسترسی میکروفن داده نشد' : e.error || 'خطای ناشناخته'), 'err');
  r.onend = () => { btn.dataset.active = ''; btn.classList.remove('listening'); btn.textContent = '◉'; };
  try { r.start(); } catch { btn.dataset.active = ''; btn.classList.remove('listening'); btn.textContent = '◉'; toast('میکروفن در دسترس نیست', 'err'); }
};

/* profile & settings save buttons */
$$('.skill-map input').forEach(x => x.addEventListener('input', updateSkillLabels));
$('#dailyGoal')?.addEventListener('input', e => $('#dailyGoalVal').textContent = e.target.value);
$('#speechRate')?.addEventListener('input', e => $('#speechRateVal').textContent = Number(e.target.value).toFixed(2) + '×');
$('#saveProfileBtn')?.addEventListener('click', () => { mergeSave({ userName: $('#userName').value.trim(), userAge: $('#userAge').value, level: $('#level').value, nativeLanguage: $('#nativeLanguage').value }); toast('هویت یادگیری ذخیره شد ✓'); });
$('#saveLearningGoalBtn')?.addEventListener('click', () => { mergeSave({ goal: $('#goal').value, targetDate: $('#targetDate').value, dailyGoal: Number($('#dailyGoal').value) || 10, dailyMinutes: $('#dailyMinutes').value, interests: $('#interests').value, contexts: $('#contexts').value, targetAccent: $('#targetAccent').value }); toast('مسیر شخصی ساخته شد ✓'); });
$('#saveSkills')?.addEventListener('click', () => {
  const skills = {};
  ['Speaking', 'Listening', 'Reading', 'Writing', 'Vocabulary', 'Grammar'].forEach(k => skills[k.toLowerCase()] = Number($('#skill' + k).value));
  mergeSave({ skills });
  toast('نقشه مهارت‌ها ذخیره شد ✓');
});
$('#savePreferences')?.addEventListener('click', () => { mergeSave({ correctionStyle: $('#correctionStyle').value, explanationDepth: $('#explanationDepth').value, correction: $('#correctionToggle').classList.contains('on') }); toast('سبک یادگیری ذخیره شد ✓'); });
$('#saveSystemSettingsBtn')?.addEventListener('click', () => { mergeSave({ tools: $('#toolsToggle').classList.contains('on'), toolApproval: $('#toolApproval').value, agentInitiative: $('#agentInitiative').value, autoRecap: $('#autoRecap').checked, retrievalFirst: $('#retrievalFirst').checked, englishFirst: $('#englishFirst').checked, autoCards: $('#autoCards').checked }); toast('تنظیمات ایجنت ذخیره شد ✓'); });
$('#saveExperience')?.addEventListener('click', () => { mergeSave({ speechRate: Number($('#speechRate').value), speechAccent: $('#speechAccent').value, themeMode: $('#themeMode').value, reduceMotion: $('#reduceMotion').checked, compactMode: $('#compactMode').checked, dictAudio: $('#dictAudio').checked }); toast('تجربه کاربری اعمال شد ✓'); });
$('#voiceSelect')?.addEventListener('change', e => { settings.voiceURI = e.target.value; saveSettingsData(); });
$('#showKey').onclick = () => { const i = $('#apiKey'); i.type = i.type === 'password' ? 'text' : 'password'; $('#showKey').textContent = i.type === 'password' ? 'نمایش' : 'مخفی'; };
$('#rememberToggle').onclick = e => e.currentTarget.classList.toggle('on');
$('#correctionToggle').onclick = e => e.currentTarget.classList.toggle('on');
$('#toolsToggle').onclick = e => e.currentTarget.classList.toggle('on');
$('#saveSettings').onclick = () => {
  try {
    readConnection();
    settings.remember = $('#rememberToggle').classList.contains('on');
    saveSettingsData();
    renderHealth();
    markActivePreset();
    toast('تنظیمات اتصال ذخیره شد ✓');
  } catch (e) { toast(e.message, 'err'); }
};
$('#testConnection').onclick = () => { try { readConnection(); testConnection(); } catch (e) { toast(e.message, 'err'); } };
$$('#providerPresets button').forEach(b => b.onclick = () => {
  const p = PROVIDER_PRESETS[b.dataset.preset];
  if (!p) return;
  $('#baseUrl').value = p.baseUrl;
  if (!$('#modelName').value.trim() || Object.values(PROVIDER_PRESETS).some(x => x.model === $('#modelName').value.trim())) $('#modelName').value = p.model;
  markActivePreset();
  toast('فیلدها پر شدند؛ کلید خودت را بگذار و «ذخیره اتصال» را بزن');
});
$('#baseUrl')?.addEventListener('input', markActivePreset);
$('#startDiagnostic')?.addEventListener('click', () => { navigate('agent'); setTimeout(() => sendChat('یک ارزیابی تطبیقی ۷ دقیقه‌ای از سطح انگلیسی من شروع کن. هر بار فقط یک سؤال بپرس، مکالمه، واژگان و گرامر را بسنج و در پایان سطح CEFR و سه اولویت تمرینی بده.'), 100); });
$('#launchMission')?.addEventListener('click', () => {
  const skills = settings.skills || {};
  const weak = Object.entries(skills).sort((a, b) => a[1] - b[1])[0]?.[0] || 'speaking';
  navigate('agent');
  setTimeout(() => sendChat(`یک مأموریت ۱۲ دقیقه‌ای مرحله‌به‌مرحله برای ${weak} و هدف «${settings.goal || 'مکالمه روزمره'}» شروع کن. پیشرفت را در سه مرحله گرم‌کردن، تولید و بازخورد مدیریت کن.`), 100);
});
$('#sessionRecap')?.addEventListener('click', () => { navigate('agent'); setTimeout(() => sendChat('جلسه فعلی را جمع‌بندی کن: ۳ پیشرفت، ۳ خطای مهم (با log_mistake ثبتشان کن)، ۵ واژه فعال و برنامه جلسه بعد. برای واژه‌های ارزشمند با اجازه من فلش‌کارت بساز.'), 100); });
$('#clearLearningMemory')?.addEventListener('click', () => {
  if (!confirm('تاریخچه گفت‌وگو پاک شود؟')) return;
  state.chat = [];
  persistState();
  renderMessages();
  renderProfileCards();
  toast('حافظه مکالمه پاک شد');
});
$('#testVoice')?.addEventListener('click', e => {
  settings.speechRate = Number($('#speechRate').value) || settings.speechRate;
  settings.speechAccent = $('#speechAccent').value || settings.speechAccent;
  settings.voiceURI = $('#voiceSelect')?.value ?? settings.voiceURI;
  TTS.speak('Small steps, repeated consistently, create remarkable progress.', e.currentTarget);
});
$('#themeBtn').onclick = () => {
  document.body.classList.toggle('theme-soft');
  settings.themeMode = document.body.classList.contains('theme-soft') ? 'soft' : 'dark';
  saveSettingsData();
  const tm = $('#themeMode');
  if (tm) tm.value = settings.themeMode;
  toast(settings.themeMode === 'soft' ? 'حالت نرم فعال شد' : 'حالت تیره فعال شد');
};
$('#chatMemoryToggle')?.addEventListener('click', e => {
  const on = !e.currentTarget.classList.contains('on');
  e.currentTarget.classList.toggle('on', on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
  settings.chatMemory = on;
  saveSettingsData();
  if (!on) { state.chat = []; persistState(); renderMessages(); }
  renderProfileCards();
});
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (settings.themeMode === 'system') applyExperience(); });

/* import / export */
$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), cards: state.cards }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lexora-flashcards.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('فایل خروجی آماده شد');
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  try {
    if (!e.target.files?.[0]) return;
    const d = JSON.parse(await e.target.files[0].text());
    const cards = Array.isArray(d) ? d : d.cards;
    if (!Array.isArray(cards)) throw new Error();
    const validCards = cards.filter(c => c && typeof c === 'object' && String(c.word || '').trim() && String(c.meaning || '').trim());
    validCards.forEach(raw => {
      const c = { ...raw, word: String(raw.word).trim(), meaning: String(raw.meaning).trim() };
      const ex = state.cards.find(x => String(x.word || '').toLowerCase() === c.word.toLowerCase());
      if (ex) {
        const keepId = ex.id;
        Object.assign(ex, c, { id: keepId, tags: Array.isArray(c.tags) ? c.tags : [], collocations: Array.isArray(c.collocations) ? c.collocations : [], updatedAt: now() });
      } else {
        state.cards.push(normalizeCard({ ...c, id: c.id || uid(), createdAt: Number(c.createdAt) || now(), updatedAt: now(), due: Number(c.due) || now() }));
      }
    });
    logAction('ورود اطلاعات', validCards.length + ' کارت');
    save();
    toast(fa(validCards.length) + ' کارت معتبر وارد شد');
  } catch {
    toast('فایل JSON معتبر نیست', 'err');
  } finally { e.target.value = ''; }
};
$('#exportAll')?.addEventListener('click', () => {
  const data = { app: 'Lexora', version: 5, exportedAt: new Date().toISOString(), state, settings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lexora-complete-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('نسخه پشتیبان کامل آماده شد');
});
$('#importAllBtn')?.addEventListener('click', () => $('#importAllFile').click());
$('#importAllFile')?.addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    restoreBackup(JSON.parse(await f.text()));
    toast('نسخه پشتیبان بازیابی شد');
    setTimeout(() => location.reload(), 650);
  } catch (err) {
    toast(err.message || 'فایل پشتیبان معتبر نیست', 'err');
  } finally { e.target.value = ''; }
});
$('#resetApp').onclick = () => {
  if (confirm('همه داده‌ها، تنظیمات و اتصال همگام‌سازی این دستگاه پاک شوند؟ این کار برگشت‌پذیر نیست.')) {
    LS.removeItem(STORAGE);
    LS.removeItem(SETTINGS);
    LS.removeItem(SYNC_KEY);
    SS.removeItem(SETTINGS);
    location.reload();
  }
};

/* sync UI */
$('#showSyncToken').onclick = () => { const i = $('#syncToken'); i.type = i.type === 'password' ? 'text' : 'password'; $('#showSyncToken').textContent = i.type === 'password' ? 'نمایش' : 'مخفی'; };
$('#syncConnect').onclick = async () => {
  const b = $('#syncConnect');
  b.disabled = true; b.textContent = 'در حال اتصال…';
  try {
    await connectSync($('#syncToken').value);
    $('#syncToken').value = '';
    toast('همگام‌سازی فعال شد ✓ حالا در دستگاه دوم «لینک اتصال» را باز کن');
  } catch (e) {
    setSyncUi('err', e.message);
    toast(e.message, 'err', 5000);
  } finally {
    b.disabled = false; b.textContent = 'اتصال و فعال‌سازی سینک';
    updateSyncUi();
  }
};
$('#syncNow').onclick = async () => {
  const ok1 = await pullSync({ silent: true });
  const ok2 = await pushSync({ silent: true });
  if (ok1 && ok2) toast('همگام‌سازی کامل انجام شد ✓');
};
$('#syncDisconnect').onclick = () => {
  if (!confirm('اتصال همگام‌سازی از این دستگاه قطع شود؟ داده‌های محلی و Gist دست نمی‌خورند.')) return;
  sync = { token: '', gistId: '', auto: true, lastPush: 0, lastPull: 0 };
  saveSyncLocal();
  updateSyncUi();
  toast('اتصال قطع شد');
};
$('#syncAutoToggle').onclick = e => {
  e.currentTarget.classList.toggle('on');
  sync.auto = e.currentTarget.classList.contains('on');
  saveSyncLocal();
};
$('#copyPairLink').onclick = async () => {
  if (!syncConnected()) return toast('اول سینک را فعال کن', 'err');
  await copyChatText(pairLink());
};
$('#topSync').onclick = () => {
  navigate('settings');
  $$('[data-settings-tab]').find(b => b.dataset.settingsTab === 'sync')?.click();
};
document.addEventListener('visibilitychange', () => {
  if (!syncConnected() || sync.auto === false) return;
  if (document.visibilityState === 'hidden') {
    if (syncDirty) pushSync({ keepalive: true });
  } else if (now() - (sync.lastPull || 0) > 60000) {
    pullSync();
  }
});

/* ========================= 16. MOBILE / KEYBOARD ========================= */
function setVh() {
  const vv = window.visualViewport ? visualViewport.height : innerHeight;
  const h = Math.min(vv || innerHeight, innerHeight, document.documentElement.clientHeight || 1e9);
  document.documentElement.style.setProperty('--vh', Math.round(h) + 'px');
}
setVh();
window.visualViewport?.addEventListener('resize', () => { setVh(); if (document.body.classList.contains('kb-open')) requestAnimationFrame(() => scrollMessagesToEnd(false)); });
window.addEventListener('resize', setVh);
window.addEventListener('orientationchange', () => setTimeout(setVh, 250));
const coarsePointer = () => matchMedia('(pointer:coarse)').matches;
$('#chatInput').addEventListener('focus', () => {
  if (isMobile() && coarsePointer()) {
    document.body.classList.add('kb-open');
    setTimeout(() => { setVh(); scrollMessagesToEnd(false); }, 250);
  }
});
$('#chatInput').addEventListener('blur', () => {
  setTimeout(() => { document.body.classList.remove('kb-open'); setVh(); }, 120);
});

/* ========================= 17. PUBLIC API & BOOT ========================= */
window.Lexora = {
  getSettings: () => settings,
  getState: () => state,
  normalizeCard, normalizeState,
  saveSettings: patch => { Object.assign(settings, patch || {}); saveSettingsData(); renderAll(); },
  saveState: () => save(),
  rerender: renderAll,
  reloadMessages: renderMessages,
  reloadReview: startReview,
  sync: { push: pushSync, pull: pullSync, status: () => ({ ...sync, token: sync.token ? '•••' : '' }) }
};

/* service worker + update toast */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            const e = document.createElement('div');
            e.className = 'toast';
            e.innerHTML = 'نسخه جدید Lexora آماده است <button class="undo-delete" type="button">به‌روزرسانی</button>';
            e.querySelector('button').onclick = () => { nw.postMessage('SKIP_WAITING'); e.remove(); };
            $('#toasts').append(e);
            setTimeout(() => e.remove(), 15000);
          }
        });
      });
    }).catch(err => console.error('SW register failed', err));
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      location.reload();
    });
  });
}

/* boot sequence */
document.body.classList.add('page-home');
tryHandlePairLink();
fillAllSettings();
renderAll();
renderMessages();
resizeChatInput();
if (syncConnected() && sync.auto !== false) pullSync();
})();
