/* =============================================
   ハレタス - app.js
   ============================================= */

'use strict';

/* =============================================
   定数・設定
   ============================================= */
const APP_VERSION = '1.0.0';
const DB_NAME     = 'haretasu_db';
const DB_VERSION  = 1;

const STORES = {
  TASKS:    'tasks',
  HABITS:   'habits',
  STATS:    'stats',
  NOTIF:    'notifications',
};

const DEFAULT_CATEGORIES = ['学校', 'プライベート', '健康', 'その他'];

const DEFAULT_CATEGORY_ICONS = {
  '学校':       '🏫',
  'プライベート': '🏠',
  '健康':       '💪',
  'その他':     '📌',
};

// カテゴリ永続管理
const CategoryManager = {
  _KEY: 'haretasu_categories',

  load() {
    try {
      const raw = localStorage.getItem(this._KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return [...DEFAULT_CATEGORIES];
  },

  save(list) {
    localStorage.setItem(this._KEY, JSON.stringify(list));
  },

  getIcon(name) {
    return DEFAULT_CATEGORY_ICONS[name] || '🏷️';
  },

  add(name) {
    name = name.trim();
    if (!name) return false;
    const list = this.load();
    if (list.includes(name)) return false;
    list.push(name);
    this.save(list);
    return true;
  },

  remove(name) {
    const list = this.load().filter(c => c !== name);
    this.save(list);
  },
};

// CATEGORY_ICONSを動的に参照するよう関数化（後方互換）
function getCategoryIcon(cat) {
  return DEFAULT_CATEGORY_ICONS[cat] || '🏷️';
}

const CATEGORY_ICONS = new Proxy({}, {
  get(_, name) { return getCategoryIcon(name); }
});

const WEATHER_STAGES = [
  { min: 0,   max: 24,  cls: 'sky-0',   label: '☁️ 曇り' },
  { min: 25,  max: 49,  cls: 'sky-25',  label: '🌥️ 薄曇り' },
  { min: 50,  max: 74,  cls: 'sky-50',  label: '⛅ 晴れ間' },
  { min: 75,  max: 99,  cls: 'sky-75',  label: '🌤️ 青空' },
  { min: 100, max: 100, cls: 'sky-100', label: '☀️ 快晴' },
];

/* =============================================
   IndexedDB ラッパー
   ============================================= */
class DB {
  constructor() { this._db = null; }

  open() {
    return new Promise((resolve, reject) => {
      if (this._db) { resolve(this._db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORES.TASKS)) {
          const ts = db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
          ts.createIndex('date',   'date',   { unique: false });
          ts.createIndex('type',   'type',   { unique: false });
          ts.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.HABITS)) {
          db.createObjectStore(STORES.HABITS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.STATS)) {
          db.createObjectStore(STORES.STATS,  { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains(STORES.NOTIF)) {
          db.createObjectStore(STORES.NOTIF,  { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async _tx(storeName, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req   = fn(store);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async put(storeName, data)    { return this._tx(storeName, 'readwrite', s => s.put(data)); }
  async get(storeName, key)     { return this._tx(storeName, 'readonly',  s => s.get(key)); }
  async delete(storeName, key)  { return this._tx(storeName, 'readwrite', s => s.delete(key)); }

  async getAll(storeName) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async getAllByIndex(storeName, indexName, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, 'readonly');
      const index = tx.objectStore(storeName).index(indexName);
      const req   = index.getAll(value);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async clear(storeName) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    });
  }
}

const db = new DB();

/* =============================================
   ユーティリティ
   ============================================= */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth()+1}月${d.getDate()}日`;
}

function timeLabel(timeStr) {
  if (!timeStr) return '';
  return timeStr.slice(0,5);
}

function formatDateFull(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['日','月','火','水','木','金','土'];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${days[d.getDay()]})`;
}

function qs(sel, el) { return (el || document).querySelector(sel); }
function qsa(sel, el){ return [...(el || document).querySelectorAll(sel)]; }

/* =============================================
   Toast
   ============================================= */
const Toast = (() => {
  const container = qs('#toast-container');
  let _currentEl  = null;
  let _timer      = null;

  function show(msg, type = 'info', duration = 2800) {
    // 既存の通知を即座に破棄
    if (_currentEl) {
      clearTimeout(_timer);
      _currentEl.remove();
      _currentEl = null;
    }

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    _currentEl = el;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('show'));
    });

    _timer = setTimeout(() => _dismiss(el), duration);
  }

  function _dismiss(el) {
    if (el !== _currentEl) return;
    el.classList.remove('show');
    el.addEventListener('transitionend', () => {
      if (el.parentNode) el.remove();
      if (_currentEl === el) _currentEl = null;
    }, { once: true });
  }

  return { show };
})();

/* =============================================
   タイムピッカー
   ============================================= */
const TimePicker = (() => {
  // 状態
  let _hour   = 12;
  let _minute = 0;
  let _mode   = 'hour'; // 'hour' | 'minute'
  let _onConfirm = null; // callback(hh, mm)

  // DOM参照（DOMContentLoaded後に解決）
  let _overlay, _hDisp, _mDisp, _clock, _hand,
      _tabHour, _tabMin, _btnOk, _btnCancel;

  const CLOCK_R  = 128;  // 時計半径(px) — tp-clock 256px の半分
  const NUM_OR   = 100;  // 12時間の数字の配置半径
  const NUM_OR5  = 102;  // 分(5刻み)の配置半径
  const NUM_ORI  = 68;   // 分(1刻み)の配置半径（内側）

  function _init() {
    _overlay   = qs('#modal-timepicker');
    _hDisp     = qs('#tp-h-display');
    _mDisp     = qs('#tp-m-display');
    _clock     = qs('#tp-clock');
    _hand      = qs('#tp-clock-hand');
    _tabHour   = qs('#tp-tab-hour');
    _tabMin    = qs('#tp-tab-min');
    _btnOk     = qs('#tp-btn-ok');
    _btnCancel = qs('#tp-btn-cancel');

    _tabHour.addEventListener('click', () => _switchMode('hour'));
    _tabMin .addEventListener('click', () => _switchMode('minute'));
    _hDisp  .addEventListener('click', () => _switchMode('hour'));
    _mDisp  .addEventListener('click', () => _switchMode('minute'));

    _btnOk.addEventListener('click', () => {
      const hh = String(_hour).padStart(2,'0');
      const mm = String(_minute).padStart(2,'0');
      _close();
      if (_onConfirm) _onConfirm(hh, mm);
    });
    _btnCancel.addEventListener('click', () => _close());
    _overlay.addEventListener('click', (e) => {
      if (e.target === _overlay) _close();
    });

    // タッチ・マウスで時計をドラッグ選択
    _clock.addEventListener('touchstart', _onClockStart, { passive: false });
    _clock.addEventListener('touchmove',  _onClockMove,  { passive: false });
    _clock.addEventListener('touchend',   _onClockEnd);
    _clock.addEventListener('mousedown',  _onClockStart);
    window.addEventListener('mousemove',  _onClockMove);
    window.addEventListener('mouseup',    _onClockEnd);
  }

  let _dragging = false;

  function _onClockStart(e) {
    e.preventDefault();
    _dragging = true;
    _applyClockPoint(e);
  }
  function _onClockMove(e) {
    if (!_dragging) return;
    e.preventDefault();
    _applyClockPoint(e);
  }
  function _onClockEnd(e) {
    if (!_dragging) return;
    _dragging = false;
    // 時モードは選択後、自動で分モードへ
    if (_mode === 'hour') {
      setTimeout(() => _switchMode('minute'), 220);
    }
  }

  function _applyClockPoint(e) {
    const pt    = e.touches ? e.touches[0] : e;
    const rect  = _clock.getBoundingClientRect();
    const cx    = rect.left + rect.width  / 2;
    const cy    = rect.top  + rect.height / 2;
    const dx    = pt.clientX - cx;
    const dy    = pt.clientY - cy;
    const angle = Math.atan2(dx, -dy); // ラジアン、12時=0

    if (_mode === 'hour') {
      let h = Math.round(angle / (Math.PI * 2 / 12));
      if (h <= 0) h += 12;
      if (h > 12) h = 12;
      _hour = h;
    } else {
      let m = Math.round(angle / (Math.PI * 2 / 60));
      if (m < 0)  m += 60;
      if (m >= 60) m = 0;
      _minute = m;
    }
    _render();
  }

  function _switchMode(mode) {
    _mode = mode;
    _tabHour.classList.toggle('active', mode === 'hour');
    _tabMin .classList.toggle('active', mode === 'minute');
    _hDisp  .classList.toggle('active', mode === 'hour');
    _mDisp  .classList.toggle('active', mode === 'minute');
    _buildClock();
    _render();
  }

  function _buildClock() {
    // 既存の数字を削除（手とセンターは残す）
    qsa('.tp-num', _clock).forEach(n => n.remove());

    if (_mode === 'hour') {
      for (let h = 1; h <= 12; h++) {
        const ang = (h / 12) * Math.PI * 2 - Math.PI / 2; // 12時基準
        const x = CLOCK_R + Math.cos(ang) * NUM_OR;
        const y = CLOCK_R + Math.sin(ang) * NUM_OR;
        const num = document.createElement('div');
        num.className = 'tp-num' + (h === _hour ? ' selected' : '');
        num.textContent = String(h);
        num.style.left = `${x}px`;
        num.style.top  = `${y}px`;
        num.addEventListener('click', (e) => {
          e.stopPropagation();
          _hour = h;
          _render();
          setTimeout(() => _switchMode('minute'), 200);
        });
        _clock.appendChild(num);
      }
    } else {
      // 分: 0〜55 を 5刻みで外周、残りを内側に小さく
      for (let m = 0; m < 60; m++) {
        const is5 = m % 5 === 0;
        const ang  = (m / 60) * Math.PI * 2 - Math.PI / 2;
        const r    = is5 ? NUM_OR5 : NUM_ORI;
        const x    = CLOCK_R + Math.cos(ang) * r;
        const y    = CLOCK_R + Math.sin(ang) * r;
        const num  = document.createElement('div');
        num.className = 'tp-num' + (is5 ? ' min-major' : ' min-minor') + (m === _minute ? ' selected' : '');
        num.textContent = is5 ? String(m).padStart(2,'0') : '·';
        num.style.left = `${x}px`;
        num.style.top  = `${y}px`;
        num.addEventListener('click', (e) => {
          e.stopPropagation();
          _minute = m;
          _render();
        });
        _clock.appendChild(num);
      }
    }
  }

  function _render() {
    // 表示を更新
    _hDisp.textContent = String(_hour).padStart(2,'0');
    _mDisp.textContent = String(_minute).padStart(2,'0');

    // 各数字のハイライト更新
    if (_mode === 'hour') {
      qsa('.tp-num', _clock).forEach(n => {
        n.classList.toggle('selected', parseInt(n.textContent,10) === _hour);
      });
    } else {
      qsa('.tp-num', _clock).forEach(n => {
        const val = n.classList.contains('min-minor') ? null : parseInt(n.textContent, 10);
        if (n.classList.contains('min-minor')) {
          // ドット: 近い分を選択中なら光らせる（視覚補助）
          n.classList.toggle('selected', false);
        } else {
          n.classList.toggle('selected', val === _minute);
        }
      });
      // min-minor（ドット）は正確な _minute に近いものを light
      qsa('.tp-num.min-minor', _clock).forEach(n => {
        // ドット自体にdata-minを持たせているので角度で特定
        // シンプルにスキップ（ドットは常に非ハイライト）
      });
    }

    // 針の角度と長さ
    let angle, handLength;
    if (_mode === 'hour') {
      angle      = (_hour / 12) * 360;
      handLength = NUM_OR - 14; // 数字中央まで
    } else {
      angle      = (_minute / 60) * 360;
      handLength = NUM_OR5 - 14;
    }
    _hand.style.height    = `${handLength}px`;
    _hand.style.transform = `rotate(${angle}deg)`;
  }

  function open(currentVal, onConfirm) {
    // 既存値をパース
    if (currentVal && /^\d{2}:\d{2}$/.test(currentVal)) {
      _hour   = parseInt(currentVal.split(':')[0], 10) % 12 || 12;
      _minute = parseInt(currentVal.split(':')[1], 10);
    } else {
      const now = new Date();
      _hour   = now.getHours() % 12 || 12;
      _minute = Math.round(now.getMinutes() / 5) * 5 % 60;
    }
    _mode      = 'hour';
    _onConfirm = onConfirm;

    _tabHour.classList.add('active');
    _tabMin .classList.remove('active');
    _hDisp  .classList.add('active');
    _mDisp  .classList.remove('active');

    _overlay.hidden = false;
    _buildClock();
    _render();
  }

  function _close() {
    _overlay.hidden = true;
    _dragging = false;
  }

  return { _init, open };
})();

/* =============================================
   タスクストア
   ============================================= */
const TaskStore = {
  async save(task) {
    await db.put(STORES.TASKS, task);
  },
  async getById(id) {
    return db.get(STORES.TASKS, id);
  },
  async remove(id) {
    await db.delete(STORES.TASKS, id);
  },
  async getAll() {
    return db.getAll(STORES.TASKS);
  },
  async getByDate(dateStr) {
    return db.getAllByIndex(STORES.TASKS, 'date', dateStr);
  },
  async getTodayTasks() {
    return db.getAllByIndex(STORES.TASKS, 'date', todayStr());
  },
  async getLeftoverTasks() {
    const all   = await this.getAll();
    const today = todayStr();
    return all.filter(t =>
      t.type === 'once' &&
      t.status !== 'done' &&
      t.date &&
      t.date < today
    ).sort((a,b) => (a.date < b.date ? 1 : -1));
  },
  async getFutureTasks() {
    const all   = await this.getAll();
    const today = todayStr();
    return all.filter(t =>
      t.type === 'once' &&
      t.date > today
    ).sort((a,b) => (a.date < b.date ? -1 : 1));
  },
  async search(query, dateFilter) {
    const all = await this.getAll();
    const q = (query || '').trim().toLowerCase();
    return all.filter(t => {
      const matchText = !q ||
        (t.title  || '').toLowerCase().includes(q) ||
        (t.memo   || '').toLowerCase().includes(q);
      const matchDate = !dateFilter || t.date === dateFilter;
      return matchText && matchDate;
    }).sort((a,b) => (a.date < b.date ? 1 : -1));
  },
};

/* =============================================
   習慣ストア
   ============================================= */
const HabitStore = {
  async save(habit) {
    await db.put(STORES.HABITS, habit);
  },
  async getById(id) {
    return db.get(STORES.HABITS, id);
  },
  async remove(id) {
    await db.delete(STORES.HABITS, id);
  },
  async getAll() {
    return db.getAll(STORES.HABITS);
  },
  /** 今日の完了をトグル */
  async toggleToday(id) {
    const habit = await this.getById(id);
    if (!habit) return;
    const today = todayStr();
    if (!habit.completedDates) habit.completedDates = [];
    const idx = habit.completedDates.indexOf(today);
    if (idx >= 0) {
      habit.completedDates.splice(idx, 1);
    } else {
      habit.completedDates.push(today);
    }
    habit.streak = this._calcStreak(habit);
    await this.save(habit);
    return habit;
  },
  /** 今日の達成を done(true/false) に明示的に合わせる（同期用） */
  async setToday(id, done) {
    const habit = await this.getById(id);
    if (!habit) return;
    if (!habit.completedDates) habit.completedDates = [];
    const today = todayStr();
    const idx = habit.completedDates.indexOf(today);
    if (done && idx < 0) habit.completedDates.push(today);
    if (!done && idx >= 0) habit.completedDates.splice(idx, 1);
    habit.streak = this._calcStreak(habit);
    await this.save(habit);
    return habit;
  },
  _calcStreak(habit) {
    const dates = [...(habit.completedDates || [])].sort().reverse();
    if (!dates.length) return 0;
    const today  = todayStr();
    let streak   = 0;
    let check    = new Date(today + 'T00:00:00');
    const maxGap = habit.habitType === 'loose' ? 3 : 1;

    for (let i = 0; i < 3650; i++) {
      const str = `${check.getFullYear()}-${String(check.getMonth()+1).padStart(2,'0')}-${String(check.getDate()).padStart(2,'0')}`;
      if (dates.includes(str)) {
        streak++;
        check.setDate(check.getDate() - 1);
      } else {
        // 空白日チェック
        let gapDays = 0;
        const temp = new Date(check);
        while (gapDays < maxGap) {
          temp.setDate(temp.getDate() - 1);
          gapDays++;
          const ts = `${temp.getFullYear()}-${String(temp.getMonth()+1).padStart(2,'0')}-${String(temp.getDate()).padStart(2,'0')}`;
          if (dates.includes(ts)) { break; }
        }
        if (gapDays < maxGap && dates.some(d => {
          const tmp2 = new Date(check);
          for (let g=1; g<=maxGap; g++) {
            tmp2.setDate(tmp2.getDate()-1);
            const ts2 = `${tmp2.getFullYear()}-${String(tmp2.getMonth()+1).padStart(2,'0')}-${String(tmp2.getDate()).padStart(2,'0')}`;
            if (d === ts2) return true;
          }
          return false;
        })) {
          check.setDate(check.getDate() - 1);
          continue;
        }
        break;
      }
    }
    return streak;
  },
};

/* =============================================
   統計ストア
   ============================================= */
const StatsStore = {
  async saveDay(dateStr, total, done) {
    await db.put(STORES.STATS, { date: dateStr, total, done });
  },
  async getAll() {
    return db.getAll(STORES.STATS);
  },
};

/* =============================================
   通知スケジューラ
   ============================================= */
const Notifier = {
  _supported: 'Notification' in window && 'serviceWorker' in navigator,

  async requestPermission() {
    if (!this._supported) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied')  return 'denied';
    const result = await Notification.requestPermission();
    return result;
  },

  /** タスクの通知を登録（Service Worker経由） */
  async schedule(task) {
    if (!this._supported) return;
    if (Notification.permission !== 'granted') return;
    if (!task.notifications || !task.notifications.length) return;
    if (!task.date || !task.time) return;

    const taskDateTime = new Date(`${task.date}T${task.time}:00`);
    const now = Date.now();

    for (const notif of task.notifications) {
      const minutesBefore = parseInt(notif.minutesBefore, 10);
      if (isNaN(minutesBefore)) continue;
      const notifTime = taskDateTime.getTime() - minutesBefore * 60000;
      if (notifTime <= now) continue;

      // IndexedDBに保存（SW側で参照）
      const notifRecord = {
        id:         `${task.id}_${minutesBefore}`,
        taskId:     task.id,
        title:      `⏰ ${task.title}`,
        body:       minutesBefore > 0
                      ? `${minutesBefore}分後にタスクがあります`
                      : 'タスクの時刻になりました',
        notifTime:  notifTime,
        tag:        `haretasu_${task.id}_${minutesBefore}`,
      };
      await db.put(STORES.NOTIF, notifRecord);
    }

    // Service Workerへメッセージ
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SCHEDULE_NOTIFICATIONS',
        taskId: task.id,
      });
    }
  },

  async cancel(taskId) {
    const all = await db.getAll(STORES.NOTIF);
    for (const n of all) {
      if (n.taskId === taskId) {
        await db.delete(STORES.NOTIF, n.id);
      }
    }
  },
};

