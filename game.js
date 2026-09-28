const board = document.querySelector('#game-board');
const balanceElement = document.querySelector('#coin-balance');
const levelElement = document.querySelector('#player-level');
const incomeElement = document.querySelector('#income-rate');
const buyButton = document.querySelector('#buy-button');
const buyCostElement = document.querySelector('#buy-cost');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
const statusText = document.querySelector('#status-text');
const tabs = document.querySelectorAll('.game-tab');
const screens = document.querySelectorAll('.game-screen');
const claimBonusButton = document.querySelector('#claim-bonus-button');
const bonusStatus = document.querySelector('#bonus-status');
const bonusTimer = document.querySelector('#bonus-timer');
const bonusReward = document.querySelector('#bonus-reward');
const resetButton = document.querySelector('#reset-button');

const SLOT_COUNT = 16;
const BASE_BUY_COST = 40;
const AUTO_CLICKER_DURATION = 10 * 60 * 1000;
const STORAGE_KEY = 'merge-plane-state-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const BONUS_REWARDS = [100, 250, 500];
const PLANE_INCOME = Array.from({ length: 61 }, (_, i) => {
  if (i === 0) return 0;
  if (i <= 3) return i;
  return Math.floor(5 * Math.pow(1.45, i - 3));
});
const PLANE_COLORS = ['#56c7ef', '#46b6e3', '#ffcb4d', '#ff9c55', '#fb6c7a', '#bd82ed', '#5f87ff'];

let coins = 120;
let buyCost = BASE_BUY_COST;
let planes = [1];
let playerLevel = 1;
let dailyBonusLastClaim = 0;
let dailyBonusStreak = 0;
let incomeBoostUntil = 0;
let autoClickerUntil = 0;
let autoClickerCharges = 0;
let dragSourceIndex = null;
let dragSourcePlane = null;
let activePointerId = null;
let toastTimer;
let saveTimer;
let cloudStorageAvailable = false;
let selectedRiskIndex = null;
let selectedRiskMultiplier = 2;
let riskIsRolling = false;
let riskRollTimer = null;

function getCloudStorage() {
  return window.Telegram?.WebApp?.CloudStorage || null;
}

function getState() {
  return { coins, buyCost, playerLevel, planes, dailyBonusLastClaim, dailyBonusStreak, incomeBoostUntil, autoClickerUntil, autoClickerCharges };
}

function isValidState(state) {
  return state && Number.isFinite(state.coins) && Number.isFinite(state.buyCost)
    && Number.isFinite(state.playerLevel) && Array.isArray(state.planes)
    && state.planes.every((level) => Number.isInteger(level) && level > 0);
}

function applyState(state) {
  if (!isValidState(state)) return false;
  coins = Math.max(0, state.coins);
  buyCost = Math.max(BASE_BUY_COST, state.buyCost);
  planes = state.planes.slice(0, SLOT_COUNT).filter((level) => level <= 15);
  if (state.planes.length && !planes.length) planes = [1];
  const highestPlaneLevel = Math.max(...planes, 0);
  playerLevel = Math.min(Math.max(1, state.playerLevel), Math.max(1, highestPlaneLevel + 2));
  dailyBonusLastClaim = Number.isFinite(state.dailyBonusLastClaim) ? state.dailyBonusLastClaim : 0;
  dailyBonusStreak = Number.isInteger(state.dailyBonusStreak) ? Math.max(0, state.dailyBonusStreak) : 0;
  incomeBoostUntil = Number.isFinite(state.incomeBoostUntil) ? state.incomeBoostUntil : 0;
  const hasAutoClickerCharges = Number.isInteger(state.autoClickerCharges);
  autoClickerUntil = hasAutoClickerCharges && Number.isFinite(state.autoClickerUntil) ? state.autoClickerUntil : 0;
  autoClickerCharges = hasAutoClickerCharges ? Math.max(0, state.autoClickerCharges) : 0;
  return true;
}

function saveState() {
  const serialized = JSON.stringify(getState());
  localStorage.setItem(STORAGE_KEY, serialized);
  const cloudStorage = getCloudStorage();
  if (cloudStorage && cloudStorageAvailable) {
    try {
      cloudStorage.setItem(STORAGE_KEY, serialized, (error) => {
        if (error) {
          cloudStorageAvailable = false;
          setStatus('Локальное сохранение активно');
        }
      });
    } catch {
      setStatus('Локальное сохранение активно');
    }
  }
}

function resetGame() {
  if (!window.confirm('Сбросить прогресс игры?')) return;

  coins = 120;
  buyCost = BASE_BUY_COST;
  planes = [1, 1];
  playerLevel = 1;
  dailyBonusLastClaim = 0;
  dailyBonusStreak = 0;
  incomeBoostUntil = 0;
  autoClickerUntil = 0;
  autoClickerCharges = 0;
  clearTimeout(riskRollTimer);
  riskRollTimer = null;
  selectedRiskIndex = null;
  riskIsRolling = false;
  saveState();
  render();
  showToast('Прогресс сброшен');
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 150);
}

