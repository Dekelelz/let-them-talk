/**
 * Economy HUD — Credit balance, upgrade popup, transaction history.
 * HTML overlay on top of the Three.js canvas.
 * Always visible in city mode. Polls /api/city/economy for data.
 * Target: zero canvas impact (pure HTML/CSS).
 */

let hudEl = null;
let popupEl = null;
let historyEl = null;
let pollInterval = null;
let visible = false;
let currentBalance = 0;
let historyVisible = false;

const ECON_STYLES = `
  .econ-hud {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 100;
    pointer-events: auto;
    font-family: 'Segoe UI', sans-serif;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  .econ-hud.visible { opacity: 1; }

  .econ-balance {
    background: rgba(0,0,0,0.7);
    border: 1px solid rgba(212,175,55,0.4);
    border-radius: 8px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
    backdrop-filter: blur(8px);
  }
  .econ-balance:hover { border-color: rgba(212,175,55,0.8); }
  .econ-coin {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: linear-gradient(135deg, #FFD700 0%, #D4AF37 50%, #B8860B 100%);
    box-shadow: 0 0 6px rgba(212,175,55,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #000;
  }
  .econ-amount {
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #FFD700;
    text-shadow: 0 0 6px rgba(212,175,55,0.4);
  }
  .econ-label {
    font-size: 10px;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .econ-popup {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(20,20,20,0.95);
    border: 1px solid rgba(212,175,55,0.5);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 400px;
    z-index: 200;
    pointer-events: auto;
    backdrop-filter: blur(12px);
    font-family: 'Segoe UI', sans-serif;
    color: #fff;
    display: none;
  }
  .econ-popup.open { display: block; }
  .econ-popup-title {
    font-size: 16px;
    font-weight: 700;
    color: #FFD700;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .econ-popup-close {
    cursor: pointer;
    font-size: 18px;
    color: #888;
    background: none;
    border: none;
    padding: 4px 8px;
  }
  .econ-popup-close:hover { color: #fff; }

  .econ-upgrade-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .econ-upgrade-item:last-child { border-bottom: none; }
  .econ-upgrade-name {
    font-size: 13px;
    color: #eee;
  }
  .econ-upgrade-desc {
    font-size: 11px;
    color: #888;
    margin-top: 2px;
  }
  .econ-upgrade-btn {
    background: linear-gradient(135deg, #D4AF37, #B8860B);
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    color: #000;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .econ-upgrade-btn:hover { filter: brightness(1.2); }
  .econ-upgrade-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    filter: none;
  }

  .econ-history {
    position: fixed;
    top: 60px;
    right: 12px;
    width: 280px;
    max-height: 300px;
    overflow-y: auto;
    background: rgba(0,0,0,0.85);
    border: 1px solid rgba(212,175,55,0.3);
    border-radius: 8px;
    padding: 12px;
    z-index: 150;
    pointer-events: auto;
    font-family: 'Segoe UI', sans-serif;
    display: none;
    backdrop-filter: blur(8px);
  }
  .econ-history.open { display: block; }
  .econ-history-title {
    font-size: 11px;
    color: #D4AF37;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
  }
  .econ-tx {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 11px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .econ-tx-desc { color: #ccc; }
  .econ-tx-amount.credit { color: #3fb950; }
  .econ-tx-amount.debit { color: #f85149; }
  .econ-tx-time { color: #666; font-size: 10px; }

  .econ-credit-pop {
    position: fixed;
    top: 20%;
    left: 50%;
    transform: translateX(-50%);
    font-size: 24px;
    font-weight: 700;
    color: #3fb950;
    text-shadow: 0 0 10px rgba(63,185,80,0.6);
    pointer-events: none;
    z-index: 300;
    animation: creditPop 1.5s ease-out forwards;
  }
  @keyframes creditPop {
    0% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-40px); }
  }
`;

const UPGRADES = [
  { id: 'speed_boost', name: 'Speed Boost', desc: 'Increase car max speed by 20%', cost: 50 },
  { id: 'building_glow', name: 'Building Neon', desc: 'Add neon glow to your buildings', cost: 100 },
  { id: 'extra_car', name: 'Extra Vehicle', desc: 'Spawn an additional car', cost: 75 },
  { id: 'night_vision', name: 'Night Mode', desc: 'Toggle day/night cycle', cost: 30 },
];

/**
 * Initialize the economy HUD. Call once.
 */
export function initEconomyHUD() {
  if (hudEl) return;

  const style = document.createElement('style');
  style.textContent = ECON_STYLES;
  document.head.appendChild(style);

  // Balance display
  hudEl = document.createElement('div');
  hudEl.className = 'econ-hud';
  hudEl.innerHTML = `
    <div class="econ-balance" id="econ-balance-btn">
      <div class="econ-coin">C</div>
      <div>
        <div class="econ-amount" id="econ-amount">0</div>
        <div class="econ-label">Credits</div>
      </div>
    </div>
  `;
  document.body.appendChild(hudEl);

  // Transaction history panel
  historyEl = document.createElement('div');
  historyEl.className = 'econ-history';
  historyEl.id = 'econ-history';
  historyEl.innerHTML = `
    <div class="econ-history-title">Transaction History</div>
    <div id="econ-tx-list"></div>
  `;
  document.body.appendChild(historyEl);

  // Upgrade popup
  popupEl = document.createElement('div');
  popupEl.className = 'econ-popup';
  popupEl.id = 'econ-popup';
  popupEl.innerHTML = `
    <div class="econ-popup-title">
      <span>Upgrade Shop</span>
      <button class="econ-popup-close" id="econ-popup-close">&times;</button>
    </div>
    <div id="econ-upgrade-list"></div>
  `;
  document.body.appendChild(popupEl);

  // Click handlers
  document.getElementById('econ-balance-btn').addEventListener('click', toggleHistory);
  document.getElementById('econ-popup-close').addEventListener('click', closeUpgradePopup);
}