/* =============================================
   タスクモーダル
   ============================================= */
const TaskModal = {
  _mode: 'today', // 'today' | 'future' | 'daily'
  _editId: null,
  _selectedCategory: '学校',
  _selectedHabit: 'strict',
  _notifications: [],
  _prefillDate: null,

  open(mode, prefillDate, editTask) {
    this._mode   = mode || 'today';
    this._editId = editTask ? editTask.id : null;
    this._prefillDate = prefillDate || null;
    this._notifications = [];
    this._selectedCategory = CategoryManager.load()[0] || 'その他';
    this._selectedHabit = 'strict';

    qs('#task-modal-title').textContent =
      editTask ? 'タスクを編集' :
      mode === 'daily' ? '習慣を追加' : 'タスクを追加';

    qs('#task-edit-id').value = '';
    qs('#task-title').value   = '';
    qs('#task-memo').value    = '';
    qs('#task-date').value    = '';
    qs('#task-time').value    = '';
    // 時間表示ウィジェットのリセット
    const _td = qs('#task-time-display');
    const _tc = qs('#btn-clear-time');
    if (_td) { _td.textContent = '--:--'; _td.classList.add('empty'); }
    if (_tc) { _tc.hidden = true; }

    // 日付プリセット
    if (mode === 'today') {
      qs('#task-date').value = todayStr();
    } else if (mode === 'daily') {
      qs('#task-date').value = todayStr(); // 毎日タブでも今日の日付を初期値に
    } else if (mode === 'future' && prefillDate) {
      qs('#task-date').value = prefillDate;
    }

    // 編集の場合は既存値を展開（カテゴリ描画より先に設定）
    if (editTask) {
      qs('#task-edit-id').value  = editTask.id;
      qs('#task-title').value    = editTask.title || '';
      // タイトル＝1行目／メモ＝2行目以降 として1つの入力欄にまとめて表示
      qs('#task-memo').value     = [editTask.title || '', editTask.memo || '']
                                     .filter(Boolean).join('\n');
      qs('#task-date').value     = editTask.date  || '';
      qs('#task-time').value     = editTask.time  || '';
      // 時間ウィジェット反映
      const td2 = qs('#task-time-display');
      const tc2 = qs('#btn-clear-time');
      if (editTask.time) {
        if (td2) { td2.textContent = editTask.time; td2.classList.remove('empty'); }
        if (tc2) { tc2.hidden = false; }
      }
      this._selectedCategory     = editTask.category || (CategoryManager.load()[0] || 'その他');
      this._selectedHabit        = editTask.habitType || 'strict';
      this._notifications        = (editTask.notifications || []).map(n => ({...n}));
    }

    // カテゴリチップを動的描画
    this._renderCategoryChips();

    // 習慣タイプ
    qsa('.chip-habit').forEach(c => c.classList.remove('active'));
    const firstHabit = qs('[data-habit="strict"]');
    if (firstHabit) firstHabit.classList.add('active');
    if (editTask) {
      qsa('.chip-habit').forEach(c => {
        c.classList.toggle('active', c.dataset.habit === this._selectedHabit);
      });
    }

    // 毎日タスクオプション表示
    qs('#daily-task-options').hidden = (mode !== 'daily');

    // 通知リスト
    this._renderNotifications();

    qs('#modal-task').hidden = false;
    setTimeout(() => qs('#task-memo').focus(), 320);
  },

  _renderCategoryChips() {
    const container = qs('#category-chips');
    if (!container) return;
    container.innerHTML = '';
    const categories = CategoryManager.load();
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip category-chip-item' + (cat === this._selectedCategory ? ' active' : '');
      btn.dataset.category = cat;

      const icon = CategoryManager.getIcon(cat);
      btn.innerHTML = `${icon} ${escHtml(cat)}`;

      // タップで選択
      btn.addEventListener('click', () => {
        qsa('.category-chip-item').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        TaskModal._selectedCategory = cat;
      });

      // 長押し（0.5秒）でポップアップメニュー
      let lpTimer = null;
      const startLongPress = (e) => {
        lpTimer = setTimeout(() => {
          lpTimer = null;
          TaskModal._showChipMenu(cat, btn);
        }, 500);
      };
      const cancelLongPress = () => { clearTimeout(lpTimer); lpTimer = null; };
      btn.addEventListener('touchstart', startLongPress, { passive: true });
      btn.addEventListener('touchend',   cancelLongPress);
      btn.addEventListener('touchmove',  cancelLongPress);
      btn.addEventListener('mousedown',  startLongPress);
      btn.addEventListener('mouseup',    cancelLongPress);
      btn.addEventListener('mouseleave', cancelLongPress);
      // 長押し後にclickでの誤選択を防ぐフラグ
      btn.addEventListener('contextmenu', e => e.preventDefault());

      container.appendChild(btn);
    });
  },

  _showChipMenu(cat, anchorEl) {
    // 既存メニューを閉じる
    const existing = qs('#chip-ctx-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'chip-ctx-menu';
    menu.className = 'chip-ctx-menu';
    menu.innerHTML = `
      <button class="chip-ctx-item" data-action="rename">✏️ 名前を変更</button>
      <button class="chip-ctx-item chip-ctx-danger" data-action="delete">🗑️ 消去</button>
    `;

    // アンカーの位置にメニューを表示
    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    const menuW = 160;
    let left = rect.left;
    let top  = rect.bottom + 6;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    menu.style.left = `${left}px`;
    menu.style.top  = `${top}px`;

    const close = () => { menu.remove(); document.removeEventListener('click', outsideClick); };
    const outsideClick = (e) => { if (!menu.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('click', outsideClick), 10);

    menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
      close();
      const newName = prompt(`「${cat}」の新しい名前を入力してください`, cat);
      if (!newName || newName.trim() === '') return;
      const trimmed = newName.trim();
      if (trimmed === cat) return;
      const list = CategoryManager.load();
      if (list.includes(trimmed)) {
        Toast.show('同じ名前のカテゴリが既にあります', 'warn');
        return;
      }
      const idx = list.indexOf(cat);
      list[idx] = trimmed;
      CategoryManager.save(list);
      if (TaskModal._selectedCategory === cat) TaskModal._selectedCategory = trimmed;
      TaskModal._renderCategoryChips();
      Toast.show(`「${cat}」を「${trimmed}」に変更しました`, 'success');
    });

    menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
      close();
      const currentList = CategoryManager.load();
      if (currentList.length <= 1) {
        Toast.show('カテゴリは最低1つ必要です', 'warn');
        return;
      }
      CategoryManager.remove(cat);
      if (TaskModal._selectedCategory === cat) {
        TaskModal._selectedCategory = CategoryManager.load()[0] || 'その他';
      }
      TaskModal._renderCategoryChips();
      Toast.show(`「${cat}」を削除しました`, 'info');
    });
  },

  close() {
    qs('#modal-task').hidden = true;
  },

  _renderNotifications() {
    const list = qs('#notification-list');
    list.innerHTML = '';
    this._notifications.forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'notification-row';
      row.innerHTML = `
        <input type="number" class="input-field" value="${Number(n.minutesBefore) || 0}"
          min="1" max="1440" placeholder="分"
          data-notif-index="${i}" style="max-width:90px">
        <span class="notification-row-label">分前</span>
        <button type="button" class="icon-btn" data-remove-notif="${i}" aria-label="通知を削除">🗑️</button>
      `;
      list.appendChild(row);
    });
  },

  async save() {
    // 入力欄は1つ。1行目をタイトル、2行目以降をメモとして扱う
    const lines = qs('#task-memo').value.replace(/\r\n/g, '\n').split('\n');
    const title = (lines.shift() || '').trim();
    const memo  = lines.join('\n').trim();
    if (!title) {
      Toast.show('内容を入力してください', 'warn');
      qs('#task-memo').focus();
      return;
    }

    const id = this._editId || genId();

    // 通知リストの入力値を同期
    qsa('[data-notif-index]').forEach(inp => {
      const idx = parseInt(inp.dataset.notifIndex, 10);
      if (this._notifications[idx]) {
        this._notifications[idx].minutesBefore = parseInt(inp.value, 10) || 0;
      }
    });

    const task = {
      id,
      title,
      memo,
      date:          qs('#task-date').value,
      time:          qs('#task-time').value,
      category:      this._selectedCategory,
      notifications: this._notifications.filter(n => n.minutesBefore > 0),
      type:          this._mode === 'daily' ? 'daily' : 'once',
      habitType:     this._selectedHabit,
      status:        this._editId ? (await TaskStore.getById(id))?.status || 'pending' : 'pending',
      createdAt:     this._editId ? (await TaskStore.getById(id))?.createdAt || Date.now() : Date.now(),
      updatedAt:     Date.now(),
    };

    await TaskStore.save(task);

    // 毎日タスクの場合はHabitStoreにも直接保存
    if (this._mode === 'daily') {
      const existing = await HabitStore.getById(id);
      if (!existing) {
        await HabitStore.save({
          id,
          title:          task.title,
          memo:           task.memo || '',
          habitType:      task.habitType || 'strict',
          category:       task.category || 'その他',
          completedDates: [],
          streak:         0,
          createdAt:      task.createdAt,
        });
      } else {
        existing.title     = task.title;
        existing.memo      = task.memo || '';
        existing.habitType = task.habitType || 'strict';
        existing.category  = task.category || 'その他';
        await HabitStore.save(existing);
      }
    }

    // 通知スケジュール
    if (task.notifications.length) {
      const perm = await Notifier.requestPermission();
      if (perm === 'granted') {
        await Notifier.cancel(id);
        await Notifier.schedule(task);
      } else if (perm === 'denied') {
        Toast.show('通知が拒否されています。ブラウザの設定から許可してください', 'warn', 5000);
      }
    }

    this.close();
    Toast.show(this._editId ? 'タスクを更新しました' : 'タスクを追加しました ✅', 'success');

    // 画面更新
    await App.refresh();
  },
};

