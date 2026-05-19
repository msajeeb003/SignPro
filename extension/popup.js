/**
 * SignPro Browser Extension - Popup Script
 *
 * Shows the connection state and a live list of pending signature requests
 * for the connected user. Communicates only with the background service
 * worker (which holds the API token) via chrome.runtime.sendMessage.
 */

const $ = (sel) => document.querySelector(sel);

const loadingEl = $('#loading');
const notConnectedEl = $('#not-connected');
const connectedEl = $('#connected');
const pendingItemsEl = $('#pendingItems');
const emptyStateEl = $('#emptyState');
const userEmailEl = $('#userEmail');
const userStatusEl = document.querySelector('.user-status');
const lastPollEl = $('#lastPoll');
const pendingCountEl = $('#pendingCount');
const connectionStatusEl = $('#connectionStatus');
const dashboardLinkEl = $('#dashboardLink');

async function sendBg(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(response);
        });
    });
}

function show(el) {
    [loadingEl, notConnectedEl, connectedEl].forEach(e => e.classList.add('hidden'));
    el.classList.remove('hidden');
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatExpiry(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const now = new Date();
    const diffMs = date - now;
    const diffHr = diffMs / 3_600_000;
    const diffDay = diffHr / 24;
    let urgencyClass = '';
    let label;
    if (diffMs < 0) {
        return { label: 'Expired', cls: 'expires-urgent' };
    } else if (diffHr < 24) {
        urgencyClass = 'expires-urgent';
        label = `Expires in ${Math.max(1, Math.round(diffHr))}h`;
    } else if (diffDay < 3) {
        urgencyClass = 'expires-warning';
        label = `Expires in ${Math.round(diffDay)}d`;
    } else {
        label = `Expires ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
    return { label, cls: urgencyClass };
}

function formatPollTime(iso) {
    if (!iso) return 'Never';
    const date = new Date(iso);
    const seconds = Math.floor((Date.now() - date) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return date.toLocaleDateString();
}

function renderPendingItem(sig) {
    const expiry = formatExpiry(sig.expires_at);
    const item = document.createElement('div');
    item.className = 'pending-item';
    item.dataset.signingUrl = sig.signing_url;
    item.innerHTML = `
        <div class="pending-item-title">${escapeHtml(sig.document_title)}</div>
        <div class="pending-item-meta">
            From <strong>${escapeHtml(sig.sender_name)}</strong>
            (${escapeHtml(sig.sender_email)})<br>
            ${sig.page_count ? `${sig.page_count} page${sig.page_count === 1 ? '' : 's'} - ` : ''}
            <span class="${expiry.cls || ''}">${escapeHtml(expiry.label)}</span>
        </div>
        <div class="pending-item-actions">
            <button class="btn-sm primary sign-btn">Sign now</button>
            <button class="btn-sm dismiss-btn" title="Dismiss this notification (you'll still be reminded)">Dismiss</button>
        </div>
    `;
    item.querySelector('.sign-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await sendBg({ type: 'OPEN_SIGNING', signing_url: sig.signing_url });
        window.close();
    });
    item.querySelector('.dismiss-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        item.style.opacity = '0.4';
    });
    item.addEventListener('click', async () => {
        await sendBg({ type: 'OPEN_SIGNING', signing_url: sig.signing_url });
        window.close();
    });
    return item;
}

function renderState({ session, state, pendingSignatures, user }) {
    if (!session) {
        show(notConnectedEl);
        connectionStatusEl.textContent = 'Disconnected';
        connectionStatusEl.classList.add('error');
        return;
    }

    show(connectedEl);

    const email = user?.email || session.userEmail || 'Connected';
    userEmailEl.textContent = email;

    const hasError = state?.consecutiveFailures > 0;
    userStatusEl.classList.toggle('error', hasError);
    if (hasError) {
        connectionStatusEl.textContent = `${state.consecutiveFailures} failed polls`;
        connectionStatusEl.classList.add('error');
    } else {
        connectionStatusEl.textContent = 'Connected';
        connectionStatusEl.classList.remove('error');
    }

    lastPollEl.textContent = formatPollTime(state?.lastSuccessAt);

    pendingItemsEl.innerHTML = '';
    if (!pendingSignatures || pendingSignatures.length === 0) {
        emptyStateEl.classList.remove('hidden');
        pendingCountEl.textContent = '';
    } else {
        emptyStateEl.classList.add('hidden');
        pendingCountEl.textContent = pendingSignatures.length;
        for (const sig of pendingSignatures) {
            pendingItemsEl.appendChild(renderPendingItem(sig));
        }
    }

    dashboardLinkEl.href = session.frontendUrl || session.apiBaseUrl || '#';
}

async function refresh() {
    show(loadingEl);
    try {
        await sendBg({ type: 'POLL_NOW' });
        const state = await sendBg({ type: 'GET_STATE' });
        if (state?.ok) renderState(state);
    } catch (error) {
        console.error('[popup] refresh failed:', error);
        show(notConnectedEl);
    }
}

async function init() {
    try {
        const state = await sendBg({ type: 'GET_STATE' });
        if (state?.ok) renderState(state);
    } catch (error) {
        console.error('[popup] init failed:', error);
        show(notConnectedEl);
    }
}

$('#connectBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

$('#settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

$('#refreshBtn').addEventListener('click', refresh);

dashboardLinkEl.addEventListener('click', (e) => {
    e.preventDefault();
    const url = dashboardLinkEl.getAttribute('href');
    if (url && url !== '#') chrome.tabs.create({ url });
});

document.addEventListener('DOMContentLoaded', init);
