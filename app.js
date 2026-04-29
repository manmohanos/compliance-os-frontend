/**
 * GIFT City Compliance OS — Dashboard Application
 * Connects to FastAPI backend at /api/circulars
 */

// ── Configuration ─────────────────────────────────────────
// Change API_BASE to your Render.com URL before deploying:
//   https://giftcity-compliance-api.onrender.com
const CONFIG = {
    API_BASE: 'https://giftcity-compliance-api.onrender.com',
    SUPABASE_URL: 'https://eitutowmqiqxdpbeokcv.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpdHV0b3dtcWlxeGRwYmVva2N2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MjEyNTUsImV4cCI6MjA5MTk5NzI1NX0.EDvtrRUJGDZavcpSIXpR9Bc5ZXxHnCsD3SUqtJv-D2M',
};

// ── Cold Start Handler ──────────────────────────────────
let coldStartTimer = null;
function showColdStartBanner() {
    let banner = document.getElementById('coldStartBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'coldStartBanner';
        banner.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#00D4AA;color:#0F172A;padding:10px 20px;border-radius:20px;font-weight:600;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,212,170,0.3);';
        banner.textContent = 'Waking up server... (~10s first load)';
        document.body.appendChild(banner);
    }
    banner.style.display = 'block';
}

function hideColdStartBanner() {
    clearTimeout(coldStartTimer);
    const banner = document.getElementById('coldStartBanner');
    if (banner) banner.style.display = 'none';
}

const originalFetch = window.fetch;
window.fetch = async function(...args) {
    if (typeof args[0] === 'string' && args[0].includes(CONFIG.API_BASE)) {
        coldStartTimer = setTimeout(showColdStartBanner, 3000);
    }
    try {
        return await originalFetch.apply(this, args);
    } finally {
        hideColdStartBanner();
    }
};

// ── State ────────────────────────────────────────────────
let state = {
    circulars: [],
    stats: {},
    currentPage: 1,
    totalPages: 0,
    filters: { severity: '', document_type: '' },
    loading: false,
    readItems: new Set(JSON.parse(localStorage.getItem('compliance_os_read_items') || '[]')),
    activeId: null,
    urgentFilterActive: false
};

// ── API Functions ────────────────────────────────────────

