import { auth, db, doc, getDoc, setDoc, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from './firebase-config.js';

const STORAGE_KEY = 'modo-vida-save-v1';
const todayKey = new Date().toISOString().slice(0, 10);
const QUALIFICATION_PERCENT = 85;

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
let goalDrag = null;

function cancelGoalDrag() {
  if (!goalDrag) return;
  clearTimeout(goalDrag.timer);
  goalDrag.item.classList.remove('dragging');
  goalDrag.list.classList.remove('drag-active');
  if (goalDrag.item.hasPointerCapture?.(goalDrag.pointerId)) goalDrag.item.releasePointerCapture(goalDrag.pointerId);
  goalDrag = null;
  document.body.classList.remove('goal-dragging');
}

function finishGoalDrag() {
  if (!goalDrag?.active) {
    if (goalDrag) cancelGoalDrag();
    return;
  }
  const { item, list, sectionId } = goalDrag;
  const order = [...list.querySelectorAll('.goal[data-goal-id]')].map(goal => goal.dataset.goalId);
  const section = state.sections.find(candidate => candidate.id === sectionId);
  if (section) {
    const goalsById = new Map(section.goals.map(goal => [goal.id, goal]));
    section.goals = order.map(id => goalsById.get(id)).filter(Boolean);
    updateHistory();
    saveState();
  }
  cancelGoalDrag();
  render();
}

function moveGoalWhileDragging(event) {
  if (!goalDrag?.active) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.goal');
  if (!target || target === goalDrag.item || target.parentElement !== goalDrag.list) return;
  const targetBox = target.getBoundingClientRect();
  const insertAfter = event.clientY > targetBox.top + targetBox.height / 2;
  goalDrag.list.insertBefore(goalDrag.item, insertAfter ? target.nextSibling : target);
}

function startGoalDrag(event, item, list, sectionId) {
  if (state.completedAll || !list || event.button > 0 || event.target.closest('button')) return;
  const pointerId = event.pointerId;
  goalDrag = {
    item,
    list,
    sectionId,
    pointerId,
    active: false,
    timer: setTimeout(() => {
      if (!goalDrag || goalDrag.pointerId !== pointerId) return;
      goalDrag.active = true;
      item.classList.add('dragging');
      list.classList.add('drag-active');
      document.body.classList.add('goal-dragging');
      item.setPointerCapture?.(pointerId);
    }, 350)
  };
}
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
  const record = {
    date: state.date,
    completed: completedCount(),
    total: allGoals().length,
    qualified: state.dayQualified,
    sections: state.sections.map(section => ({ id: section.id, name: section.name, completed: section.goals.filter(goal => goal.done).length, total: section.goals.length }))
  };
  const index = state.history.findIndex(item => item.date === state.date);
  if (index >= 0) state.history[index] = record;
  else state.history.push(record);
  state.history = state.history.slice(-30);
}