/* =============================================
   スワイプ処理
   ============================================= */
function attachSwipe(cardEl, onComplete, onDelete) {
  let startX = 0, startY = 0, curX = 0, dragging = false;
  const inner = cardEl.querySelector('.task-card-inner');
  const bgRight = cardEl.querySelector('.task-card-swipe-bg.swipe-right');
  const bgLeft  = cardEl.querySelector('.task-card-swipe-bg.swipe-left');
  const THRESHOLD = 72;
  const MAX_DRAG  = 110;

  function reset() {
    inner.style.transform = '';
    bgRight.style.opacity = 0;
    bgLeft.style.opacity  = 0;
  }

  function onStart(e) {
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    curX = 0;
    dragging = false;
  }

  function onMove(e) {
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    if (!dragging && Math.abs(dy) > Math.abs(dx)) return; // 縦スクロール優先
    if (!dragging && Math.abs(dx) > 8) dragging = true;
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    curX = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));
    inner.style.transform = `translateX(${curX}px)`;
    if (curX > 0) {
      bgRight.style.opacity = Math.min(1, curX / THRESHOLD);
      bgLeft.style.opacity  = 0;
    } else {
      bgLeft.style.opacity  = Math.min(1, -curX / THRESHOLD);
      bgRight.style.opacity = 0;
    }
  }

  function onEnd() {
    const moved = dragging ? curX : 0;
    dragging = false;
    curX = 0;
    reset();
    if (moved > THRESHOLD && onComplete) onComplete();
    else if (moved < -THRESHOLD && onDelete) onDelete();
  }

  // タッチはこのカードだけにバインド（他カードへ影響しない）
  cardEl.addEventListener('touchstart',  onStart, { passive: true });
  cardEl.addEventListener('touchmove',   onMove,  { passive: false });
  cardEl.addEventListener('touchend',    onEnd);
  cardEl.addEventListener('touchcancel', onEnd);

  // マウスはドラッグ中だけ window に登録し、離したら必ず解除する
  // （カード枚数ぶん window に残り続けると、無関係なイベントで誤発火する）
  cardEl.addEventListener('mousedown', (e) => {
    onStart(e);
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      onEnd(ev);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup',   up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup',   up);
  });
}

