/**
 * SignPro Browser Extension - Options Page
 *
 * Allows the user to configure their API endpoint, token, and polling interval.
 * Sends a SET_SESSION message to the background worker which then begins polling.
 */

const $ = (sel) => document.querySelector(sel);

const form = $('#connectForm');
const apiBaseUrlInput = $('#apiBaseUrl');
const frontendUrlInput = $('#frontendUrl');
const tokenInput = $('#token');
const pollIntervalInput = $('#pollInterval');
const connectBtn = $('#connectBtn');
const disconnectBtn = $('#disconnectBtn');
const statusEl = $('#status');
const connectedSection = $('#connectedSection');

function showStatus(message, type = 'success') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
}

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

async function loadCurrentSession() {
    try {
        const state = await sendBg({ type: 'GET_STATE' });
        if (state?.ok && state.session) {
            apiBaseUrlInput.value = state.session.apiBaseUrl || '';
            frontendUrlInput.value = state.session.frontendUrl || '';
            tokenInput.placeholder = 'Token already set (enter new to replace)';
            pollIntervalInput.value = state.session.pollIntervalMinutes || 1;
            connectBtn.textContent = 'Update Connection';
            disconnectBtn.classList.remove('hidden');
            renderStatus(state);
        }
    } catch (error) {
        console.error('[options] Failed to load state:', error);
    }
}

function renderStatus(state) {
    if (!state?.session) {
        connectedSection.classList.add('hidden');
        return;
    }
    connectedSection.classList.remove('hidden');
    $('#statusUser').textContent = state.user?.email || state.session.userEmail || 'Loading...';
    $('#statusLastPoll').textContent = state.state?.lastSuccessAt
        ? new Date(state.state.lastSuccessAt).toLocaleString()
        : 'Pending...';
    $('#statusPending').textContent = state.pendingSignatures?.length || 0;
    $('#statusFailures').textContent = state.state?.consecutiveFailures || 0;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    connectBtn.disabled = true;
    showStatus('Connecting...', 'success');

    let apiBaseUrl = apiBaseUrlInput.value.trim().replace(/\/$/, '');
    let frontendUrl = frontendUrlInput.value.trim().replace(/\/$/, '');
    const token = tokenInput.value.trim();
    const pollIntervalMinutes = Math.max(1, parseInt(pollIntervalInput.value, 10) || 1);

    if (!token) {
        const existingState = await sendBg({ type: 'GET_STATE' });
        if (!existingState?.session?.token) {
            showStatus('Token is required', 'error');
            connectBtn.disabled = false;
            return;
        }
    }

    try {
        const testResponse = await fetch(`${apiBaseUrl}/api/webhooks/extension/heartbeat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-SignPro-Extension': '1'
            }
        });
        if (!testResponse.ok) {
            const errorText = await testResponse.text().catch(() => '');
            throw new Error(`Server responded ${testResponse.status}: ${errorText.substring(0, 100)}`);
        }
        const data = await testResponse.json();

        const result = await sendBg({
            type: 'SET_SESSION',
            token,
            apiBaseUrl,
            frontendUrl,
            pollIntervalMinutes,
            userEmail: data.user?.email
        });

        if (!result?.ok) throw new Error(result?.error || 'Failed to save session');

        showStatus(`Connected as ${data.user?.email || 'user'}`, 'success');
        tokenInput.value = '';
        tokenInput.placeholder = 'Token already set (enter new to replace)';
        connectBtn.textContent = 'Update Connection';
        disconnectBtn.classList.remove('hidden');
        setTimeout(() => loadCurrentSession(), 500);
    } catch (error) {
        console.error('[options] Connection failed:', error);
        showStatus(`Connection failed: ${error.message}`, 'error');
    } finally {
        connectBtn.disabled = false;
    }
});

disconnectBtn.addEventListener('click', async () => {
    if (!confirm('Disconnect this extension from SignPro? You will need to reconfigure to receive notifications.')) {
        return;
    }
    try {
        await sendBg({ type: 'CLEAR_SESSION' });
        showStatus('Disconnected', 'success');
        apiBaseUrlInput.value = '';
        frontendUrlInput.value = '';
        tokenInput.value = '';
        tokenInput.placeholder = 'Paste your extension token';
        connectBtn.textContent = 'Connect';
        disconnectBtn.classList.add('hidden');
        connectedSection.classList.add('hidden');
    } catch (error) {
        showStatus(`Disconnect failed: ${error.message}`, 'error');
    }
});

document.addEventListener('DOMContentLoaded', loadCurrentSession);
