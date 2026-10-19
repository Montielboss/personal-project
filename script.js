import { auth, db, doc, getDoc, setDoc, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from './firebase-config.js';

const STORAGE_KEY = 'modo-vida-save-v1';
const todayKey = new Date().toISOString().slice(0, 10);
const QUALIFICATION_PERCENT = 70;

function makeId() { return crypto.randomUUID(); }
function makeDefaultSections() {
  return [
    { id: makeId(), name: 'Mañana', goals: [
      { id: makeId(), text: 'Tender la cama', done: false },
      { id: makeId(), text: 'Preparar café', done: false }
    ] },
    { id: makeId(), name: 'Tarde', goals: [
      { id: makeId(), text: 'Mover mi cuerpo durante 20 minutos', done: false },
      { id: makeId(), text: 'Tomar suficiente agua', done: false },
      { id: makeId(), text: 'Hacer una cosa importante sin distraerme', done: false }
    ] }
  ];
}

function migrateSections(saved) {
  if (saved?.sections?.length) return saved.sections;
  if (saved?.goals?.length) return [{ id: makeId(), name: 'Mis objetivos', goals: saved.goals }];
  return makeDefaultSections();
}

function resetSectionsForNewDay(sections) {
  return sections.map(section => ({
    ...section,
    goals: section.goals.map(goal => ({ ...goal, done: false }))
  }));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || saved.date !== todayKey) {
      const previous = saved?.dayQualified || saved?.completedAll ? saved.streak : 0;
      return { date: todayKey, sections: resetSectionsForNewDay(migrateSections(saved)), streak: previous, best: saved?.best || previous, total: saved?.total || 0, completedAll: false, dayQualified: false, history: saved?.history || [] };
    }
    saved.sections = migrateSections(saved);
    saved.history = saved.history || [];
    saved.dayQualified = saved.dayQualified ?? saved.completedAll ?? false;
    saved.completedAll = saved.dayQualified;
    return saved;
  } catch {
    return { date: todayKey, sections: makeDefaultSections(), streak: 0, best: 0, total: 0, completedAll: false, dayQualified: false, history: [] };
  }
}

let state = loadState();
let sectionToDelete = null;
let cloudUser = null;
let cloudSyncStarted = false;
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  syncStateToCloud();
}

function cloudState() {
  return { date: state.date, sections: state.sections, streak: state.streak, best: state.best, total: state.total, completedAll: state.completedAll, dayQualified: state.dayQualified, history: state.history };
}

async function syncStateToCloud() {
  if (!cloudUser) return;
  try {
    await setDoc(doc(db, 'users', cloudUser.uid), { ...cloudState(), updatedAt: new Date().toISOString() });
  } catch (error) {
    console.warn('No se pudo sincronizar con Firebase:', error);
  }
}

async function startCloudSync() {
  if (cloudSyncStarted) return;
  cloudSyncStarted = true;
  try {
    onAuthStateChanged(auth, async user => {
      cloudUser = user || null;
      updateAuthButton();
      if (!user) return;
      const snapshot = await getDoc(doc(db, 'users', user.uid));
      if (snapshot.exists()) {
        state = { ...state, ...snapshot.data() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
      } else await syncStateToCloud();
    });
  } catch (error) {
    console.warn('Firebase no está listo todavía. Se usará el guardado local:', error);
  }
}

function updateAuthButton() {
  const button = document.getElementById('authButton');
  if (!button) return;
  button.textContent = cloudUser ? `Cerrar sesión${cloudUser.displayName ? ` · ${cloudUser.displayName}` : ''}` : 'Iniciar sesión con Google';
  button.classList.toggle('signed-in', Boolean(cloudUser));
}
function allGoals() { return state.sections.flatMap(section => section.goals); }
function completedCount() { return allGoals().filter(goal => goal.done).length; }
function completionPercent() { return allGoals().length ? Math.round(completedCount() / allGoals().length * 100) : 0; }
function qualifiesForStreak() { return allGoals().length > 0 && completionPercent() >= QUALIFICATION_PERCENT; }
function findGoal(id) { for (const section of state.sections) { const goal = section.goals.find(item => item.id === id); if (goal) return goal; } return null; }

function updateHistory() {
  const record = { date: state.date, completed: completedCount(), total: allGoals().length, qualified: state.dayQualified };
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

function renderGoal(goal, editor) {
  const item = document.createElement('div');
  item.className = `goal ${goal.done ? 'done' : ''}`;
  item.innerHTML = `<button class="check" ${goal.done || state.completedAll ? 'disabled' : ''} aria-label="${goal.done ? 'Objetivo completado por hoy' : 'Completar objetivo'}" data-action="toggle"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3"><path d="m3 8 3.1 3L13 4.5"/></svg></button><span class="goal-name"></span>${editor ? `<button class="goal-x" ${state.completedAll ? 'disabled' : ''} aria-label="Eliminar objetivo" data-action="remove">×</button>` : ''}`;
  item.querySelector('.goal-name').textContent = goal.text;
  item.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleGoal(goal.id));
  item.querySelector('[data-action="remove"]')?.addEventListener('click', () => removeGoal(goal.id));
  return item;
}

function renderSections(containerId, editor) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!state.sections.length) {
    container.innerHTML = '<div class="empty">Añade un apartado para organizar tu día.</div>';
    return;
  }
  state.sections.forEach(section => {
    const block = document.createElement('section');
    block.className = 'goal-section';
    block.innerHTML = `<div class="section-heading"><h3>${section.name}</h3>${editor ? '<button class="section-x" type="button" aria-label="Eliminar apartado">×</button>' : ''}</div><div class="goal-list"></div>`;
    const list = block.querySelector('.goal-list');
    if (!section.goals.length) list.innerHTML = '<div class="section-empty">Sin objetivos en este apartado.</div>';
    section.goals.forEach(goal => list.appendChild(renderGoal(goal, editor)));
    block.querySelector('.section-x')?.addEventListener('click', () => removeSection(section.id));
    container.appendChild(block);
  });
}