/* =============================================
   タスクカード生成
   ============================================= */
function createTaskCard(task, options = {}) {
  const {
    showDate = false,
    swipeComplete = false,
    swipeDelete   = false,
    reorderable   = false,
    longPressCopy = false,
    onComplete, onDelete, onEdit, onReorderEnd,
  } = options;

  const li = document.createElement('li');
  li.className = 'task-card' + (task.status === 'done' ? ' completed' : '');
  li.dataset.id = task.id;

  const drop = task.status === 'done' ? '✅' : '💧';
  const catIcon = CATEGORY_ICONS[task.category] || '📌';
  const catClass = `cat-${escHtml(task.category || 'その他')}`;

  const metaItems = [];
  if (task.category) metaItems.push(`<span class="task-tag ${catClass}">${catIcon} ${escHtml(task.category)}</span>`);
  if (showDate && task.date) metaItems.push(`<span class="leftover-date-badge">📅 ${escHtml(dateLabel(task.date))}</span>`);
  if (task.time) metaItems.push(`<span class="task-time-label">🕐 ${escHtml(timeLabel(task.time))}</span>`);

  li.innerHTML = `
    <div class="task-card-swipe-bg swipe-right" aria-hidden="true">✅ 完了</div>
    <div class="task-card-swipe-bg swipe-left"  aria-hidden="true">🗑️ 削除</div>
    <div class="task-card-inner">
      <div class="task-drop" aria-hidden="true">${drop}</div>
      <div class="task-body">
        <div class="task-title-row">
          <div class="task-title-text">${escHtml(task.title)}</div>
          <span class="task-expand-chevron" aria-hidden="true">▾</span>
        </div>
        ${metaItems.length ? `<div class="task-meta">${metaItems.join('')}</div>` : ''}
        ${task.memo ? `<div class="task-memo-text">${escHtml(task.memo)}</div>` : ''}
      </div>
      <div class="task-actions">
        <button class="task-action-btn btn-edit" aria-label="編集">✏️</button>
        <button class="task-action-btn btn-del"  aria-label="削除">🗑️</button>
      </div>
      ${reorderable ? '<div class="task-drag-handle" role="button" aria-label="長押しして並び替え">≡</div>' : ''}
    </div>
  `;

  // スワイプ
  if (swipeComplete || swipeDelete) {
    attachSwipe(li,
      swipeComplete ? onComplete : null,
      swipeDelete   ? onDelete   : null
    );
  }

  li.querySelector('.btn-edit').addEventListener('click', (e) => { e.stopPropagation(); if (onEdit) onEdit(); });
  li.querySelector('.btn-del' ).addEventListener('click', (e) => { e.stopPropagation(); if (onDelete) onDelete(); });

  // 長押し選択（やり残し用）
  if (options.longPressSelect) {
    let lpTimer = null;
    li.addEventListener('touchstart', () => {
      lpTimer = setTimeout(() => {
        li.classList.toggle('selected');
        if (options.onSelectChange) options.onSelectChange();
      }, 500);
    }, { passive: true });
    li.addEventListener('touchend',   () => clearTimeout(lpTimer));
    li.addEventListener('touchmove',  () => clearTimeout(lpTimer));
  }

  // 長押しでコピー（today / future）
  if (longPressCopy) attachLongPressCopy(li, task);

  // 並び替え（右端の「≡」ハンドルをドラッグ）
  if (reorderable) {
    li.classList.add('reorderable');
    attachReorder(li, li.querySelector('.task-drag-handle'), onReorderEnd);
  }

  // 本文タップで全文を開閉（アコーディオン）
  if (task.memo) li.classList.add('has-more');
  const bodyEl = li.querySelector('.task-body');
  if (bodyEl) {
    bodyEl.addEventListener('click', () => {
      if (li._suppressClick) { li._suppressClick = false; return; } // 長押しコピー直後の誤展開を防ぐ
      li.classList.toggle('expanded');
    });
  }
  // タイトルが折りたたみ行数に収まらない場合も「開ける」マークを出す
  requestAnimationFrame(() => {
    try {
      const t = li.querySelector('.task-title-text');
      if (t && t.scrollHeight - t.clientHeight > 1) li.classList.add('has-more');
    } catch (_) {}
  });

  return li;
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* クリップボードへコピー（API→フォールバックの二段構え） */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* フォールバックへ */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.webkitUserSelect = 'text';
    ta.style.userSelect = 'text';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}

/* カード長押しで本文をコピー */
function attachLongPressCopy(li, task) {
  let timer = null, sx = 0, sy = 0;
  const start = (e) => {
    const pt = e.touches ? e.touches[0] : e;
    sx = pt.clientX; sy = pt.clientY;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      li._suppressClick = true;                 // 直後のタップ展開を抑制
      setTimeout(() => { li._suppressClick = false; }, 600);
      const text = [task.title || '', task.memo || ''].filter(Boolean).join('\n');
      const ok = await copyText(text);
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
      Toast.show(ok ? 'コピーしました 📋' : 'コピーできませんでした', ok ? 'success' : 'warn');
    }, 480);
  };
  const cancel = () => clearTimeout(timer);
  const move = (e) => {
    const pt = e.touches ? e.touches[0] : e;
    if (Math.abs(pt.clientX - sx) > 8 || Math.abs(pt.clientY - sy) > 8) clearTimeout(timer);
  };
  li.addEventListener('touchstart', start, { passive: true });
  li.addEventListener('touchend',   cancel);
  li.addEventListener('touchcancel',cancel);
  li.addEventListener('touchmove',  move, { passive: true });
  li.addEventListener('mousedown',  start);
  li.addEventListener('mousemove',  move);
  li.addEventListener('mouseup',    cancel);
  li.addEventListener('mouseleave', cancel);
  // 長押しでコンテキストメニュー（「デバイスに送信」等）を出さない
  li.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* 「≡」ハンドルをドラッグして並び替え（未完了カードのみ） */