function loadLocalState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function loadCloudState() {
  const cloudStorage = getCloudStorage();
  if (!cloudStorage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      cloudStorage.getItem(STORAGE_KEY, (error, value) => {
        cloudStorageAvailable = !error;
        if (error || !value) return resolve(null);
        try { resolve(JSON.parse(value)); } catch { resolve(null); }
      });
    } catch {
      cloudStorageAvailable = false;
      resolve(null);
    }
  });
}

async function init() {
  applyState(loadLocalState());
  saveState();
  render();
  const cloudState = await loadCloudState();
  if (applyState(cloudState)) {
    saveState();
    render();
  }
  setStatus(cloudStorageAvailable ? 'Синхронизация включена' : 'Локальное сохранение активно');
}

function setStatus(message) {
  if (statusText) statusText.textContent = message;
}

function formatCoins(value) {
  return Math.floor(value).toLocaleString('ru-RU');
}

function getIncome() {
  const baseIncome = planes.reduce((total, level) => total + (PLANE_INCOME[level] || 0), 0);
  return Date.now() < incomeBoostUntil ? baseIncome * 2 : baseIncome;
}

function updatePlayerLevel(level) {
  if (level <= playerLevel) return;
  autoClickerCharges += level - playerLevel;
  playerLevel = level;
}

function render() {
  board.innerHTML = '';
  const income = getIncome();
  const highestPlaneLevel = Math.max(...planes, 0);
  playerLevel = Math.max(playerLevel, highestPlaneLevel);

  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex += 1) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.slotIndex = slotIndex;

    if (planes[slotIndex]) {
      const displayedLevel = planes[slotIndex];
      slot.append(createPlane(displayedLevel, slotIndex));
    }
    board.append(slot);
  }

  balanceElement.textContent = formatCoins(coins);
  buyCostElement.textContent = formatCoins(buyCost);
  incomeElement.textContent = formatCoins(income);
  levelElement.textContent = playerLevel;
  buyButton.disabled = coins < buyCost || planes.length >= SLOT_COUNT;
  emptyState.hidden = planes.length > 0;
  renderAutoClicker();
  renderRiskUpgrader();
  renderMiniGames();
}

function createAutoClickerPanel() {
  const panel = document.createElement('section');
  panel.className = 'shop-panel auto-clicker-panel';
  panel.innerHTML = '<div class="shop-title"><div class="shop-icon">⟳</div><div><h2>Автокликер</h2><p id="auto-clicker-status"></p></div></div><button id="auto-clicker-button" class="buy-button" type="button"><span>АКТИВИРОВАТЬ</span><span class="buy-cost"><span id="auto-clicker-charges"></span> зарядов</span></button>';
  buyButton.closest('.shop-panel')?.after(panel);
  panel.querySelector('#auto-clicker-button').addEventListener('click', activateAutoClicker);
  return panel;
}

let autoClickerPanel = createAutoClickerPanel();

const RISK_OPTIONS = { 2: 50, 3: 30, 4: 15 };

let riskUpgraderPanel = document.querySelector('#risk-upgrader-panel');

riskUpgraderPanel.querySelectorAll('.risk-multiplier-button').forEach((button) => {
  button.addEventListener('click', () => {
    if (riskIsRolling) return;
    selectedRiskMultiplier = Number(button.dataset.multiplier);
    renderRiskUpgrader();
  });
});
riskUpgraderPanel.querySelector('.risk-gamble-button').addEventListener('click', gambleSelectedPlane);

function renderRiskUpgrader() {
  if (!riskUpgraderPanel) return;
  const planeList = riskUpgraderPanel.querySelector('#upgrader-plane-list');
  const planesSignature = planes.join(',');
  if (planeList.dataset.planesSignature !== planesSignature) {
    planeList.dataset.planesSignature = planesSignature;
    planeList.replaceChildren();
    planes.forEach((level, index) => planeList.append(createPlane(level, index, 'upgrader')));
  }
  const slot = riskUpgraderPanel.querySelector('.risk-upgrader-slot');
  const status = riskUpgraderPanel.querySelector('.risk-upgrader-status');
  const result = riskUpgraderPanel.querySelector('.risk-result');
  const gambleButton = riskUpgraderPanel.querySelector('.risk-gamble-button');
  const selectedLevel = selectedRiskIndex === null ? null : planes[selectedRiskIndex];
  if (selectedRiskIndex !== null && !selectedLevel) selectedRiskIndex = null;

  slot.classList.toggle('has-plane', selectedRiskIndex !== null);
  slot.classList.toggle('is-rolling', riskIsRolling);
  slot.innerHTML = selectedRiskIndex === null
    ? '<span class="risk-slot-placeholder">✦<small>СЛОТ</small></span>'
    : `${createPlaneSvg(selectedLevel, 'risk-slot')}<strong>УРОВЕНЬ ${selectedLevel}</strong>`;
  const chance = RISK_OPTIONS[selectedRiskMultiplier];
  status.textContent = riskIsRolling ? 'Проверяем шанс...' : selectedRiskIndex === null ? 'Выбери самолет' : `Успех: уровень ${selectedLevel} → ${selectedLevel * selectedRiskMultiplier} (${chance}%)`;
  gambleButton.disabled = selectedRiskIndex === null || riskIsRolling;
  riskUpgraderPanel.querySelector('.risk-gamble-label').textContent = `x${selectedRiskMultiplier}`;
  riskUpgraderPanel.querySelectorAll('.risk-multiplier-button').forEach((button) => {
    const isSelected = Number(button.dataset.multiplier) === selectedRiskMultiplier;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
    button.disabled = riskIsRolling;
  });
  if (!riskIsRolling && result.textContent === 'Проверяем шанс...') result.textContent = '';
}