/**
 * Show the economy HUD (when entering city environment).
 */
export function showEconomyHUD() {
  if (!hudEl) initEconomyHUD();
  hudEl.classList.add('visible');
  visible = true;
  startPolling();
}

/**
 * Hide the economy HUD.
 */
export function hideEconomyHUD() {
  if (hudEl) hudEl.classList.remove('visible');
  if (historyEl) historyEl.classList.remove('open');
  if (popupEl) popupEl.classList.remove('open');
  visible = false;
  historyVisible = false;
  stopPolling();
}

/**
 * Update the balance display.
 * @param {number} balance
 */
export function updateBalance(balance) {
  currentBalance = balance;
  const el = document.getElementById('econ-amount');
  if (el) el.textContent = balance.toLocaleString();
}

/**
 * Show a credit earned popup animation.
 * @param {number} amount
 * @param {string} reason
 */
export function showCreditEarned(amount, reason) {
  const pop = document.createElement('div');
  pop.className = 'econ-credit-pop';
  pop.textContent = '+' + amount + ' ' + (reason || '');
  document.body.appendChild(pop);
  setTimeout(function() { pop.remove(); }, 1500);
}

/**
 * Open the upgrade shop popup.
 */
export function openUpgradePopup() {
  if (!popupEl) return;
  renderUpgrades();
  popupEl.classList.add('open');
}

/**
 * Close the upgrade shop popup.
 */
export function closeUpgradePopup() {
  if (popupEl) popupEl.classList.remove('open');
}

function toggleHistory() {
  historyVisible = !historyVisible;
  if (historyEl) {
    historyEl.classList.toggle('open', historyVisible);
    if (historyVisible) fetchEconomy();
  }
}

function renderUpgrades() {
  const list = document.getElementById('econ-upgrade-list');
  if (!list) return;
  list.innerHTML = UPGRADES.map(function(u) {
    const canAfford = currentBalance >= u.cost;
    return '<div class="econ-upgrade-item">' +
      '<div>' +
        '<div class="econ-upgrade-name">' + escapeHtml(u.name) + '</div>' +
        '<div class="econ-upgrade-desc">' + escapeHtml(u.desc) + '</div>' +
      '</div>' +
      '<button class="econ-upgrade-btn" ' + (canAfford ? '' : 'disabled') +
        ' onclick="window._econBuy(\'' + u.id + '\',' + u.cost + ')">' +
        u.cost + ' C</button>' +
    '</div>';
  }).join('');
}

function renderTransactions(transactions) {
  const list = document.getElementById('econ-tx-list');
  if (!list) return;
  if (!transactions || !transactions.length) {
    list.innerHTML = '<div style="color:#666;font-size:11px">No transactions yet</div>';
    return;
  }
  list.innerHTML = transactions.slice(-20).reverse().map(function(tx) {
    const isCredit = tx.amount > 0;
    const timeStr = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : '';
    return '<div class="econ-tx">' +
      '<div>' +
        '<div class="econ-tx-desc">' + escapeHtml(tx.reason || tx.type || 'transaction') + '</div>' +
        '<div class="econ-tx-time">' + timeStr + '</div>' +
      '</div>' +
      '<div class="econ-tx-amount ' + (isCredit ? 'credit' : 'debit') + '">' +
        (isCredit ? '+' : '') + tx.amount + '</div>' +
    '</div>';
  }).join('');
}

/**
 * Purchase an upgrade via the API.
 */
window._econBuy = function(upgradeId, cost) {
  if (currentBalance < cost) return;
  fetch('/api/city/economy/spend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upgrade: upgradeId, cost: cost })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      updateBalance(data.balance);
      renderUpgrades();
      fetchEconomy();
    }
  })
  .catch(function() {});
};

function startPolling() {
  if (pollInterval) return;
  fetchEconomy();
  pollInterval = setInterval(fetchEconomy, 5000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function fetchEconomy() {
  fetch('/api/city/economy')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) return;
      if (typeof data.total_credits === 'number') updateBalance(data.total_credits);
      if (data.recent_transactions) renderTransactions(data.recent_transactions);
    })
    .catch(function() {});
}

/**
 * Get current balance.
 * @returns {number}
 */
export function getBalance() {
  return currentBalance;
}

/**
 * Dispose the economy HUD.
 */
export function disposeEconomyHUD() {
  hideEconomyHUD();
  if (hudEl) { hudEl.remove(); hudEl = null; }
  if (popupEl) { popupEl.remove(); popupEl = null; }
  if (historyEl) { historyEl.remove(); historyEl = null; }
  delete window._econBuy;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