function renderSectionSelect() {
  const select = document.getElementById('goalSection');
  select.innerHTML = state.sections.map(section => `<option value="${section.id}">${section.name}</option>`).join('');
  select.disabled = state.completedAll || !state.sections.length;
}

function render() {
  renderSections('goalSectionsHome', false);
  renderSections('goalSectionsEditor', true);
  renderSectionSelect();
  const completed = completedCount();
  const percent = completionPercent();
  document.getElementById('progressText').textContent = `${completed} de ${allGoals().length} completados`;
  document.getElementById('progressPercent').textContent = `${percent}%`;
  document.getElementById('progressFill').style.width = `${percent}%`;
  document.getElementById('homeProgressText').textContent = `${completed} de ${allGoals().length} completados`;
  document.getElementById('homeProgressPercent').textContent = `${percent}%`;
  document.getElementById('homeProgressFill').style.width = `${percent}%`;
  document.getElementById('streakValue').textContent = state.streak;
  document.getElementById('bestValue').textContent = `${state.best} días`;
  document.getElementById('totalValue').textContent = state.total;
  document.getElementById('xpValue').textContent = `${completed * 25} XP`;
  document.getElementById('goalInput').disabled = state.completedAll || !state.sections.length;
  document.getElementById('goalInput').placeholder = state.completedAll ? 'Objetivos bloqueados hasta mañana.' : 'Añade un objetivo...';
  document.querySelector('#goalForm button').disabled = state.completedAll || !state.sections.length;
  document.getElementById('statusDot').classList.toggle('on', state.dayQualified);
  drawChart();
}

function toggleGoal(id) {
  const goal = findGoal(id);
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
  state.sections.forEach(section => { section.goals = section.goals.filter(goal => goal.id !== id); });
  if (!state.dayQualified) state.completedAll = false;
  updateHistory();
  saveState();
  render();
}

function removeSection(id) {
  if (state.completedAll) return;
  sectionToDelete = id;
  const section = state.sections.find(item => item.id === id);
  document.getElementById('deleteConfirmText').textContent = `Se eliminarán también los objetivos de “${section?.name || 'este apartado'}”.`;
  document.getElementById('deleteConfirm').hidden = false;
  document.getElementById('confirmDelete').focus();
}

function confirmSectionDelete() {
  if (!sectionToDelete) return;
  state.sections = state.sections.filter(section => section.id !== sectionToDelete);
  sectionToDelete = null;
  document.getElementById('deleteConfirm').hidden = true;
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
  document.querySelectorAll('.menu-link').forEach(link => link.classList.toggle('active', link.dataset.page === pageId));
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

document.getElementById('authButton').addEventListener('click', async () => {
  const button = document.getElementById('authButton');
  try {
    if (cloudUser) await signOut(auth);
    else await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    console.warn('No se pudo iniciar sesión con Google:', error);
    button.textContent = 'No se pudo iniciar sesión';
    setTimeout(updateAuthButton, 2500);
  }
});

document.getElementById('sectionForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('sectionName');
  const name = input.value.trim();
  if (!name || state.completedAll) return;
  state.sections.push({ id: makeId(), name, goals: [] });
  input.value = '';
  saveState();
  render();
  input.focus();
});

document.getElementById('goalForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('goalInput');
  const sectionId = document.getElementById('goalSection').value;
  const text = input.value.trim();
  const section = state.sections.find(item => item.id === sectionId) || state.sections[0];
  if (!text || !section || state.completedAll) return;
  section.goals.push({ id: makeId(), text, done: false });
  updateHistory();
  input.value = '';
  saveState();
  render();
  input.focus();
});

document.getElementById('closeCelebrate').addEventListener('click', () => document.getElementById('celebrate').classList.remove('show'));
document.getElementById('celebrate').addEventListener('click', event => { if (event.target.id === 'celebrate') event.currentTarget.classList.remove('show'); });
document.getElementById('confirmDelete').addEventListener('click', confirmSectionDelete);
document.getElementById('cancelDelete').addEventListener('click', () => {
  sectionToDelete = null;
  document.getElementById('deleteConfirm').hidden = true;
});
document.getElementById('deleteConfirm').addEventListener('click', event => {
  if (event.target.id === 'deleteConfirm') document.getElementById('cancelDelete').click();
});
document.getElementById('todayLabel').textContent = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
window.addEventListener('resize', drawChart);
render();
startCloudSync();