function attachReorder(li, handle, onReorderEnd) {
  if (!handle) return;
  let dragging = false, list = null, usingTouch = false;
  const yOf = (e) => (e.touches ? e.touches[0].clientY : e.clientY);

  const onMove = (e) => {
    if (!dragging) return;
    if (usingTouch) e.stopPropagation();        // カードのスワイプ/長押しに伝えない
    if (e.cancelable) e.preventDefault();        // ドラッグ中はスクロールさせない
    const y = yOf(e);
    const cards = [...list.querySelectorAll('.task-card:not(.completed)')].filter(c => c !== li);
    let before = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = c; break; }
    }
    if (before) list.insertBefore(li, before);
    else if (cards.length) cards[cards.length - 1].after(li);
  };

  const cleanup = () => {
    handle.removeEventListener('touchmove',  onMove);
    handle.removeEventListener('touchend',   onEnd);
    handle.removeEventListener('touchcancel',onEnd);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onEnd);
  };

  async function onEnd(e) {
    if (!dragging) return;
    if (usingTouch && e) e.stopPropagation();
    dragging = false;
    li.classList.remove('reordering');
    cleanup();
    if (onReorderEnd) await onReorderEnd(list);
  }

  const onStart = (e) => {
    e.stopPropagation();                          // カードのスワイプ/長押しを発火させない
    if (e.cancelable) e.preventDefault();
    list = li.parentElement;
    if (!list) return;
    usingTouch = !!e.touches;
    dragging = true;
    li.classList.add('reordering');
    // タッチイベントは開始要素(ハンドル)に届き続けるのでハンドルに、マウスは document に紐付ける
    if (usingTouch) {
      handle.addEventListener('touchmove',  onMove, { passive: false });
      handle.addEventListener('touchend',   onEnd);
      handle.addEventListener('touchcancel',onEnd);
    } else {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onEnd);
    }
  };

  handle.addEventListener('touchstart', onStart, { passive: false });
  handle.addEventListener('mousedown',  onStart);
}

/* =============================================
   今日のタスクタブ
   ============================================= */
const TodayTab = {
  async render() {
    const list  = qs('#today-task-list');
    const empty = qs('#today-empty');
    const count = qs('#today-task-count');
    list.innerHTML = '';

    let tasks = await TaskStore.getTodayTasks();

    // order 未設定のタスクに採番（初回は「時刻→作成順」を既定にし、以降は手動並びを保持）
    const defaultSort = (a, b) => {
      if (a.time && b.time) return a.time < b.time ? -1 : 1;
      if (a.time) return -1;
      if (b.time) return 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    };
    const have = tasks.filter(t => typeof t.order === 'number');
    const lack = tasks.filter(t => typeof t.order !== 'number').sort(defaultSort);
    let maxOrder = have.length ? Math.max(...have.map(t => t.order)) : -1;
    for (const t of lack) { t.order = ++maxOrder; await TaskStore.save(t); }
    tasks = have.concat(lack);

    // 表示順：未完了 → 完了（完了は常に下）、各グループ内は order 順
    tasks.sort((a, b) => {
      const ra = a.status === 'done' ? 1 : 0;
      const rb = b.status === 'done' ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return (a.order || 0) - (b.order || 0);
    });

    count.textContent = `${tasks.length}件のタスク`;
    empty.hidden = tasks.length > 0;

    let hint = false;
    for (const task of tasks) {
      const card = createTaskCard(task, {
        swipeComplete: true,
        swipeDelete:   true,
        reorderable:   true,
        longPressCopy: true,
        onComplete:   () => this._complete(task.id),
        onDelete:     () => this._delete(task.id),
        onEdit:       () => this._edit(task),
        onReorderEnd: (listEl) => this._persistOrder(listEl),
      });
      list.appendChild(card);
      if (!hint && task.status !== 'done') hint = true;
    }

    if (hint && tasks.length > 0 && tasks.some(t => t.status !== 'done')) {
      const hintEl = document.createElement('div');
      hintEl.className = 'swipe-hint';
      hintEl.textContent = 'スワイプで完了/削除・長押しでコピー・≡で並び替え';
      list.appendChild(hintEl);
    }

    this._updateSky(tasks);
    await StatsStore.saveDay(todayStr(),
      tasks.length,
      tasks.filter(t => t.status === 'done').length
    );
  },

  // 並び替え確定：DOM の並び順を order として保存して再描画
  async _persistOrder(listEl) {
    const ids = [...listEl.querySelectorAll('.task-card')].map(c => c.dataset.id);
    for (let i = 0; i < ids.length; i++) {
      const t = await TaskStore.getById(ids[i]);
      if (t) { t.order = i; await TaskStore.save(t); }
    }
    await this.render();
  },

  _updateSky(tasks) {
    const total = tasks.length;
    const done  = tasks.filter(t => t.status === 'done').length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

    qs('#progress-percent').textContent = `${pct}%`;
    qs('#progress-bar').style.width     = `${pct}%`;

    const stage = WEATHER_STAGES.find(s => pct >= s.min && pct <= s.max)
                  || WEATHER_STAGES[0];

    const skyBg = qs('#sky-bg');
    skyBg.className = `sky-bg ${stage.cls}`;

    // 雲の透明度
    const cloudOpacity = Math.max(0, 1 - pct / 100);
    qsa('.cloud').forEach(c => {
      c.style.opacity = cloudOpacity * (c.classList.contains('cloud-1') ? 0.9 :
                         c.classList.contains('cloud-2') ? 0.7 : 0.5);
    });

    // 太陽
    const sun = qs('#sun');
    if (pct >= 50) {
      sun.classList.add('visible');
    } else {
      sun.classList.remove('visible');
    }

    // 達成演出 — total>0 かつ全完了、かつ当日未表示の場合のみ
    if (total > 0 && done === total && pct === 100) {
      this._showCompleteOverlay();
    }
  },

  _showCompleteOverlay() {
    const today = todayStr();
    const key   = 'complete_shown_' + today;
    // セッション内で既に表示済みならスキップ
    if (sessionStorage.getItem(key)) return;
    // オーバーレイが既に表示中ならスキップ
    const overlay = qs('#overlay-complete');
    if (!overlay.hidden) return;
    sessionStorage.setItem(key, '1');

    overlay.hidden = false;

    // 紙吹雪
    const wrap = qs('#confetti-wrap');
    wrap.innerHTML = '';
    const colors = ['#FFD54F','#42A5F5','#66BB6A','#EF5350','#AB47BC','#FF7043'];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.cssText = `
        left: ${Math.random()*100}%;
        background: ${colors[Math.floor(Math.random()*colors.length)]};
        animation-duration: ${1.8 + Math.random()*2}s;
        animation-delay: ${Math.random()*1.5}s;
        transform: rotate(${Math.random()*360}deg);
        width: ${6+Math.random()*8}px;
        height: ${10+Math.random()*10}px;
        border-radius: ${Math.random()>0.5?'50%':'2px'};
      `;
      wrap.appendChild(p);
    }
  },

  async _complete(id) {
    const task = await TaskStore.getById(id);
    if (!task) return;
    task.status    = task.status === 'done' ? 'pending' : 'done';
    task.updatedAt = Date.now();
    await TaskStore.save(task);
    // 毎日タスクなら習慣（毎日タブ）側の今日の達成も同期する
    if (task.type === 'daily') {
      await HabitStore.setToday(id, task.status === 'done');
    }
    Toast.show(task.status === 'done' ? '✅ 完了しました！' : '↩️ 未完了に戻しました', 'success');
    await this.render();
  },

  async _delete(id) {
    if (!confirm('このタスクを削除しますか？')) return;
    await TaskStore.remove(id);
    await Notifier.cancel(id);
    Toast.show('削除しました', 'info');
    await this.render();
  },

  async _edit(task) {
    TaskModal.open('today', null, task);
  },
};

/* =============================================
   やり残しタブ
   ============================================= */
const LeftoverTab = {
  async render() {
    const list  = qs('#leftover-task-list');
    const empty = qs('#leftover-empty');
    list.innerHTML = '';

    const tasks = await TaskStore.getLeftoverTasks();
    empty.hidden = tasks.length > 0;

    for (const task of tasks) {
      const card = createTaskCard(task, {
        showDate:      true,
        longPressSelect: true,
        onSelectChange: () => this._updateBulkUI(),
        onDelete:   () => this._delete(task.id),
        onEdit:     () => this._edit(task),
      });
      list.appendChild(card);
    }

    this._updateBulkUI();
  },

  _updateBulkUI() {
    const selected = qsa('.leftover-list .task-card.selected');
    qs('#btn-delete-selected-leftover').hidden = selected.length === 0;
    qs('#btn-select-all-leftover').textContent =
      selected.length > 0 ? '選択解除' : 'すべて選択';
  },

  async _delete(id) {
    if (!confirm('このタスクを削除しますか？')) return;
    await TaskStore.remove(id);
    Toast.show('削除しました', 'info');
    await this.render();
  },

  async _edit(task) {
    TaskModal.open('today', null, task);
  },

  async selectAll() {
    const cards = qsa('.leftover-list .task-card');
    const allSelected = cards.every(c => c.classList.contains('selected'));
    cards.forEach(c => c.classList.toggle('selected', !allSelected));
    this._updateBulkUI();
  },

  async deleteSelected() {
    const selected = qsa('.leftover-list .task-card.selected');
    if (!selected.length) return;
    if (!confirm(`${selected.length}件を削除しますか？`)) return;
    for (const card of selected) {
      await TaskStore.remove(card.dataset.id);
    }
    Toast.show(`${selected.length}件を削除しました`, 'info');
    await this.render();
  },
};

