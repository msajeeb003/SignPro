/**
 * SignPro Browser Extension - Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  - Maintain extension session (API base URL + extension token)
 *  - Poll the backend on a chrome.alarms schedule for pending signature requests
 *  - Surface chrome notifications when new signature requests arrive
 *  - Track which notifications have already been shown (avoid duplicates)
 *  - Handle notification clicks to open the signing URL in a new tab
 */

const DEFAULT_API_BASE = 'http://localhost:4000';
const POLL_ALARM = 'signpro_poll';
const HEARTBEAT_ALARM = 'signpro_heartbeat';
const DEFAULT_POLL_INTERVAL_MIN = 1;
const HEARTBEAT_INTERVAL_MIN = 5;
const NOTIFICATION_PREFIX = 'signpro_sig_';
const SHOWN_NOTIFICATIONS_KEY = 'shown_notifications';
const POLL_STATE_KEY = 'poll_state';
const SESSION_KEY = 'session';

// ============================================================================
// Lifecycle
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[SignPro] Extension installed/updated:', details.reason);
    await ensureAlarms();
    if (details.reason === 'install') {
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    }
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('[SignPro] Browser started - re-initializing alarms');
    await ensureAlarms();
});

// ============================================================================
// Session management
// ============================================================================

async function getSession() {
    const result = await chrome.storage.sync.get([SESSION_KEY]);
    return result[SESSION_KEY] || null;
}

async function setSession(session) {
    await chrome.storage.sync.set({ [SESSION_KEY]: session });
}

async function clearSession() {
    await chrome.storage.sync.remove([SESSION_KEY]);
    await chrome.storage.local.remove([SHOWN_NOTIFICATIONS_KEY, POLL_STATE_KEY]);
}

async function getPollState() {
    const result = await chrome.storage.local.get([POLL_STATE_KEY]);
    return result[POLL_STATE_KEY] || {
        lastPollAt: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
        unreadCount: 0
    };
}

async function setPollState(state) {
    await chrome.storage.local.set({ [POLL_STATE_KEY]: state });
}

// ============================================================================
// Alarms (polling + heartbeat)
// ============================================================================

async function ensureAlarms() {
    const session = await getSession();
    if (!session?.token) {
        await chrome.alarms.clear(POLL_ALARM);
        await chrome.alarms.clear(HEARTBEAT_ALARM);
        return;
    }
    const interval = session.pollIntervalMinutes || DEFAULT_POLL_INTERVAL_MIN;
    chrome.alarms.create(POLL_ALARM, {
        delayInMinutes: 0.05,
        periodInMinutes: interval
    });
    chrome.alarms.create(HEARTBEAT_ALARM, {
        delayInMinutes: 0.5,
        periodInMinutes: HEARTBEAT_INTERVAL_MIN
    });
    console.log(`[SignPro] Alarms set - polling every ${interval}m`);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
        if (alarm.name === POLL_ALARM) await poll();
        else if (alarm.name === HEARTBEAT_ALARM) await heartbeat();
    } catch (error) {
        console.error('[SignPro] Alarm handler error:', error);
    }
});

// ============================================================================
// API client
// ============================================================================

