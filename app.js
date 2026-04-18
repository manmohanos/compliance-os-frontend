/**
 * GIFT City Compliance OS — Dashboard Application
 * Connects to FastAPI backend at /api/circulars
 */

// ── Configuration ─────────────────────────────────────────
// Change API_BASE to your Render.com URL before deploying:
//   https://giftcity-compliance-api.onrender.com
const CONFIG = {
    API_BASE: 'https://giftcity-compliance-api.onrender.com',
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

    if (state.circulars.length === 0) {
        tbody.innerHTML = `
            <tr class="loading-row">
                <td colspan="5">
                    <div class="empty-state">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <p>No circulars match your filters</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = state.circulars.map(item => {
        // Supabase may return processed_alerts as array or single object
        const alerts = item.processed_alerts;
        const alert = Array.isArray(alerts) ? alerts[0] : alerts;
        const severity = alert?.severity || 'advisory';
        const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
        const formattedDate = formatDate(item.published_date);
        const docType = item.document_type || 'circular';

        return `
            <tr data-id="${item.id}" onclick="openDetail('${item.id}')">
                <td>
                    <span class="severity-badge ${severity}">${severityLabel}</span>
                </td>
                <td>
                    <div class="circular-title">${escapeHtml(item.title)}</div>
                </td>
                <td>
                    <span class="type-badge">${docType}</span>
                </td>
                <td>
                    <span class="circular-date">${formattedDate}</span>
                </td>
                <td>
                    <button class="btn-view" onclick="event.stopPropagation(); openDetail('${item.id}')">View</button>
                </td>
            </tr>`;
    }).join('');
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

// ── Detail Modal ─────────────────────────────────────────

async function openDetail(id) {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalContent');

    content.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';
    overlay.classList.add('active');

    const data = await fetchCircularDetail(id);
    if (!data) {
        content.innerHTML = '<p style="text-align:center;color:var(--text-muted);">Failed to load details</p>';
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

    content.innerHTML = `
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
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
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

    // Modal close
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
});