/* =============================================
   カレンダータブ
   ============================================= */
const FutureTab = {
  _year:  new Date().getFullYear(),
  _month: new Date().getMonth(),
  _selectedDate: null,

  async render() {
    await this._renderCalendar();
  },

  async _renderCalendar() {
    const grid  = qs('#calendar-grid');
    const label = qs('#calendar-month-label');
    grid.innerHTML = '';

    label.textContent = `${this._year}年${this._month+1}月`;

    const futureTasks = await TaskStore.getFutureTasks();
    const tasksByDate = {};
    for (const t of futureTasks) {
      if (!tasksByDate[t.date]) tasksByDate[t.date] = 0;
      tasksByDate[t.date]++;
    }

    // ヘッダー
    ['日','月','火','水','木','金','土'].forEach((d, i) => {
      const h = document.createElement('div');
      h.className = `cal-header ${i===0?'sun':''} ${i===6?'sat':''}`;
      h.textContent = d;
      grid.appendChild(h);
    });

    const firstDay  = new Date(this._year, this._month, 1).getDay();
    const daysInMonth = new Date(this._year, this._month+1, 0).getDate();
    const today     = todayStr();

    // 空白
    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-day empty';
      grid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${this._year}-${String(this._month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dow     = new Date(this._year, this._month, d).getDay();
      const cnt     = tasksByDate[dateStr] || 0;
      const isPast  = dateStr < today;
      const isToday = dateStr === today;

      const cell = document.createElement('div');
      cell.className = [
        'cal-day',
        dow === 0 ? 'sunday'   : '',
        dow === 6 ? 'saturday' : '',
        isToday ? 'today' : '',
        dateStr === this._selectedDate ? 'selected' : '',
        cnt > 0 ? 'has-tasks' : '',
        isPast && !isToday ? 'past' : '',
      ].filter(Boolean).join(' ');

      cell.innerHTML = `<span>${d}</span>${cnt > 0 ? `<span class="cal-count">${cnt}件</span>` : ''}`;

      cell.addEventListener('click', () => this._selectDate(dateStr));
      grid.appendChild(cell);
    }
  },

  async _selectDate(dateStr) {
    this._selectedDate = dateStr;
    await this._renderCalendar();
    await this._renderDayTasks(dateStr);
    qs('#future-day-tasks').hidden = false;
    qs('#future-day-title').textContent = formatDateFull(dateStr);
    qs('#future-day-tasks').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  async _renderDayTasks(dateStr) {
    const list  = qs('#future-task-list');
    const empty = qs('#future-day-empty');
    list.innerHTML = '';

    const all   = await TaskStore.getAll();
    const tasks = all.filter(t => t.type === 'once' && t.date === dateStr)
                     .sort((a,b) => (a.time||'') < (b.time||'') ? -1 : 1);

    empty.hidden = tasks.length > 0;

    for (const task of tasks) {
      const card = createTaskCard(task, {
        longPressCopy: true,
        onDelete: () => this._deleteTask(task.id),
        onEdit:   () => TaskModal.open('future', dateStr, task),
      });
      list.appendChild(card);
    }

    // 選択日へのタスク追加ボタン（パネル内）
    let addWrap = qs('#future-day-add-wrap');
    if (!addWrap) {
      addWrap = document.createElement('div');
      addWrap.id = 'future-day-add-wrap';
      addWrap.style.cssText = 'padding: 10px 0 4px; text-align: center;';
      const addBtn = document.createElement('button');
      addBtn.className = 'add-btn';
      addBtn.id = 'btn-add-future-day';
      addBtn.style.cssText = 'width:100%;justify-content:center;';
      addBtn.textContent = '＋ この日にタスクを追加';
      addBtn.addEventListener('click', () => {
        TaskModal.open('future', FutureTab._selectedDate, null);
      });
      addWrap.appendChild(addBtn);
      qs('#future-day-tasks').appendChild(addWrap);
    }
  },

  async _deleteTask(id) {
    if (!confirm('このタスクを削除しますか？')) return;
    await TaskStore.remove(id);
    await Notifier.cancel(id);
    Toast.show('削除しました', 'info');
    if (this._selectedDate) await this._renderDayTasks(this._selectedDate);
    await this._renderCalendar();
  },

  prevMonth() {
    this._month--;
    if (this._month < 0) { this._month = 11; this._year--; }
    this._selectedDate = null;
    qs('#future-day-tasks').hidden = true;
    this._renderCalendar();
  },
  nextMonth() {
    this._month++;
    if (this._month > 11) { this._month = 0; this._year++; }
    this._selectedDate = null;
    qs('#future-day-tasks').hidden = true;
    this._renderCalendar();
  },
};

/* =============================================
   毎日タブ
   ============================================= */
const DailyTab = {
  async render() {
    const habits = await HabitStore.getAll();
    const strict = habits.filter(h => h.habitType === 'strict');
    const loose  = habits.filter(h => h.habitType === 'loose');

    this._renderList('daily-strict-list', 'daily-strict-empty', strict);
    this._renderList('daily-loose-list',  'daily-loose-empty',  loose);
  },

  _renderList(listId, emptyId, habits) {
    const list  = qs(`#${listId}`);
    const empty = qs(`#${emptyId}`);
    list.innerHTML = '';
    empty.hidden = habits.length > 0;

    const today = todayStr();
    for (const habit of habits) {
      const isDone = (habit.completedDates || []).includes(today);
      const streak = Number(habit.streak) || 0;

      const li = document.createElement('li');
      li.className = 'habit-card';
      li.dataset.id = habit.id;
      li.innerHTML = `
        <button class="habit-done-btn ${isDone ? 'done' : ''}" aria-label="今日の達成をトグル" data-habit-toggle="${escHtml(habit.id)}">
          ${isDone ? '' : '○'}
        </button>
        <div class="habit-body">
          <div class="habit-title">${escHtml(habit.title)}</div>
          <div class="habit-streak">
            ${streak > 0
              ? `🔥 連続 <span class="habit-streak-val">${streak}</span>日`
              : '記録なし'}
          </div>
          ${habit.memo ? `<div class="task-memo-text">${escHtml(habit.memo)}</div>` : ''}
        </div>
        <div class="habit-actions">
          <button class="habit-action-btn" aria-label="編集" data-habit-edit="${escHtml(habit.id)}">✏️</button>
          <button class="habit-action-btn" aria-label="削除" data-habit-delete="${escHtml(habit.id)}">🗑️</button>
        </div>
      `;

      li.querySelector(`[data-habit-toggle]`).addEventListener('click', async () => {
        const updated = await HabitStore.toggleToday(habit.id);
        const nowDone = !!(updated && (updated.completedDates || []).includes(todayStr()));
        // 同じIDの「今日のタスク」があれば完了状態を合わせる
        const t = await TaskStore.getById(habit.id);
        if (t && t.type === 'daily' && t.date === todayStr()) {
          t.status    = nowDone ? 'done' : 'pending';
          t.updatedAt = Date.now();
          await TaskStore.save(t);
        }
        Toast.show(isDone ? '↩️ 取り消しました' : '🎉 今日も達成！', isDone ? 'info' : 'success');
        await this.render();
      });

      li.querySelector(`[data-habit-edit]`).addEventListener('click', async () => {
        const h = await HabitStore.getById(habit.id);
        this._openHabitModal(h);
      });

      li.querySelector(`[data-habit-delete]`).addEventListener('click', async () => {
        if (!confirm('この習慣を削除しますか？')) return;
        await HabitStore.remove(habit.id);
        Toast.show('削除しました', 'info');
        await this.render();
      });

      list.appendChild(li);
    }
  },

  _openHabitModal(editHabit) {
    TaskModal.open('daily', null, editHabit ? {
      id:        editHabit.id,
      title:     editHabit.title,
      memo:      editHabit.memo,
      habitType: editHabit.habitType,
      category:  editHabit.category || 'その他',
      notifications: editHabit.notifications || [],
      status:    'pending',
    } : null);
  },
};

/* =============================================
   検索
   ============================================= */
const SearchPanel = {
  _timer: null,

  open() {
    qs('#search-input').value  = '';
    qs('#search-date').value   = '';
    qs('#search-results').innerHTML = '';
    qs('#search-empty').hidden = true;
    qs('#modal-search').hidden = false;
    setTimeout(() => qs('#search-input').focus(), 320);
  },

  async _doSearch() {
    const q    = qs('#search-input').value.trim();
    const date = qs('#search-date').value;
    const list = qs('#search-results');
    const empty = qs('#search-empty');
    list.innerHTML = '';

    if (!q && !date) { empty.hidden = true; return; }

    const tasks = await TaskStore.search(q, date);
    empty.hidden = tasks.length > 0;

    for (const task of tasks) {
      const card = createTaskCard(task, {
        showDate: true,
        onEdit:   () => TaskModal.open('today', null, task),
        onDelete: async () => {
          if (!confirm('削除しますか？')) return;
          await TaskStore.remove(task.id);
          await this._doSearch();
          Toast.show('削除しました', 'info');
        },
      });
      list.appendChild(card);
    }
  },

  debounceSearch() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._doSearch(), 300);
  },
};