function selectRiskPlane(index) {
  if (riskIsRolling || !planes[index]) return;
  selectedRiskIndex = index;
  render();
  riskUpgraderPanel.querySelector('.risk-upgrader-slot').classList.add('plane-arrive');
  showToast(`Самолет ${planes[index]} уровня помещен в слот`);
}

function gambleSelectedPlane() {
  if (riskIsRolling || selectedRiskIndex === null || !planes[selectedRiskIndex]) return;
  const multiplier = selectedRiskMultiplier;
  const chance = RISK_OPTIONS[multiplier];
  const index = selectedRiskIndex;
  const level = planes[index];
  riskIsRolling = true;
  const result = riskUpgraderPanel.querySelector('.risk-result');
  result.className = 'risk-result is-rolling';
  result.textContent = 'Проверяем шанс...';
  renderRiskUpgrader();
  riskRollTimer = setTimeout(() => {
    riskRollTimer = null;
    riskIsRolling = false;
    const success = Math.random() * 100 < chance;
    if (planes[index] !== level) {
      selectedRiskIndex = null;
      render();
      return;
    }
    if (success) {
      planes[index] = level * multiplier;
      updatePlayerLevel(planes[index]);
    } else {
      planes.splice(index, 1);
    }
    selectedRiskIndex = null;
    render();
    const finalResult = riskUpgraderPanel.querySelector('.risk-result');
    finalResult.className = `risk-result ${success ? 'risk-success' : 'risk-failure'}`;
    finalResult.textContent = success
      ? `УСПЕХ! Уровень ${level} → ${level * multiplier}`
      : 'ПРОВАЛ! Самолет уничтожен';
    scheduleSave();
    showToast(success ? 'Риск оправдан!' : 'Риск не оправдался');
  }, 1400);
}

function renderAutoClicker() {
  if (!autoClickerPanel) return;
  const button = autoClickerPanel.querySelector('#auto-clicker-button');
  const chargesElement = autoClickerPanel.querySelector('#auto-clicker-charges');
  const statusElement = autoClickerPanel.querySelector('#auto-clicker-status');
  const remaining = Math.max(0, autoClickerUntil - Date.now());
  chargesElement.textContent = autoClickerCharges;
  statusElement.textContent = remaining ? `Активен • еще ${formatDuration(remaining)}` : `Доступно зарядов: ${autoClickerCharges}`;
  button.disabled = remaining > 0 || autoClickerCharges < 1;
}