function renderObjectiveCharts() {
  const container = document.getElementById('objectiveCharts');
  container.innerHTML = '';
  const charts = [{ id: 'general', name: 'General' }, ...state.sections.map(section => ({ id: section.id, name: section.name }))];
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - offset));
    const key = date.toISOString().slice(0, 10);
    const saved = state.history.find(item => item.date === key);
    if (key === state.date) {
      return { date: key, completed: completedCount(), total: allGoals().length, sections: state.sections.map(section => ({ id: section.id, completed: section.goals.filter(goal => goal.done).length, total: section.goals.length })) };
    }
    return saved || { date: key, completed: 0, total: 0, sections: [] };
  });
  charts.forEach(chart => {
    const values = days.map(day => chart.id === 'general' ? day.completed : day.sections?.find(section => section.id === chart.id)?.completed || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    const max = Math.max(1, ...values);
    const card = document.createElement('article');
    card.className = 'card objective-chart';
    card.innerHTML = `<div class="chart-heading"><div><h2 class="card-title"></h2><p class="card-subtitle">${total} objetivos completados en los últimos 7 días</p></div></div><div class="objective-bars" aria-label="Progreso de los últimos 7 días"></div><div class="chart-legend"><span><i class="legend-completed"></i>Objetivos completados</span></div>`;
    card.querySelector('.card-title').textContent = chart.name;
    const bars = card.querySelector('.objective-bars');
    days.forEach((day, index) => {
      const column = document.createElement('div');
      column.className = 'bar-column';
      const value = values[index];
      column.title = `${value} objetivos completados`;
      column.innerHTML = `<div class="objective-bar"><div class="objective-bar-fill"></div><strong class="bar-value">${value}</strong></div><span>${new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`)).replace('.', '')}</span>`;
      column.querySelector('.objective-bar-fill').style.height = `${value ? Math.max(8, value / max * 100) : 3}%`;
      bars.appendChild(column);
    });
    container.appendChild(card);
  });
}

function renderGoal(goal, editor, sectionId) {
  const item = document.createElement('div');
  item.className = `goal ${goal.done ? 'done' : ''}`;
  item.dataset.goalId = goal.id;
  item.innerHTML = `<button class="check" ${goal.done || state.completedAll ? 'disabled' : ''} aria-label="${goal.done ? 'Objetivo completado por hoy' : 'Completar objetivo'}" data-action="toggle"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3"><path d="m3 8 3.1 3L13 4.5"/></svg></button><span class="goal-name"></span>${editor ? `<button class="goal-x" ${state.completedAll ? 'disabled' : ''} aria-label="Eliminar objetivo" data-action="remove">×</button>` : ''}`;
  item.querySelector('.goal-name').textContent = goal.text;
  item.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleGoal(goal.id));
  if (editor && !state.completedAll) {
    const editButton = document.createElement('button');
    editButton.className = 'goal-edit';
    editButton.type = 'button';
    editButton.setAttribute('aria-label', 'Editar objetivo');
    editButton.dataset.action = 'edit';
    editButton.textContent = '✎';
    editButton.addEventListener('click', () => editGoal(goal.id));
    item.querySelector('.goal-name').after(editButton);
  }
  item.querySelector('[data-action="remove"]')?.addEventListener('click', () => removeGoal(goal.id));
  if (editor && !state.completedAll) {
    item.addEventListener('pointerdown', event => startGoalDrag(event, item, item.parentElement, sectionId));
    item.addEventListener('pointermove', moveGoalWhileDragging);
    item.addEventListener('pointerup', finishGoalDrag);
    item.addEventListener('pointercancel', cancelGoalDrag);
  }
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
    if (editor && !state.completedAll) {
      const editButton = document.createElement('button');
      editButton.className = 'section-edit';
      editButton.type = 'button';
      editButton.setAttribute('aria-label', 'Editar apartado');
      editButton.textContent = '✎';
      editButton.addEventListener('click', () => editSection(section.id));
      block.querySelector('.section-heading').append(editButton);
    }
    if (!section.goals.length) list.innerHTML = '<div class="section-empty">Sin objetivos en este apartado.</div>';
    section.goals.forEach(goal => list.appendChild(renderGoal(goal, editor, section.id)));
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
  document.getElementById('progressRing').style.setProperty('--progress-angle', `${percent * 3.6}deg`);
  document.getElementById('progressRing').setAttribute('aria-valuenow', percent);
  document.getElementById('streakValue').textContent = state.streak;
  document.getElementById('bestValue').textContent = `${state.best} días`;
  document.getElementById('totalValue').textContent = state.total;
  document.getElementById('xpValue').textContent = `${completed * 25} XP`;
  document.getElementById('goalInput').disabled = state.completedAll || !state.sections.length;
  document.getElementById('goalInput').placeholder = state.completedAll ? 'Objetivos bloqueados hasta mañana.' : 'Añade un objetivo...';
  document.querySelector('#goalForm button').disabled = state.completedAll || !state.sections.length;
  document.getElementById('statusDot').classList.toggle('on', state.dayQualified);
  renderObjectiveCharts();
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

function editGoal(id) {
  if (state.completedAll) return;
  const goal = findGoal(id);
  if (!goal) return;
  const text = prompt('Edita el objetivo:', goal.text)?.trim();
  if (!text || text === goal.text) return;
  goal.text = text.slice(0, 80);
  updateHistory();
  saveState();
  render();
}

function editSection(id) {
  if (state.completedAll) return;
  const section = state.sections.find(item => item.id === id);
  if (!section) return;
  const name = prompt('Edita el nombre del apartado:', section.name)?.trim();
  if (!name || name === section.name) return;
  section.name = name.slice(0, 40);
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
  if (pageId === 'statsPage') renderObjectiveCharts();
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
  state.sections.forEach(section => section.goals.forEach(goal => goal.done = false));
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
render();
startCloudSync();