async function apiFetch(path, options = {}) {
    const session = await getSession();
    if (!session?.token) throw new Error('Not authenticated');
    const base = session.apiBaseUrl || DEFAULT_API_BASE;
    const url = `${base.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${session.token}`,
            'Content-Type': 'application/json',
            'X-SignPro-Extension': '1',
            ...(options.headers || {})
        }
    });
    if (response.status === 401) {
        console.warn('[SignPro] Auth failed - clearing session');
        await clearSession();
        await ensureAlarms();
        throw new Error('Authentication expired');
    }
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API ${response.status}: ${errorText.substring(0, 200)}`);
    }
    return response.json();
}

// ============================================================================
// Polling
// ============================================================================

async function poll() {
    const session = await getSession();
    if (!session?.token) return;

    const state = await getPollState();
    state.lastPollAt = new Date().toISOString();

    try {
        const since = state.lastSuccessAt
            ? `?since=${encodeURIComponent(state.lastSuccessAt)}`
            : '';
        const data = await apiFetch(`/api/webhooks/extension/poll${since}`);

        state.lastSuccessAt = data.pollTimestamp;
        state.consecutiveFailures = 0;
        state.unreadCount = data.unreadCount || 0;
        await setPollState(state);

        await updateBadge(data.pendingSignatures.length, data.unreadCount);
        await chrome.storage.local.set({
            pending_signatures: data.pendingSignatures,
            last_user: data.user,
            last_poll_data: { fetchedAt: new Date().toISOString() }
        });

        await processNotifications(data.pendingSignatures, data.notifications);
    } catch (error) {
        state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
        await setPollState(state);
        console.error('[SignPro] Poll failed:', error.message,
            `(failure ${state.consecutiveFailures})`);

        if (state.consecutiveFailures >= 10) {
            await maybeNotifyConnectionLost();
        }
    }
}

async function heartbeat() {
    try {
        await apiFetch('/api/webhooks/extension/heartbeat', { method: 'POST' });
    } catch (error) {
        console.debug('[SignPro] Heartbeat failed:', error.message);
    }
}

// ============================================================================
// Notifications
// ============================================================================

async function getShownNotifications() {
    const result = await chrome.storage.local.get([SHOWN_NOTIFICATIONS_KEY]);
    return new Set(result[SHOWN_NOTIFICATIONS_KEY] || []);
}

async function recordShownNotification(id) {
    const shown = await getShownNotifications();
    shown.add(id);
    const trimmed = Array.from(shown).slice(-200);
    await chrome.storage.local.set({ [SHOWN_NOTIFICATIONS_KEY]: trimmed });
}

async function processNotifications(pendingSignatures, notifications) {
    const shown = await getShownNotifications();

    for (const sig of pendingSignatures) {
        const notificationKey = `sig_${sig.signature_request_id}`;
        if (shown.has(notificationKey)) continue;
        if (sig.status === 'viewed') continue;
        await showSignatureRequestNotification(sig);
        await recordShownNotification(notificationKey);
    }

    for (const n of notifications) {
        if (n.read_at) continue;
        const notificationKey = `notif_${n.id}`;
        if (shown.has(notificationKey)) continue;
        if (n.subject?.toLowerCase().includes('signed')) {
            await showCompletionNotification(n);
            await recordShownNotification(notificationKey);
        }
    }
}

async function showSignatureRequestNotification(sig) {
    const notificationId = `${NOTIFICATION_PREFIX}${sig.signature_request_id}`;
    try {
        await chrome.notifications.create(notificationId, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
            title: 'Signature Requested',
            message: `${sig.sender_name} sent: "${sig.document_title}"`,
            contextMessage: `Click to sign - expires ${formatDate(sig.expires_at)}`,
            priority: 2,
            requireInteraction: true,
            buttons: [
                { title: 'Sign Now' },
                { title: 'Dismiss' }
            ]
        });
        await chrome.storage.local.set({
            [`notif_data_${notificationId}`]: {
                signing_url: sig.signing_url,
                signature_request_id: sig.signature_request_id,
                document_id: sig.document_id
            }
        });
    } catch (error) {
        console.error('[SignPro] Failed to create notification:', error);
    }
}

async function showCompletionNotification(notif) {
    const notificationId = `${NOTIFICATION_PREFIX}complete_${notif.id}`;
    try {
        await chrome.notifications.create(notificationId, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
            title: 'Document Signed',
            message: notif.subject || 'A document was signed',
            contextMessage: notif.document_title || '',
            priority: 1
        });
    } catch (error) {
        console.error('[SignPro] Failed to create completion notification:', error);
    }
}

async function maybeNotifyConnectionLost() {
    const lastWarned = (await chrome.storage.local.get(['lastConnLostWarning']))?.lastConnLostWarning;
    if (lastWarned && Date.now() - lastWarned < 60 * 60 * 1000) return;
    await chrome.notifications.create('signpro_conn_lost', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: 'SignPro Connection Issue',
        message: 'Cannot reach the SignPro server. Check your network or extension settings.',
        priority: 1
    });
    await chrome.storage.local.set({ lastConnLostWarning: Date.now() });
}

// ============================================================================
// Notification click handlers
// ============================================================================

chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (notificationId.startsWith(NOTIFICATION_PREFIX)) {
        await handleNotificationOpen(notificationId);
    }
    chrome.notifications.clear(notificationId);
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (notificationId.startsWith(NOTIFICATION_PREFIX)) {
        if (buttonIndex === 0) {
            await handleNotificationOpen(notificationId);
        }
    }
    chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
    await chrome.storage.local.remove([`notif_data_${notificationId}`]);
});

async function handleNotificationOpen(notificationId) {
    const result = await chrome.storage.local.get([`notif_data_${notificationId}`]);
    const data = result[`notif_data_${notificationId}`];
    if (data?.signing_url) {
        await chrome.tabs.create({ url: data.signing_url });
    } else {
        const session = await getSession();
        if (session?.frontendUrl) {
            await chrome.tabs.create({ url: session.frontendUrl });
        }
    }
}

// ============================================================================
// Badge
// ============================================================================

async function updateBadge(pendingCount, _unreadCount) {
    const count = pendingCount || 0;
    if (count === 0) {
        await chrome.action.setBadgeText({ text: '' });
        await chrome.action.setTitle({ title: 'SignPro - No pending signatures' });
    } else {
        await chrome.action.setBadgeText({ text: String(Math.min(count, 99)) });
        await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
        await chrome.action.setTitle({
            title: `SignPro - ${count} pending signature${count === 1 ? '' : 's'}`
        });
    }
}

// ============================================================================
// Message handler (from popup/options)
// ============================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        try {
            switch (message?.type) {
                case 'SET_SESSION': {
                    if (!message.token || !message.apiBaseUrl) {
                        return sendResponse({ ok: false, error: 'token and apiBaseUrl required' });
                    }
                    await setSession({
                        token: message.token,
                        apiBaseUrl: message.apiBaseUrl,
                        frontendUrl: message.frontendUrl || message.apiBaseUrl,
                        pollIntervalMinutes: message.pollIntervalMinutes || DEFAULT_POLL_INTERVAL_MIN,
                        userEmail: message.userEmail || null,
                        connectedAt: new Date().toISOString()
                    });
                    await ensureAlarms();
                    await poll();
                    return sendResponse({ ok: true });
                }
                case 'CLEAR_SESSION': {
                    await clearSession();
                    await ensureAlarms();
                    await updateBadge(0, 0);
                    return sendResponse({ ok: true });
                }
                case 'POLL_NOW': {
                    await poll();
                    return sendResponse({ ok: true });
                }
                case 'GET_STATE': {
                    const session = await getSession();
                    const state = await getPollState();
                    const data = await chrome.storage.local.get([
                        'pending_signatures', 'last_user'
                    ]);
                    return sendResponse({
                        ok: true,
                        session: session ? { ...session, token: undefined } : null,
                        state,
                        pendingSignatures: data.pending_signatures || [],
                        user: data.last_user || null
                    });
                }
                case 'MARK_READ': {
                    if (message.notificationIds?.length) {
                        await apiFetch('/api/webhooks/extension/notifications/read', {
                            method: 'POST',
                            body: JSON.stringify({ notification_ids: message.notificationIds })
                        });
                    }
                    return sendResponse({ ok: true });
                }
                case 'OPEN_SIGNING': {
                    if (message.signing_url) {
                        await chrome.tabs.create({ url: message.signing_url });
                    }
                    return sendResponse({ ok: true });
                }
                default:
                    return sendResponse({ ok: false, error: 'Unknown message type' });
            }
        } catch (error) {
            console.error('[SignPro] Message handler error:', error);
            sendResponse({ ok: false, error: error.message });
        }
    })();
    return true;
});

// ============================================================================
// Utilities
// ============================================================================

function formatDate(iso) {
    try {
        const date = new Date(iso);
        return date.toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
    } catch {
        return 'soon';
    }
}