function activateAutoClicker() {
  if (autoClickerCharges < 1 || Date.now() < autoClickerUntil) return;
  autoClickerCharges -= 1;
  autoClickerUntil = Date.now() + AUTO_CLICKER_DURATION;
  render();
  scheduleSave();
  showToast('Автокликер активирован на 10 минут');
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function renderMiniGames() {
  const now = Date.now();
  const bonusRemaining = dailyBonusLastClaim + DAY_MS - now;
  const nextBonus = BONUS_REWARDS[Math.min(dailyBonusStreak, BONUS_REWARDS.length - 1)];
  bonusReward.textContent = `${nextBonus} ✦`;
  claimBonusButton.disabled = bonusRemaining > 0;
  bonusStatus.textContent = bonusRemaining > 0 ? 'Следующий бонус через' : 'Бонус готов';
  bonusTimer.textContent = bonusRemaining > 0 ? formatDuration(bonusRemaining) : `Награда: ${nextBonus} ✦`;

}

function claimDailyBonus() {
  if (Date.now() < dailyBonusLastClaim + DAY_MS) return;
  const now = Date.now();
  if (dailyBonusLastClaim && now - dailyBonusLastClaim > DAY_MS * 2) dailyBonusStreak = 0;
  const reward = BONUS_REWARDS[Math.min(dailyBonusStreak, BONUS_REWARDS.length - 1)];
  dailyBonusStreak += 1;
  dailyBonusLastClaim = now;
  coins += reward;
  render();
  scheduleSave();
  showToast(`Ежедневный бонус: +${reward} монет`);
}

function createPlane(level, index, context = 'board') {
  const plane = document.createElement('div');
  const camouflageClass = level >= 51 && level <= 60 ? 'digital-camouflage' : level >= 41 && level <= 50 ? 'amoeba-camouflage' : level >= 31 && level <= 40 ? 'splinter-camouflage' : '';
  plane.className = `plane${level >= 5 ? ' high-level' : ''}${level >= 6 ? ' jet-plane' : ''}${camouflageClass ? ` ${camouflageClass}` : ''}`;
  plane.draggable = false;
  plane.dataset.index = index;
  plane.innerHTML = `${createPlaneSvg(level, `${context}-${index}`)}<span class="plane-level">${level}</span>`;
  plane.addEventListener('pointerdown', (event) => startDrag(event, index, plane));
  const riskButton = document.createElement('button');
  riskButton.type = 'button';
  riskButton.textContent = 'UP';
  riskButton.title = 'Переместить самолет в апгрейдер';
  riskButton.style.cssText = 'position:absolute;left:50%;bottom:-5px;z-index:2;padding:2px 5px;border:0;border-radius:6px;background:#ff8e4d;color:white;font-size:9px;font-weight:900;cursor:pointer;transform:translateX(-50%);';
  riskButton.addEventListener('pointerdown', (event) => event.stopPropagation());
  riskButton.addEventListener('click', () => selectRiskPlane(index));
  plane.append(riskButton);
  return plane;
}

function createPlaneSvg(level, index) {
  if (level >= 51 && level <= 60) return createDigitalCamouflageJetSvg(level, index);
  if (level >= 41 && level <= 50) return createAmoebaCamouflageJetSvg(level, index);
  if (level >= 31 && level <= 40) return createSplinterCamouflageJetSvg(level, index);
  if (level >= 20) return createStealthBomberSvg(level, index);
  if (level >= 6) return createJetSvg(level, index);

  const color = PLANE_COLORS[(level - 1) % PLANE_COLORS.length];
  const lightColor = level >= 5 ? '#fff3a6' : '#ffffff';
  const gradientId = `plane-gradient-${level}-${index}`;
  const wingId = `wing-gradient-${level}-${index}`;
  return `<svg class="plane-svg" viewBox="0 0 180 130" role="img" aria-label="Самолет ${level} уровня" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${lightColor}" stop-opacity=".95"/><stop offset=".35" stop-color="${color}"/><stop offset="1" stop-color="#17254c"/>
      </linearGradient>
      <linearGradient id="${wingId}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#17254c"/></linearGradient>
      <filter id="plane-shadow-${level}-${index}" x="-20%" y="-30%" width="150%" height="170%"><feDropShadow dx="0" dy="6" stdDeviation="3" flood-color="#17254c" flood-opacity=".28"/></filter>
    </defs>
    <g class="plane-art" filter="url(#plane-shadow-${level}-${index})">
      <ellipse class="plane-ground-shadow" cx="92" cy="111" rx="55" ry="7"/>
      <g class="plane-propeller"><circle cx="27" cy="65" r="10" fill="#ffc642" stroke="#a66a00" stroke-width="3"/><path d="M27 65C9 55 8 47 15 44c8-3 16 9 16 21zM27 65c18 10 19 18 12 21-8 3-16-9-16-21z" fill="#ff8e4d" stroke="#c85436" stroke-width="2"/></g>
      <path d="M35 57C56 44 105 43 139 60l-6 22c-28 8-67 5-99-5z" fill="url(#${gradientId})" stroke="#17254c" stroke-width="3"/>
      <path d="M112 55c8-14 23-17 33-8l3 18-29 8z" fill="#8ce4f5" stroke="#17254c" stroke-width="3"/>
      <path d="M118 55c6-7 13-9 21-5l-1 10-18 5z" fill="#d9f7ff" opacity=".88"/>
      <path d="M75 48L58 20h35l13 28z" fill="url(#${wingId})" stroke="#17254c" stroke-width="3"/>
      <path d="M74 78L54 105h40l14-28z" fill="url(#${wingId})" stroke="#17254c" stroke-width="3"/>
      <path d="M63 27L75 78M91 22L102 78M61 101L75 78M91 106L102 78" fill="none" stroke="#ffc642" stroke-width="4" stroke-linecap="round"/>
      <path d="M133 60l21-10-4 23-18 9z" fill="${color}" stroke="#17254c" stroke-width="3"/>
      <circle cx="44" cy="64" r="5" fill="#fff" opacity=".75"/><path d="M37 84h55" stroke="#fff" stroke-width="3" opacity=".4" stroke-linecap="round"/>
    </g>
  </svg>`;
}

function createSplinterCamouflageJetSvg(level, index) {
  return createCamouflageJetSvg(level, index, 'splinter');
}

function createAmoebaCamouflageJetSvg(level, index) {
  return createCamouflageJetSvg(level, index, 'amoeba');
}

function createDigitalCamouflageJetSvg(level, index) {
  return createCamouflageJetSvg(level, index, 'digital');
}

function createCamouflageJetSvg(level, index, style) {
  const id = `fighter-${style}-${level}-${index}`;
  const palette = style === 'splinter'
    ? { body: '#0f172a', mid: '#1e293b', dark: '#080d18', pattern: '#a855f7', patternAlt: '#334155', accent: '#00f0ff', secondary: '#a855f7', glass: '#67e8f9' }
    : style === 'amoeba'
      ? { body: '#1e293b', mid: '#334155', dark: '#111827', pattern: '#f97316', patternAlt: '#ef4444', accent: '#f97316', secondary: '#ef4444', glass: '#fbbf24' }
      : { body: '#064e3b', mid: '#065f46', dark: '#022c22', pattern: '#10b981', patternAlt: '#eab308', accent: '#a3e635', secondary: '#eab308', glass: '#bef264' };
  const silhouette = style === 'splinter'
    ? 'M171 65L124 55 96 30 81 27 87 56 44 47 15 56 47 65 15 74 44 83 87 74 81 103 96 100 124 75z'
    : style === 'amoeba'
      ? 'M169 65L130 57 101 42 89 27 80 32 85 58 54 52 26 57 48 65 26 73 54 78 85 72 80 98 91 102 102 78 130 73z'
      : 'M171 65L128 58 102 53 88 35 77 28 81 58 47 50 15 56 43 65 15 74 47 80 81 72 77 102 89 96 102 77 128 72z';
  const camouflage = style === 'splinter'
    ? `<path d="M23 65l29-9 13 4-25 10zM48 70l25-10 12 4-26 12zM65 58l26-24 10 17-18 11zM68 74l25 8-18 17-13-18zM100 53l29 5 16 8-42 1zM100 72l39-3-23 11-16 5z" fill="${palette.pattern}"/><path d="M42 69l23-9-8 13zM84 54l13-14 4 13zM103 72l26-4-16 8z" fill="${palette.patternAlt}"/>`
    : style === 'amoeba'
      ? `<path d="M31 63c3-8 13-11 19-6 5 4 3 10-2 13-7 5-18 1-17-7zm35-10c-3-8 5-15 12-12 6 3 9 10 4 15-4 5-13 4-16-3zm25 19c1-8 9-12 15-8 7 4 5 13-2 16-6 2-13-1-13-8zm24-13c2-7 12-9 16-3 4 6-1 13-8 13-6 0-10-4-8-10zm-61 20c4-6 12-6 15-1 3 5-1 10-7 11-6 0-11-5-8-10z" fill="${palette.pattern}"/><path d="M42 62c3-4 8-4 10 0 1 3-2 6-6 6-4 0-6-3-4-6zm48-22c3-3 7-2 8 1 1 4-2 6-5 5-4-1-5-4-3-6zm20 40c2-4 7-4 9-1 1 4-2 7-6 6-3-1-5-3-3-5z" fill="${palette.patternAlt}"/>`
      : `<path d="M29 55h8v8h-8zm16 8h8v8h-8zm16-16h8v8h-8zm8 24h8v8h-8zm8-16h8v8h-8zm8-16h8v8h-8zm8 32h8v8h-8zm8-24h8v8h-8zm8 16h8v8h-8zm8-24h8v8h-8zm8 32h8v8h-8zm8-16h8v8h-8zm8-8h8v8h-8z" fill="${palette.pattern}"/><path d="M37 63h8v8h-8zm24 0h8v8h-8zm16-16h8v8h-8zm16 24h8v8h-8zm16-16h8v8h-8zm16 8h8v8h-8zm16-8h8v8h-8z" fill="${palette.patternAlt}"/>`;
  const details = `<path d="M75 57L54 52 42 58l27 8-27 8 12 7 21-6 15 10 7-15-7-14-15 9z" fill="${palette.mid}" stroke="${palette.dark}" stroke-width="2"/><path d="M111 56l23 7-23 7-15-5z" fill="${palette.glass}" stroke="${palette.dark}" stroke-width="2"/><path d="M59 55l-4-16 8 2 10 17M59 75l-4 16 8-2 10-17" fill="${palette.body}" stroke="${palette.dark}" stroke-width="2"/><path d="M41 61l16 4-16 4M75 42l12 17M75 88l12-17" fill="none" stroke="${palette.accent}" stroke-width="2"/><ellipse cx="49" cy="65" rx="7" ry="4" fill="${palette.dark}" stroke="${palette.secondary}" stroke-width="1.5"/><ellipse cx="64" cy="65" rx="7" ry="4" fill="${palette.dark}" stroke="${palette.secondary}" stroke-width="1.5"/><ellipse cx="49" cy="65" rx="3" ry="2" fill="${palette.accent}"/><ellipse cx="64" cy="65" rx="3" ry="2" fill="${palette.accent}"/>`;
  const accents = style === 'splinter'
    ? `<path d="M20 58l28 7-28 7M43 49l35 12M44 81l34-12M80 31l8 25M81 99l8-27M101 53l25 9M101 77l25-9" fill="none" stroke="${palette.accent}" stroke-width="2.4"/><path d="M29 65h22M118 65h23" stroke="${palette.secondary}" stroke-width="3"/>`
    : style === 'amoeba'
      ? `<path d="M28 58l29 7-29 7M50 52l29 13M50 78l29-13M82 34l7 23M82 96l7-24M105 54l26 11-26 11" fill="none" stroke="${palette.accent}" stroke-width="2.5"/><path d="M29 65h22M119 65h22" stroke="${palette.secondary}" stroke-width="3"/>`
      : `<path d="M22 58h22v3H22zm11 11h24v3H33zm30-19h17v3H63zm2 29h20v3H65zm20-17h19v3H85zm18-9h25v3h-25zm3 23h25v3h-25z" fill="${palette.accent}"/><path d="M27 65h23M118 65h24" stroke="${palette.secondary}" stroke-width="3"/>`;
  const styleLabel = style === 'splinter' ? 'рубленый неоновый' : style === 'amoeba' ? 'пятнистый огненный' : 'пиксельный изумрудный';
  return `<svg class="plane-svg camouflage-svg ${style}-camouflage" viewBox="0 0 180 130" role="img" aria-label="Истребитель ${level} уровня, ${styleLabel} камуфляж" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="${id}-clip"><path d="${silhouette}"/></clipPath>
      <linearGradient id="${id}-body" x1="0" y1="0" x2="0.8" y2="1"><stop stop-color="${palette.mid}"/><stop offset=".45" stop-color="${palette.body}"/><stop offset="1" stop-color="${palette.dark}"/></linearGradient>
      <filter id="${id}-shadow" x="-20%" y="-35%" width="150%" height="190%"><feDropShadow dx="0" dy="6" stdDeviation="3" flood-color="#17202a" flood-opacity=".35"/></filter>
      <filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g filter="url(#${id}-shadow)">
      <path d="${silhouette}" fill="url(#${id}-body)" stroke="${palette.dark}" stroke-width="3" stroke-linejoin="round"/>
      <g clip-path="url(#${id}-clip)">${camouflage}</g>
      ${details}
      <g filter="url(#${id}-glow)">${accents}</g>
    </g>
  </svg>`;
}

function createStealthBomberSvg(level, index) {
  const accent = level % 2 === 0 ? '#64f4ff' : '#b78cff';
  const secondaryAccent = level % 2 === 0 ? '#2e9dff' : '#ff5fd2';
  const bodyId = `stealth-body-${level}-${index}`;
  const glowId = `stealth-glow-${level}-${index}`;
  const shadowId = `stealth-shadow-${level}-${index}`;
  return `<svg class="plane-svg stealth-svg" viewBox="0 0 180 130" role="img" aria-label="Стратегический самолет ${level} уровня" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${bodyId}" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#556477"/><stop offset=".2" stop-color="#18212e"/><stop offset=".65" stop-color="#080d15"/><stop offset="1" stop-color="#020408"/>
      </linearGradient>
      <filter id="${glowId}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="${shadowId}" x="-30%" y="-50%" width="170%" height="200%"><feDropShadow dx="0" dy="8" stdDeviation="4" flood-color="#050911" flood-opacity=".6"/></filter>
    </defs>
    <g class="stealth-art" filter="url(#${shadowId})">
      <path d="M8 92L32 73 57 65 73 45 90 31 107 45 123 65 148 73 172 92 132 85 111 80 90 99 69 80 48 85z" fill="url(#${bodyId})" stroke="#05080e" stroke-width="3" stroke-linejoin="round"/>
      <path d="M90 31L99 65 90 99 81 65z" fill="#121b28" stroke="#566477" stroke-width="1.5"/>
      <path d="M32 73L69 67 81 65 69 80 48 85zM148 73L111 67 99 65 111 80 132 85z" fill="#202d3d" opacity=".72"/>
      <path d="M28 75L65 70 78 66M152 75L115 70 102 66" fill="none" stroke="${accent}" stroke-width="2" filter="url(#${glowId})" opacity=".95"/>
      <path d="M48 83L69 77M132 83L111 77" fill="none" stroke="${secondaryAccent}" stroke-width="2" filter="url(#${glowId})"/>
      <path d="M66 68L78 58 90 63 102 58 114 68" fill="none" stroke="#8395a9" stroke-width="1.5" opacity=".7"/>
      <path d="M73 55L90 48 107 55" fill="none" stroke="${accent}" stroke-width="1.5" opacity=".8"/>
      <path d="M84 63h12" stroke="#e7fbff" stroke-width="2.5" stroke-linecap="round" filter="url(#${glowId})"/>
      <ellipse cx="75" cy="71" rx="7" ry="3" fill="#05080d" stroke="${secondaryAccent}" stroke-width="1.5" filter="url(#${glowId})"/>
      <ellipse cx="105" cy="71" rx="7" ry="3" fill="#05080d" stroke="${secondaryAccent}" stroke-width="1.5" filter="url(#${glowId})"/>
      <path d="M52 87L39 91M128 87L141 91" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" opacity=".75"/>
    </g>
  </svg>`;
}

function createJetSvg(level, index) {
  const jetColors = ['#61e7ff', '#58a6ff', '#9b7cff', '#f05cff', '#ff6f91'];
  const color = jetColors[(level - 6) % jetColors.length];
  const accent = level % 2 === 0 ? '#d9f7ff' : '#ffe27a';
  const bodyId = `jet-body-${level}-${index}`;
  const shadowId = `jet-shadow-${level}-${index}`;
  return `<svg class="plane-svg jet-svg" viewBox="0 0 180 130" role="img" aria-label="Футуристичный самолет ${level} уровня" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${bodyId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffffff"/><stop offset=".22" stop-color="${color}"/><stop offset=".72" stop-color="#26356b"/><stop offset="1" stop-color="#111a3e"/></linearGradient>
      <linearGradient id="jet-wing-${level}-${index}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${accent}"/><stop offset=".35" stop-color="${color}"/><stop offset="1" stop-color="#202957"/></linearGradient>
      <linearGradient id="jet-trail-${level}-${index}" x1="1" y1="0" x2="0" y2="0"><stop stop-color="${accent}" stop-opacity=".9"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>
      <filter id="${shadowId}" x="-30%" y="-40%" width="170%" height="190%"><feDropShadow dx="0" dy="7" stdDeviation="3" flood-color="#101b3d" flood-opacity=".35"/></filter>
    </defs>
    <g class="jet-art" filter="url(#${shadowId})">
      <path class="jet-trail" d="M51 62C34 55 16 57 4 64c18 1 30 7 46 6zM51 71C31 72 18 78 8 87c18-5 31-5 47-8z" fill="url(#jet-trail-${level}-${index})"/>
      <path d="M48 58L106 51 158 64 106 78 48 72z" fill="url(#${bodyId})" stroke="#111a3e" stroke-width="3"/>
      <path d="M104 51L151 33 132 63 99 66z" fill="url(#jet-wing-${level}-${index})" stroke="#111a3e" stroke-width="3"/>
      <path d="M103 76L145 96 128 69 98 66z" fill="url(#jet-wing-${level}-${index})" stroke="#111a3e" stroke-width="3"/>
      <path d="M75 55L88 29 106 53z" fill="${color}" stroke="#111a3e" stroke-width="3"/>
      <path d="M75 74L87 101 105 76z" fill="${color}" stroke="#111a3e" stroke-width="3"/>
      <path d="M151 33L164 39 151 64 137 62z" fill="${accent}" stroke="#111a3e" stroke-width="3"/>
      <path d="M150 96L164 91 151 67 137 69z" fill="${accent}" stroke="#111a3e" stroke-width="3"/>
      <path d="M112 55l29 9-29 4z" fill="#bff7ff" opacity=".9"/>
      <path d="M54 64h48" stroke="#ffffff" stroke-width="3" opacity=".45" stroke-linecap="round"/>
      <circle cx="48" cy="65" r="6" fill="#111a3e"/><circle cx="48" cy="65" r="3" fill="${accent}"/>
    </g>
  </svg>`;
}

function startDrag(event, index, plane) {
  event.preventDefault();
  if (activePointerId !== null || riskIsRolling) return;

  dragSourceIndex = index;
  dragSourcePlane = plane;
  activePointerId = event.pointerId;
  plane.classList.add('dragging');
  plane.setPointerCapture(activePointerId);
  document.body.classList.add('is-dragging');
  document.addEventListener('pointermove', moveDrag);
  document.addEventListener('pointerup', endDrag, { once: true });
  document.addEventListener('pointercancel', endDrag, { once: true });
}

function moveDrag(event) {
  if (event.pointerId !== activePointerId) return;
  event.preventDefault();
  const hoveredSlot = document.elementFromPoint(event.clientX, event.clientY)?.closest('.slot, .risk-upgrader-slot');
  document.querySelectorAll('.drop-target').forEach((slot) => slot.classList.remove('drop-target'));
  if (hoveredSlot) hoveredSlot.classList.add('drop-target');
}

function endDrag(event) {
  if (event.pointerId !== activePointerId) return;
  event.preventDefault();

  const sourceIndex = dragSourceIndex;
  const draggedPlane = dragSourcePlane;
  if (draggedPlane?.hasPointerCapture(activePointerId)) {
    draggedPlane.releasePointerCapture(activePointerId);
  }
  draggedPlane?.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  document.removeEventListener('pointermove', moveDrag);
  document.querySelectorAll('.drop-target').forEach((slot) => slot.classList.remove('drop-target'));

  const dropTarget = document.elementFromPoint(event.clientX, event.clientY);
  const riskSlot = dropTarget?.closest('.risk-upgrader-slot');
  const targetSlot = dropTarget?.closest('.slot');
  const targetIndex = targetSlot ? Number(targetSlot.dataset.slotIndex) : null;
  if (riskSlot) {
    selectRiskPlane(sourceIndex);
  } else if (targetIndex !== null && targetIndex !== sourceIndex) {
    mergePlanes(sourceIndex, targetIndex);
  }
  dragSourceIndex = null;
  dragSourcePlane = null;
  activePointerId = null;
}

/** Объединяет два самолета одного уровня в следующую модель. */
function mergePlanes(sourceIndex, targetIndex) {
  const sourceLevel = planes[sourceIndex];
  const targetLevel = planes[targetIndex];
  if (!sourceLevel || sourceLevel !== targetLevel) {
    showToast(targetLevel ? 'Нужен самолет такого же уровня' : 'Перетащи самолет на другой');
    return;
  }

  planes[targetIndex] = targetLevel + 1;
  planes.splice(sourceIndex, 1);
  updatePlayerLevel(targetLevel + 1);
  render();
  scheduleSave();
  const upgradedPlane = board.querySelector(`[data-index="${targetIndex}"]`);
  upgradedPlane?.classList.add('merge-pop');
  showToast(`Отлично! Самолет ${targetLevel + 1} уровня готов`);
}

function buyPlane(isAutomatic = false, planeLevel = 1) {
  if (coins < buyCost) {
    if (!isAutomatic) showToast('Сначала заработай еще немного монет');
    return;
  }
  if (planes.length >= SLOT_COUNT) {
    if (!isAutomatic) showToast('Ангар заполнен: объедини самолеты');
    return;
  }

  coins -= buyCost;
  buyCost = Math.ceil(buyCost * 1.22 / 5) * 5;
  planes.push(planeLevel);
  render();
  scheduleSave();
  if (!isAutomatic) showToast('Новый самолет в ангаре');
}

function runAutoClicker() {
  // Проверяем таймер автокликера.
  if (!autoClickerUntil || Date.now() >= autoClickerUntil) {
    if (autoClickerUntil) {
      autoClickerUntil = 0;
      runAutoClicker.lastSpawnAt = 0;
      scheduleSave();
      renderAutoClicker();
    }
    return;
  }

  if (planes.length >= SLOT_COUNT) return;

  const now = Date.now();
  if (now - (runAutoClicker.lastSpawnAt || 0) < 3000) return;

  let spawnLevel = 1;
  for (let lvl = 1; lvl <= 6; lvl += 1) {
    const count = planes.filter((planeLevel) => planeLevel === lvl).length;
    if (count >= 10 && lvl < 6) {
      spawnLevel = lvl + 1;
    } else {
      break;
    }
  }

  planes.push(spawnLevel);
  runAutoClicker.lastSpawnAt = now;
  render();
  scheduleSave();
}

/** Каждую секунду начисляет доход всех самолетов на поле. */
function collectIncome() {
  const income = getIncome();
  if (!income) return;
  coins += income;
  render();
  scheduleSave();

  const pop = document.createElement('span');
  pop.className = 'coin-pop';
  pop.textContent = `+${income} ✦`;
  document.querySelector('.balance-card').append(pop);
  setTimeout(() => pop.remove(), 900);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

buyButton.addEventListener('click', buyPlane);
resetButton.addEventListener('click', resetGame);
claimBonusButton.addEventListener('click', claimDailyBonus);
setInterval(collectIncome, 1000);
setInterval(runAutoClicker, 1000);
setInterval(() => {
  renderMiniGames();
  renderAutoClicker();
  if (incomeBoostUntil && Date.now() >= incomeBoostUntil) render();
}, 1000);

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const selectedScreen = tab.dataset.screen;
    tabs.forEach((item) => {
      const isSelected = item === tab;
      item.classList.toggle('is-active', isSelected);
      item.setAttribute('aria-selected', String(isSelected));
    });
    screens.forEach((screen) => {
      const isSelected = screen.id === selectedScreen;
      screen.classList.toggle('is-active', isSelected);
      screen.hidden = !isSelected;
    });
  });
});

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
  document.documentElement.style.setProperty('--telegram-bg', window.Telegram.WebApp.backgroundColor || '#eaf6ff');
}

init();