/* =============================================
   統計パネル
   ============================================= */
const StatsPanel = {
  async open() {
    qs('#modal-stats').hidden = false;
    await this._render();
  },

  async _render() {
    const allStats  = await StatsStore.getAll();
    const today     = todayStr();
    const todayData = allStats.find(s => s.date === today);

    // 今日
    if (todayData && todayData.total > 0) {
      const pct = Math.round((todayData.done / todayData.total) * 100);
      qs('#stat-today').textContent = `${pct}%`;
    } else {
      qs('#stat-today').textContent = '—';
    }

    // 今週
    const weekStats = this._getWeekStats(allStats, today);
    qs('#stat-week').textContent = weekStats !== null ? `${weekStats}%` : '—';

    // 今月
    const monthStats = this._getMonthStats(allStats, today);
    qs('#stat-month').textContent = monthStats !== null ? `${monthStats}%` : '—';

    // 詳細
    const detail = qs('#stats-detail');
    const recent = [...allStats].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 14);
    detail.innerHTML = '<strong>直近14日の記録</strong><br><br>' +
      (recent.length
        ? recent.map(s => {
            const total = Number(s.total) || 0;
            const done  = Number(s.done)  || 0;
            const pct = total > 0 ? Math.round(done/total*100) : 0;
            const bar = '■'.repeat(Math.round(pct/10)) + '□'.repeat(10-Math.round(pct/10));
            return `${escHtml(dateLabel(s.date))}　${bar}　${pct}% (${done}/${total})`;
          }).join('<br>')
        : '記録がありません');
  },

  _getWeekStats(all, today) {
    const d = new Date(today + 'T00:00:00');
    const day = d.getDay();
    const mon = new Date(d); mon.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const monStr = this._dateToStr(mon);
    const sunStr = this._dateToStr(sun);
    const w = all.filter(s => s.date >= monStr && s.date <= sunStr);
    if (!w.length) return null;
    const total = w.reduce((a,s) => a + s.total, 0);
    const done  = w.reduce((a,s) => a + s.done,  0);
    return total > 0 ? Math.round(done/total*100) : null;
  },

  _getMonthStats(all, today) {
    const ym = today.slice(0,7);
    const m  = all.filter(s => s.date.startsWith(ym));
    if (!m.length) return null;
    const total = m.reduce((a,s) => a + s.total, 0);
    const done  = m.reduce((a,s) => a + s.done,  0);
    return total > 0 ? Math.round(done/total*100) : null;
  },

  _dateToStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },
};

/* =============================================
   データ管理（バックアップ／復元）
   ============================================= */
const Backup = {
  _pending: null, // インポート確認待ちの正規化済みデータ

  async export() {
    let payload;
    try {
      const tasks      = await TaskStore.getAll();
      const habits     = await HabitStore.getAll();
      const stats      = await StatsStore.getAll();
      const categories = CategoryManager.load();
      payload = {
        app:        'haretasu',
        version:    APP_VERSION,
        exportedAt: new Date().toISOString(),
        data:       { tasks, habits, stats, categories },
      };
    } catch (e) {
      Toast.show('エクスポートに失敗しました', 'warn');
      return;
    }

    const json  = JSON.stringify(payload, null, 2);
    const d     = new Date();
    const fname = `haretasu-backup-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.json`;
    const blob  = new Blob([json], { type: 'application/json' });

    // スマホで確実に保存できるよう、可能ならファイル共有（Files/ドライブ等へ保存）を優先
    try {
      const file = new File([blob], fname, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'ハレタス バックアップ' });
        Toast.show('エクスポートしました ⬇️', 'success');
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // ユーザーがキャンセル
      // それ以外は通常ダウンロードにフォールバック
    }

    // 通常ダウンロード
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    Toast.show('エクスポートしました ⬇️', 'success');
  },

  handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = this._normalize(JSON.parse(reader.result));
      } catch (e) {
        Toast.show('ファイルを読み込めませんでした（JSON形式ではありません）', 'warn');
        return;
      }
      if (!data) {
        Toast.show('ハレタスのバックアップとして認識できませんでした', 'warn');
        return;
      }
      this._pending = data;
      qs('#import-summary').textContent =
        `読み込んだ内容：タスク ${data.tasks.length}件 ／ 習慣 ${data.habits.length}件 ／ 記録 ${data.stats.length}日分 ／ カテゴリ ${data.categories.length}個`;
      qs('#modal-data').hidden = true;
      qs('#modal-import-confirm').hidden = false;
    };
    reader.onerror = () => Toast.show('ファイルの読み込みに失敗しました', 'warn');
    reader.readAsText(file);
  },

  // 正規の形式・多少の揺れ（dataを包まない素のオブジェクト等）を吸収
  _normalize(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const d = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
    const arr = (v) => Array.isArray(v) ? v : [];
    const tasks      = arr(d.tasks);
    const habits     = arr(d.habits);
    const stats      = arr(d.stats);
    const categories = arr(d.categories).filter(c => typeof c === 'string');
    if (!tasks.length && !habits.length && !stats.length && !categories.length) return null;
    return { tasks, habits, stats, categories };
  },

  async apply(mode) { // 'merge' | 'replace'
    const data = this._pending;
    if (!data) return;

    // 念のため現在の全データをメモリに退避（途中で失敗してもここから復旧する）
    let snap;
    try {
      snap = {
        tasks:      await TaskStore.getAll(),
        habits:     await HabitStore.getAll(),
        stats:      await StatsStore.getAll(),
        categories: CategoryManager.load(),
      };
    } catch (e) {
      Toast.show('現在のデータを確認できませんでした。中断します', 'warn');
      return;
    }

    try {
      // 1) まず取り込むデータを書き込む（この段階では何も削除しない）
      for (const t of data.tasks)  { if (t && t.id)   await db.put(STORES.TASKS,  t); }
      for (const h of data.habits) { if (h && h.id)   await db.put(STORES.HABITS, h); }
      for (const s of data.stats)  { if (s && s.date) await db.put(STORES.STATS,  s); }

      // 2) 置き換えモードのみ、書き込み成功後に「ファイルに無い既存データ」だけ削除
      //    （ストアを空にしてから書く方式は、途中失敗でデータが消えるので採用しない）
      if (mode === 'replace') {
        const keepT = new Set(data.tasks .filter(t => t && t.id).map(t => t.id));
        const keepH = new Set(data.habits.filter(h => h && h.id).map(h => h.id));
        const keepS = new Set(data.stats .filter(s => s && s.date).map(s => s.date));
        for (const t of snap.tasks)  { if (!keepT.has(t.id))   await db.delete(STORES.TASKS,  t.id); }
        for (const h of snap.habits) { if (!keepH.has(h.id))   await db.delete(STORES.HABITS, h.id); }
        for (const s of snap.stats)  { if (!keepS.has(s.date)) await db.delete(STORES.STATS,  s.date); }
        await db.clear(STORES.NOTIF); // 通知は再生成される一時データなので破棄してよい
      }

      // カテゴリ
      if (data.categories.length) {
        if (mode === 'replace') {
          CategoryManager.save(data.categories);
        } else {
          const merged = [...snap.categories];
          data.categories.forEach(c => { if (!merged.includes(c)) merged.push(c); });
          CategoryManager.save(merged);
        }
      }

      this._pending = null;
      qs('#modal-import-confirm').hidden = true;
      Toast.show(mode === 'replace' ? '復元しました ✅' : 'インポートしました ✅', 'success');
      await App.refresh();

    } catch (e) {
      // 失敗時はスナップショットの状態に巻き戻す（データ消失を防ぐ）
      try {
        await this._restoreSnapshot(snap);
        Toast.show('インポートに失敗したため、元の状態に戻しました', 'warn', 5000);
      } catch (e2) {
        Toast.show('インポートに失敗しました', 'warn', 5000);
      }
      try { await App.refresh(); } catch (_) {}
    }
  },

  // スナップショット（apply前の状態）へ完全に戻す
  async _restoreSnapshot(snap) {
    for (const t of snap.tasks)  await db.put(STORES.TASKS,  t);
    for (const h of snap.habits) await db.put(STORES.HABITS, h);
    for (const s of snap.stats)  await db.put(STORES.STATS,  s);
    CategoryManager.save(snap.categories);
    // 取り込み途中で増えたレコードを取り除く
    const keepT = new Set(snap.tasks .map(t => t.id));
    const keepH = new Set(snap.habits.map(h => h.id));
    const keepS = new Set(snap.stats .map(s => s.date));
    for (const t of await TaskStore.getAll())  { if (!keepT.has(t.id))   await db.delete(STORES.TASKS,  t.id); }
    for (const h of await HabitStore.getAll()) { if (!keepH.has(h.id))   await db.delete(STORES.HABITS, h.id); }
    for (const s of await StatsStore.getAll()) { if (!keepS.has(s.date)) await db.delete(STORES.STATS,  s.date); }
  },
};

