const STORAGE_KEY = 'modo-vida-save-v1';
const todayKey = new Date().toISOString().slice(0, 10);
const QUALIFICATION_PERCENT = 70;
const defaultGoals = [
  { id: crypto.randomUUID(), text: 'Mover mi cuerpo durante 20 minutos', done: false },
  { id: crypto.randomUUID(), text: 'Tomar suficiente agua', done: false },
  { id: crypto.randomUUID(), text: 'Hacer una cosa importante sin distraerme', done: false }
];
let state = loadState();
let deferredInstallPrompt = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || saved.date !== todayKey) {
      const previous = saved?.dayQualified || saved?.completedAll ? saved.streak : 0;
      return { date: todayKey, goals: defaultGoals, streak: previous, best: saved?.best || previous, total: saved?.total || 0, completedAll: false, dayQualified: false, history: saved?.history || [] };
    }
    saved.history = saved.history || [];
    saved.dayQualified = saved.dayQualified ?? saved.completedAll ?? false;
    saved.completedAll = saved.dayQualified;
    return saved;
  } catch {
    return { date: todayKey, goals: defaultGoals, streak: 0, best: 0, total: 0, completedAll: false, dayQualified: false, history: [] };
  }
}

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function completedCount() { return state.goals.filter(goal => goal.done).length; }
function completionPercent() { return state.goals.length ? Math.round(completedCount() / state.goals.length * 100) : 0; }
function qualifiesForStreak() { return state.goals.length > 0 && completionPercent() >= QUALIFICATION_PERCENT; }

function updateHistory() {
  const record = { date: state.date, completed: completedCount(), total: state.goals.length, qualified: state.dayQualified };
  const index = state.history.findIndex(item => item.date === state.date);
  if (index >= 0) state.history[index] = record;
  else state.history.push(record);
  state.history = state.history.slice(-30);
}

function drawChart() {
  const canvas = document.getElementById('completionChart');
  const empty = document.getElementById('chartEmpty');
  const records = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - offset));
    const key = date.toISOString().slice(0, 10);
    return state.history.find(item => item.date === key) || { date: key, completed: 0 };
  });
  const hasData = records.some(item => item.completed > 0);
  empty.hidden = hasData;
  canvas.hidden = !hasData;
  if (!hasData) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = 180;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const max = Math.max(1, ...records.map(item => item.completed));
  const slot = (width - 42) / records.length;
  const barWidth = Math.min(30, slot - 9);
  records.forEach((item, index) => {
    const x = 21 + index * slot + (slot - barWidth) / 2;
    const barHeight = item.completed ? Math.max(8, item.completed / max * 122) : 2;
    const y = 140 - barHeight;
    ctx.fillStyle = '#d8ff4f';
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, 5);
    ctx.fill();
    ctx.fillStyle = '#8d8d89';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(item.completed, x + barWidth / 2, y - 7);
    const label = new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(new Date(`${item.date}T12:00:00`)).replace('.', '');
    ctx.fillText(label, x + barWidth / 2, 162);
  });
}

function renderGoalList(listId) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  if (!state.goals.length) {
    const message = listId === 'goalListHome' ? 'Tu día empieza con una intención.<br />Añade tu primer objetivo desde Editar objetivos.' : 'Tu día empieza con una intención.<br />Añade tu primer objetivo abajo.';
    list.innerHTML = `<div class="empty">${message}</div>`;
  }
  state.goals.forEach(goal => {
    const item = document.createElement('div');
    item.className = `goal ${goal.done ? 'done' : ''}`;
    item.innerHTML = `<button class="check" ${goal.done || state.completedAll ? 'disabled' : ''} aria-label="${goal.done ? 'Objetivo completado por hoy' : 'Completar objetivo'}" data-action="toggle"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3"><path d="m3 8 3.1 3L13 4.5"/></svg></button><span class="goal-name"></span><button class="goal-x" ${state.completedAll ? 'disabled' : ''} aria-label="Eliminar objetivo" data-action="remove">×</button>`;
    item.querySelector('.goal-name').textContent = goal.text;
    item.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleGoal(goal.id));
    item.querySelector('[data-action="remove"]').addEventListener('click', () => removeGoal(goal.id));
    list.appendChild(item);
  });
}