async function fetchCirculars(page = 1) {
    state.loading = true;
    renderLoading();

    const params = new URLSearchParams({
        page: page.toString(),
        page_size: '20',
    });

    if (state.filters.severity) params.set('severity', state.filters.severity);
    if (state.filters.document_type) params.set('document_type', state.filters.document_type);

    try {
        const res = await fetch(`${CONFIG.API_BASE}/api/circulars?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        state.circulars = data.items || [];
        state.currentPage = data.page;
        state.totalPages = data.total_pages;
        state.loading = false;

        renderTable();
        renderPagination();
        updateLastUpdated();
        renderUrgentBanner();

        // ── Phase 2C: URL Check
        if (!state.activeId && parseInt(page) === 1) {
            const urlParams = new URLSearchParams(window.location.search);
            const circularId = urlParams.get('circular');
            if (circularId) openDetail(circularId);
        }
    } catch (err) {
        console.error('Failed to fetch circulars:', err);
        state.loading = false;
        renderError(err.message);
    }
}

async function fetchStats() {
    try {
        const res = await fetch(`${CONFIG.API_BASE}/api/stats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.stats = await res.json();
        renderStats();
    } catch (err) {
        console.error('Failed to fetch stats:', err);
    }
}

async function fetchCircularDetail(id) {
    try {
        const res = await fetch(`${CONFIG.API_BASE}/api/circulars/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error('Failed to fetch detail:', err);
        return null;
    }
}

// ── Rendering Functions ──────────────────────────────────

function renderStats() {
    const s = state.stats;
    document.getElementById('statTotal').textContent = s.total_circulars ?? '--';
    document.getElementById('statCritical').textContent = s.severity_breakdown?.critical ?? '--';
    document.getElementById('statModerate').textContent = s.severity_breakdown?.moderate ?? '--';
    document.getElementById('statRecent').textContent = s.recent_7_days ?? '--';
}

function renderTable() {
    const tbody = document.getElementById('circularsBody');

    let displayList = state.circulars;
    if (state.urgentFilterActive) {
        displayList = displayList.filter(item => {
            const alerts = item.processed_alerts;
            const alert = Array.isArray(alerts) ? alerts[0] : (alerts || {});
            const sev = (alert.severity || '').toLowerCase();
            return (sev === 'critical' || sev === 'high') && !state.readItems.has(item.id);
        });
    }

    if (displayList.length === 0) {
        tbody.innerHTML = `
            <tr class="loading-row">
                <td colspan="3">
                    <div class="empty-state">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <p>No circulars match your filters.</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = displayList.map(item => {
        // Supabase may return processed_alerts as array or single object
        const alerts = item.processed_alerts;
        const alert = Array.isArray(alerts) ? alerts[0] : alerts;
        const severity = alert?.severity || 'advisory';
        const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
        const formattedDate = formatDate(item.published_date);
        const docType = item.document_type || 'circular';

        const isRead = state.readItems.has(item.id);
        const isActive = state.activeId === item.id;
        const rowClasses = `circular-row ${!isRead ? 'unread' : ''} ${isActive ? 'active' : ''}`.trim();

        return `
            <tr class="${rowClasses}" data-id="${item.id}" onclick="openDetail('${item.id}')">
                <td>
                    <span class="severity-badge ${severity}">${severity.substring(0,3)}</span>
                </td>
                <td>
                    <div class="circular-title">${escapeHtml(item.title)}</div>
                </td>
                <td>
                    <span class="circular-date">${formattedDate}</span>
                </td>
            </tr>`;
    }).join('');
}

function renderUrgentBanner() {
    const banner = document.getElementById('urgentBanner');
    if (!banner || !state.circulars) return;

    if (state.urgentFilterActive) {
        banner.className = 'urgent-banner clear-active';
        banner.innerHTML = `<span>Showing urgent unread items.</span> <a onclick="event.stopPropagation(); filterUrgent(false)">Clear filter</a>`;
        return;
    }
    
    // Count unread critical/high
    const unreadUrgent = state.circulars.filter(item => {
        const alerts = item.processed_alerts;
        const alert = Array.isArray(alerts) ? alerts[0] : (alerts || {});
        const sev = (alert.severity || '').toLowerCase();
        return (sev === 'critical' || sev === 'high') && !state.readItems.has(item.id);
    });
    
    const count = unreadUrgent.length;
    
    if (count > 0) {
        banner.className = 'urgent-banner';
        banner.innerHTML = `<span>⚠ ${count} critical circular${count>1?'s':''} require your attention this week</span> <span>Filter &rarr;</span>`;
    } else {
        banner.className = 'urgent-banner clear-active';
        banner.innerHTML = `<span>✓ You are up to date. No critical items pending.</span>`;
    }
}

window.filterUrgent = function(forceState) {
    if (forceState !== undefined) {
        state.urgentFilterActive = forceState;
    } else {
        if (document.getElementById('urgentBanner').className.includes('clear-active')) return;
        state.urgentFilterActive = true;
    }
    renderTable();
    renderUrgentBanner();
}

function renderPagination() {
    const container = document.getElementById('pagination');
    if (state.totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button class="page-btn" ${state.currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(${state.currentPage - 1})">Prev</button>`;

    for (let i = 1; i <= state.totalPages; i++) {
        if (i <= 3 || i >= state.totalPages - 1 || Math.abs(i - state.currentPage) <= 1) {
            html += `<button class="page-btn ${i === state.currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
        } else if (i === 4 && state.currentPage > 5) {
            html += `<span style="color:var(--text-muted);padding:0 4px;">...</span>`;
        }
    }

    html += `<button class="page-btn" ${state.currentPage >= state.totalPages ? 'disabled' : ''} onclick="goToPage(${state.currentPage + 1})">Next</button>`;
    container.innerHTML = html;
}

function renderLoading() {
    document.getElementById('circularsBody').innerHTML = `
        <tr class="loading-row">
            <td colspan="5">
                <div class="loading-spinner"></div>
                <span>Loading circulars...</span>
            </td>
        </tr>`;
}

function renderError(msg) {
    document.getElementById('circularsBody').innerHTML = `
        <tr class="loading-row">
            <td colspan="5">
                <div class="empty-state">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    <p style="color:#EF4444;">Failed to load data</p>
                    <p style="font-size:12px;">${escapeHtml(msg)}</p>
                </div>
            </td>
        </tr>`;
}

function updateLastUpdated() {
    const el = document.getElementById('lastUpdated');
    const now = new Date();
    el.querySelector('span').textContent = `Updated ${now.toLocaleTimeString()}`;
}

// ── Detail Pane ─────────────────────────────────────────

async function openDetail(id) {
    const content = document.getElementById('detailPane');

    state.activeId = id;
    state.readItems.add(id);
    localStorage.setItem('compliance_os_read_items', JSON.stringify([...state.readItems]));
    renderTable(); 
    renderUrgentBanner();

    // ── Phase 2C: Update URL 
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('circular', id);
    window.history.pushState({ path: newUrl.href }, '', newUrl.href);

    content.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';

    const data = await fetchCircularDetail(id);
    if (!data) {
        content.innerHTML = '<div class="empty-detail"><p style="color:var(--text-muted);">Circular not found. It may have been removed or the link is outdated.</p></div>';
        return;
    }

    const alerts = data.processed_alerts;
    const alert = Array.isArray(alerts) ? alerts[0] : (alerts || {});
    const severity = alert.severity || 'advisory';
    const severityLabel = severity.toUpperCase();

    let provisionsHtml = '';
    const provisions = alert.key_provisions || [];
    if (provisions.length) {
        provisionsHtml = `
            <div class="modal-section">
                <div class="modal-section-title">Key Provisions</div>
                <ul class="modal-provisions">
                    ${provisions.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
                </ul>
            </div>`;
    }

    let deadlineHtml = '';
    if (alert.deadline) {
        deadlineHtml = `
            <div class="modal-section">
                <div class="modal-deadline">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Deadline: ${formatDate(alert.deadline)}
                </div>
            </div>`;
    }

    const entities = alert.affected_entity_types || [];
    const entityNames = {
        'fme': 'Fund Management Entity',
        'capital_market': 'Capital Market Intermediary',
        'other': 'Other GIFT City Entity',
    };

    const aiSummaryText = alert.summary ? alert.summary : null;
    let userEmailString = window.USER_EMAIL ? window.USER_EMAIL.split('@')[0] : '';
    
    const emailDraftText = `Subject: ${data.id || 'Update'} — ${data.title} | Action Required\n\nTeam,\n\nA new regulatory circular has been issued that may require our attention.\n\nCircular: ${data.title}\nReference: ${data.id || 'N/A'}\nDate: ${formatDate(data.published_date)}\nIssuing Authority: ${data.issuing_authority || 'IFSCA'}\nSeverity: ${severityLabel}\n\nSummary:\n${alert.summary ? alert.summary : (data.title)}\n\nPlease review and advise on applicability.\n\n${userEmailString}`;

    const printHeaderHtml = `
        <div class="print-header">
            <h1>Compliance OS | GIFT City Regulatory Intelligence</h1>
            <p>Printed: ${new Date().toLocaleDateString('en-IN')} | Reference: ${data.id || 'N/A'}</p>
        </div>
    `;

    const toolbarHtml = `
        <div class="detail-toolbar">
            <button class="btn-toolbar" id="btnCopySummary" ${!aiSummaryText ? 'disabled title="AI summary not available for this circular"' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span class="btn-label">Copy AI Summary</span>
            </button>
            <button class="btn-toolbar" id="btnCopyEmail">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span class="btn-label">Copy Email Draft</span>
            </button>
            <button class="btn-toolbar" onclick="window.print()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                <span>Export PDF</span>
            </button>
        </div>
    `;

    content.innerHTML = toolbarHtml + printHeaderHtml + `
        <div class="modal-severity">
            <span class="severity-badge ${severity}">${severityLabel}</span>
        </div>
        <h2 class="modal-title">${escapeHtml(data.title)}</h2>
        <div class="modal-meta">
            <span>Published: ${formatDate(data.published_date)}</span>
            <span>Type: ${data.document_type}</span>
            ${data.pdf_url ? `<a href="${data.pdf_url}" target="_blank" style="color:var(--accent-blue);">Download PDF</a>` : ''}
        </div>

        ${alert.summary ? `
            <div class="modal-section">
                <div class="modal-section-title">Summary</div>
                <div class="modal-highlight ${severity}">
                    <div class="modal-section-body">${escapeHtml(alert.summary)}</div>
                </div>
            </div>` : ''}

        ${alert.what_changed ? `
            <div class="modal-section">
                <div class="modal-section-title">What Changed</div>
                <div class="modal-section-body">${escapeHtml(alert.what_changed)}</div>
            </div>` : ''}

        ${alert.action_required ? `
            <div class="modal-section">
                <div class="modal-section-title">Action Required</div>
                <div class="modal-highlight critical">
                    <div class="modal-section-body">${escapeHtml(alert.action_required)}</div>
                </div>
            </div>` : ''}

        ${deadlineHtml}
        ${provisionsHtml}

        ${entities.length ? `
            <div class="modal-section">
                <div class="modal-section-title">Affected Entity Types</div>
                <div class="modal-entities">
                    ${entities.map(e => `<span class="entity-tag">${entityNames[e] || e}</span>`).join('')}
                </div>
            </div>` : ''}
    `;

    // ── Phase 2D: Initialize AI Chat Panel
    state.chatHistory = [];
    const chatPanelHtml = `
        <div class="chat-panel">
            <div class="chat-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Ask AI about this circular
            </div>
            
            <div class="chat-messages" id="chatMessages">
                <div class="chat-chips" id="chatChips">
                    <div class="chat-chip">What are the key compliance deadlines?</div>
                    <div class="chat-chip">Which entity types does this apply to?</div>
                    <div class="chat-chip">What action do I need to take?</div>
                </div>
            </div>
            
            <div class="chat-input-row">
                <input type="text" id="chatInput" class="chat-input" placeholder="e.g. Does this apply to Category II AIFs?">
                <button id="btnAskAI" class="btn-ask">Ask</button>
            </div>
        </div>
    `;
    
    content.innerHTML += chatPanelHtml;

    // ── Phase 2A: Attach Copy Listeners
    const btnSummary = document.getElementById('btnCopySummary');
    if (btnSummary && !btnSummary.disabled) {
        btnSummary.addEventListener('click', async () => {
            await navigator.clipboard.writeText(aiSummaryText);
            const lbl = btnSummary.querySelector('.btn-label');
            const old = lbl.textContent;
            lbl.textContent = "Copied ✓";
            setTimeout(() => lbl.textContent = old, 2000);
        });
    }

    const btnEmail = document.getElementById('btnCopyEmail');
    if (btnEmail) {
        btnEmail.addEventListener('click', async () => {
            await navigator.clipboard.writeText(emailDraftText);
            const lbl = btnEmail.querySelector('.btn-label');
            const old = lbl.textContent;
            lbl.textContent = "Copied ✓";
            setTimeout(() => lbl.textContent = old, 2000);
        });
    }

    // ── Phase 2D: Attach Chat Listeners
    setupChatListeners(data, alert);
}

// ── Phase 2D: Chat Logic ─────────────────────────────────

function setupChatListeners(data, alert) {
    const input = document.getElementById('chatInput');
    const btnAsk = document.getElementById('btnAskAI');
    const messagesContainer = document.getElementById('chatMessages');
    const chipsContainer = document.getElementById('chatChips');
    
    const submitChat = async (question) => {
        if (!question.trim()) return;
        
        if (chipsContainer) chipsContainer.style.display = 'none';
        
        messagesContainer.insertAdjacentHTML('beforeend', `<div class="chat-bubble user">${escapeHtml(question)}</div>`);
        input.value = '';
        input.disabled = true;
        btnAsk.disabled = true;
        
        const loaderId = 'loader-' + Date.now();
        messagesContainer.insertAdjacentHTML('beforeend', `<div id="${loaderId}" class="chat-bubble ai"><span class="chat-skeleton">Thinking...</span></div>`);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        try {
            const reqBody = {
                circular_id: data.id,
                circular_title: data.title,
                circular_content: alert.summary || data.title,
                question: question,
                conversation_history: state.chatHistory || []
            };
            
            const res = await fetch(`${CONFIG.API_BASE}/api/circular-chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
            });
            
            if (!res.ok) throw new Error("API error");
            const resData = await res.json();
            
            if (!state.chatHistory) state.chatHistory = [];
            state.chatHistory.push(
                { role: "user", content: question },
                { role: "assistant", content: resData.answer }
            );
            
            const loader = document.getElementById(loaderId);
            if (loader) {
                loader.outerHTML = `
                    <div class="chat-bubble ai">
                        ${escapeHtml(resData.answer).replace(/\\n/g, '<br>')}
                        <span class="chat-source">Source: ${resData.circular_ref || data.id} &middot; Compliance OS AI</span>
                    </div>
                `;
            }
        } catch (err) {
            const loader = document.getElementById(loaderId);
            if (loader) {
                loader.outerHTML = `
                    <div class="chat-bubble ai" style="color:#EF4444;">
                        AI is temporarily unavailable. Please try again in a moment.
                    </div>
                `;
            }
        } finally {
            input.disabled = false;
            btnAsk.disabled = false;
            input.focus();
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    };

    btnAsk.addEventListener('click', () => submitChat(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitChat(input.value);
    });
    
    if (chipsContainer) {
        chipsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('chat-chip')) {
                submitChat(e.target.textContent);
            }
        });
    }
}

// ── Helpers ──────────────────────────────────────────────

function formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function goToPage(page) {
    if (page < 1 || page > state.totalPages) return;
    state.currentPage = page;
    fetchCirculars(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Event Listeners ──────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Auth display & logout
    if (window.USER_EMAIL) {
        document.getElementById('userEmailDisplay').textContent = window.USER_EMAIL;
    }
    document.getElementById('btnLogout').addEventListener('click', async (e) => {
        e.preventDefault();
        if (window.supabaseInstance) {
            await window.supabaseInstance.auth.signOut();
        }
        window.location.replace('auth.html');
    });

    // Initial load
    fetchCirculars(1);
    fetchStats();

    // Refresh button
    document.getElementById('btnRefresh').addEventListener('click', () => {
        const btn = document.getElementById('btnRefresh');
        btn.classList.add('spinning');
        Promise.all([fetchCirculars(state.currentPage), fetchStats()]).finally(() => {
            setTimeout(() => btn.classList.remove('spinning'), 500);
        });
    });

    // Filters
    document.getElementById('filterSeverity').addEventListener('change', (e) => {
        state.filters.severity = e.target.value;
        fetchCirculars(1);
    });

    document.getElementById('filterType').addEventListener('change', (e) => {
        state.filters.document_type = e.target.value;
        fetchCirculars(1);
    });

    // Keyboard Navigation
    document.addEventListener('keydown', (e) => {
        if (!state.circulars || state.circulars.length === 0) return;
        
        // Find current index
        let currentIndex = state.circulars.findIndex(c => c.id === state.activeId);
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = currentIndex === -1 ? 0 : currentIndex + 1;
            if (nextIndex < state.circulars.length) {
                openDetail(state.circulars[nextIndex].id);
                // Scroll table logic if needed
                const row = document.querySelector(`tr[data-id="${state.circulars[nextIndex].id}"]`);
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (currentIndex > 0) {
                openDetail(state.circulars[currentIndex - 1].id);
                const row = document.querySelector(`tr[data-id="${state.circulars[currentIndex - 1].id}"]`);
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    });
});