/* =============================================
   アプリメイン
   ============================================= */
const App = {
  _currentTab: 'today',

  async init() {
    await db.open();
    TimePicker._init();
    this._bindTabs();
    this._bindHeader();
    this._bindModals();
    this._bindTaskForm();
    this._bindTodayTab();
    this._bindLeftoverTab();
    this._bindFutureTab();
    this._bindDailyTab();
    this._bindSearch();
    this._bindComplete();
    this._bindData();

    // 毎日リセット確認
    await this._dailyReset();

    // 初期表示
    await TodayTab.render();

    // SW登録
    this._registerSW();

    // 通知確認（初回）
    this._checkNotifPermission();
  },

  async refresh() {
    if (this._currentTab === 'today')    await TodayTab.render();
    if (this._currentTab === 'leftover') await LeftoverTab.render();
    if (this._currentTab === 'future')   await FutureTab.render();
    if (this._currentTab === 'daily')    await DailyTab.render();
  },

  _bindTabs() {
    qsa('.tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tab = btn.dataset.tab;
        this._currentTab = tab;
        qsa('.tab-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        qsa('.tab-panel').forEach(p => {
          const show = p.id === `tab-${tab}`;
          p.classList.toggle('active', show);
          p.hidden = !show;
        });
        if (tab === 'today')    await TodayTab.render();
        if (tab === 'leftover') await LeftoverTab.render();
        if (tab === 'future')   await FutureTab.render();
        if (tab === 'daily')    await DailyTab.render();
      });
    });
  },

  _bindHeader() {
    qs('#btn-search').addEventListener('click', () => SearchPanel.open());
    qs('#btn-stats' ).addEventListener('click', () => StatsPanel.open());
    qs('#btn-settings').addEventListener('click', () => this._openDataModal());
  },

  async _openDataModal() {
    try {
      const tasks  = await TaskStore.getAll();
      const habits = await HabitStore.getAll();
      const stats  = await StatsStore.getAll();
      qs('#data-stats').innerHTML =
        `現在のデータ：タスク <strong>${tasks.length}</strong>件 ／ 習慣 <strong>${habits.length}</strong>件 ／ 記録 <strong>${stats.length}</strong>日分`;
    } catch (e) {
      qs('#data-stats').textContent = '';
    }
    qs('#modal-data').hidden = false;
  },

  _bindData() {
    qs('#btn-export').addEventListener('click', () => Backup.export());
    qs('#btn-import').addEventListener('click', () => qs('#import-file').click());
    qs('#import-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) Backup.handleFile(f);
      e.target.value = ''; // 同じファイルを連続で選び直せるようにリセット
    });
    qs('#btn-import-merge').addEventListener('click', () => Backup.apply('merge'));
    qs('#btn-import-replace').addEventListener('click', () => {
      const d = Backup._pending;
      if (!d) return;
      const msg = '現在のタスク・習慣・記録をすべて削除して、ファイルの内容に置き換えます。\n\n'
        + `置き換え後：タスク ${d.tasks.length}件 ／ 習慣 ${d.habits.length}件 ／ 記録 ${d.stats.length}日分\n\n`
        + 'よろしいですか？';
      if (confirm(msg)) Backup.apply('replace');
    });
  },

  _bindModals() {
    // オーバーレイクリックで閉じる
    qsa('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.hidden = true;
      });
    });
    // 閉じるボタン
    qsa('.modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.modal;
        if (id) qs(`#${id}`).hidden = true;
      });
    });
  },

  _bindTaskForm() {
    // 時間入力ウィジェット：タップでカスタムタイムピッカーを開く
    const timeTrigger = qs('#time-input-trigger');
    const timeDisplay = qs('#task-time-display');
    const timeHidden  = qs('#task-time');
    const timeClear   = qs('#btn-clear-time');

    function _openTimePicker() {
      TimePicker.open(timeHidden.value, (hh, mm) => {
        // 24時間形式で保存（時モードは12時間表示 → 24時間に変換不要、AM/PM未使用で1-12のまま格納）
        // このアプリでは HH:MM 形式で24h保存（保存時に変換）
        // UIは12h表示だが内部は入力どおりHH:MMで格納
        const val = `${hh}:${mm}`;
        timeHidden.value = val;
        timeDisplay.textContent = val;
        timeDisplay.classList.remove('empty');
        timeClear.hidden = false;
      });
    }

    timeTrigger.addEventListener('click',     _openTimePicker);
    timeTrigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _openTimePicker(); }
    });
    timeClear.addEventListener('click', (e) => {
      e.stopPropagation();
      timeHidden.value = '';
      timeDisplay.textContent = '--:--';
      timeDisplay.classList.add('empty');
      timeClear.hidden = true;
    });

    // カテゴリチップ：動的生成のためイベント委譲（長押しメニューはチップ自身で処理）
    qs('#category-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.category-chip-item');
      if (!chip) return;
      qsa('.category-chip-item').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      TaskModal._selectedCategory = chip.dataset.category;
    });

    // カテゴリ追加ボタン
    qs('#btn-add-category').addEventListener('click', () => {
      const input = qs('#new-category-input');
      const name  = input.value.trim();
      if (!name) { Toast.show('カテゴリ名を入力してください', 'warn'); return; }
      if (CategoryManager.add(name)) {
        TaskModal._selectedCategory = name;
        TaskModal._renderCategoryChips();
        input.value = '';
        Toast.show(`「${name}」を追加しました`, 'success');
      } else {
        Toast.show('同じ名前のカテゴリが既にあります', 'warn');
      }
    });

    // Enterキーでカテゴリ追加
    qs('#new-category-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); qs('#btn-add-category').click(); }
    });

    // 習慣タイプチップ
    qsa('.chip-habit').forEach(chip => {
      chip.addEventListener('click', () => {
        qsa('.chip-habit').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        TaskModal._selectedHabit = chip.dataset.habit;
      });
    });

    // 通知追加
    qs('#btn-add-notification').addEventListener('click', () => {
      TaskModal._notifications.push({ minutesBefore: 10 });
      TaskModal._renderNotifications();
    });

    // 通知削除（イベント委譲）
    qs('#notification-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-notif]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.removeNotif, 10);
      TaskModal._notifications.splice(idx, 1);
      TaskModal._renderNotifications();
    });

    // 保存
    qs('#btn-save-task').addEventListener('click', async () => {
      await TaskModal.save();
    });
  },

  _bindTodayTab() {
    qs('#btn-add-today').addEventListener('click', () => {
      TaskModal.open('today', null, null);
    });
  },

  _bindLeftoverTab() {
    qs('#btn-select-all-leftover').addEventListener('click', () => LeftoverTab.selectAll());
    qs('#btn-delete-selected-leftover').addEventListener('click', () => LeftoverTab.deleteSelected());
  },

  _bindFutureTab() {
    // パネル上部のタスク追加（選択日があればその日付、なければ空）
    qs('#btn-add-future').addEventListener('click', () => {
      const date = FutureTab._selectedDate || '';
      TaskModal.open('future', date, null);
    });
    qs('#btn-cal-prev').addEventListener('click', () => FutureTab.prevMonth());
    qs('#btn-cal-next').addEventListener('click', () => FutureTab.nextMonth());
    qs('#btn-close-future-day').addEventListener('click', () => {
      qs('#future-day-tasks').hidden = true;
      FutureTab._selectedDate = null;
      FutureTab._renderCalendar();
    });
  },

  _bindDailyTab() {
    qs('#btn-add-daily').addEventListener('click', () => {
      TaskModal.open('daily', null, null);
    });
  },

  _bindSearch() {
    qs('#search-input').addEventListener('input',  () => SearchPanel.debounceSearch());
    qs('#search-date' ).addEventListener('change', () => SearchPanel._doSearch());
    qs('#btn-clear-search-date').addEventListener('click', () => {
      qs('#search-date').value = '';
      SearchPanel._doSearch();
    });
  },

  _bindComplete() {
    qs('#btn-close-complete').addEventListener('click', () => {
      qs('#overlay-complete').hidden = true;
    });
    qs('#overlay-complete').addEventListener('click', (e) => {
      if (e.target === qs('#overlay-complete')) qs('#overlay-complete').hidden = true;
    });
  },


  async _dailyReset() {
    const lastDate = localStorage.getItem('haretasu_last_date');
    const today    = todayStr();
    if (lastDate !== today) {
      localStorage.setItem('haretasu_last_date', today);
      // 昨日以前の「今日のタスク」を期限切れチェック（何もしない＝getLeftoverで拾われる）
    }
  },

  _registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js')
        .then(reg => {
          console.log('[ハレタス] SW登録完了:', reg.scope);
        })
        .catch(err => {
          console.warn('[ハレタス] SW登録失敗:', err);
        });
    }
  },

  _checkNotifPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      // 初回起動時に案内 Toast（強制リクエストはしない）
      setTimeout(() => {
        Toast.show('通知を有効にするとタスクのリマインダーが届きます', 'info', 5000);
      }, 2000);
    }
  },
};

/* =============================================
   起動
   ============================================= */
document.addEventListener('DOMContentLoaded', async () => {
  await App.init();
});