function render() {
  renderGoalList('goalListHome');
  renderGoalList('goalListEditor');
  const completed = completedCount();
  const percent = completionPercent();
  document.getElementById('progressText').textContent = `${completed} de ${state.goals.length} completados`;
  document.getElementById('progressPercent').textContent = `${percent}%`;
  document.getElementById('progressFill').style.width = `${percent}%`;
  document.getElementById('homeProgressText').textContent = `${completed} de ${state.goals.length} completados`;
  document.getElementById('homeProgressPercent').textContent = `${percent}%`;
  document.getElementById('homeProgressFill').style.width = `${percent}%`;
  document.getElementById('streakValue').textContent = state.streak;
  document.getElementById('bestValue').textContent = `${state.best} días`;
  document.getElementById('totalValue').textContent = state.total;
  document.getElementById('xpValue').textContent = `${completed * 25} XP`;
  document.getElementById('goalInput').disabled = state.completedAll;
  document.getElementById('goalInput').placeholder = state.completedAll ? 'Objetivos bloqueados hasta mañana.' : 'Añade un objetivo para hoy...';
  document.querySelector('#goalForm button').disabled = state.completedAll;
  document.getElementById('statusDot').classList.toggle('on', state.dayQualified);
  document.getElementById('streakMessage').textContent = state.dayQualified ? 'Día completado. Los objetivos se habilitan mañana.' : `Completa al menos el ${QUALIFICATION_PERCENT}% de tus objetivos para encenderla.`;
  drawChart();
}

function toggleGoal(id) {
  const goal = state.goals.find(item => item.id === id);
  if (!goal || goal.done || state.completedAll) return;
  goal.done = true;
  state.total++;
  if (qualifiesForStreak() && !state.dayQualified) {
    state.dayQualified = true;
    state.completedAll = true;
    state.streak++;
    state.best = Math.max(state.best, state.streak);
    updateHistory();
    saveState();
    render();
    showCelebrate();
    return;
  }
  updateHistory();
  saveState();
  render();
}

function removeGoal(id) {
  state.goals = state.goals.filter(goal => goal.id !== id);
  if (!state.dayQualified) state.completedAll = false;
  updateHistory();
  saveState();
  render();
}

function showCelebrate() {
  document.getElementById('celebrate').classList.add('show');
  document.getElementById('closeCelebrate').focus();
}

function openPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    const active = page.id === pageId;
    page.hidden = !active;
    page.classList.toggle('active', active);
  });
  document.querySelectorAll('.menu-link, [data-page].primary-action').forEach(link => {
    if (link.classList.contains('menu-link')) link.classList.toggle('active', link.dataset.page === pageId);
  });
  document.getElementById('mainMenu').classList.remove('open');
  document.getElementById('menuButton').setAttribute('aria-expanded', 'false');
  if (pageId === 'statsPage') drawChart();
}

document.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', () => openPage(link.dataset.page)));
document.getElementById('menuButton').addEventListener('click', () => {
  const menu = document.getElementById('mainMenu');
  const isOpen = menu.classList.toggle('open');
  document.getElementById('menuButton').setAttribute('aria-expanded', String(isOpen));
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  document.getElementById('installButton').hidden = false;
});

document.getElementById('installButton').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('installButton').hidden = true;
});

document.getElementById('notificationButton').addEventListener('click', async () => {
  const button = document.getElementById('notificationButton');
  if (!('Notification' in window)) {
    button.textContent = 'Notificaciones no disponibles';
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    button.textContent = 'Permiso de notificaciones denegado';
    return;
  }
  button.textContent = 'Notificaciones activadas';
  const registration = await navigator.serviceWorker?.ready;
  registration?.showNotification('Modo Vida', { body: 'Te avisaremos cuando vuelvas a la aplicación.', icon: './icon.svg', tag: 'modo-vida-welcome' });
});

window.addEventListener('appinstalled', () => {
  document.getElementById('installButton').hidden = true;
});

document.getElementById('goalForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('goalInput');
  const text = input.value.trim();
  if (!text || state.completedAll) return;
  state.goals.push({ id: crypto.randomUUID(), text, done: false });
  updateHistory();
  input.value = '';
  saveState();
  render();
  input.focus();
});

document.getElementById('closeCelebrate').addEventListener('click', () => document.getElementById('celebrate').classList.remove('show'));
document.getElementById('celebrate').addEventListener('click', event => { if (event.target.id === 'celebrate') event.currentTarget.classList.remove('show'); });
document.getElementById('clearStreakButton').addEventListener('click', () => {
  if (!confirm('¿Eliminar la racha actual y la mejor racha?')) return;
  state.streak = 0;
  state.best = 0;
  saveState();
  render();
  document.getElementById('celebrate').classList.remove('show');
});
document.getElementById('clearTotalButton').addEventListener('click', () => {
  if (!confirm('¿Borrar toda la información de estadísticas?')) return;
  state.goals.forEach(goal => goal.done = false);
  state.streak = 0;
  state.best = 0;
  state.total = 0;
  state.completedAll = false;
  state.dayQualified = false;
  state.history = [];
  saveState();
  render();
});

document.getElementById('todayLabel').textContent = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
window.addEventListener('resize', drawChart);
render();
