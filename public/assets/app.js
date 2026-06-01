(function () {
  'use strict';

  // ---- Helpers ----------------------------------------------------------

  async function api(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error('Request failed: ' + path);
    return res.json();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  const STATUS_META = {
    replied:        { label: 'Replied',  badge: 'badge-green', dot: 'dot-green' },
    awaiting_reply: { label: 'Awaiting', badge: 'badge-amber', dot: 'dot-amber' },
    not_sent:       { label: 'Not sent', badge: 'badge-gray',  dot: 'dot-gray' },
  };

  // ---- Summary ----------------------------------------------------------

  async function loadSummary() {
    const s = await api('/api/summary');
    document.getElementById('stat-replied').textContent = s.repliedToday;
    document.getElementById('stat-replied-sub').textContent =
      `of ${s.totalUsers} ${s.totalUsers === 1 ? 'user' : 'users'}`;
    document.getElementById('stat-awaiting').textContent = s.awaitingToday;
    document.getElementById('stat-hours').textContent = s.hoursLast7Days;
    document.getElementById('stat-entries').textContent = s.totalEntries;

    const d = new Date(s.date + 'T00:00:00');
    document.getElementById('today-label').textContent = d.toLocaleDateString(undefined, {
      weekday: 'long', month: 'short', day: 'numeric',
    });
  }

  // ---- Today's status ---------------------------------------------------

  async function loadStatus() {
    const body = document.getElementById('status-body');
    try {
      const { users } = await api('/api/status/today');
      if (!users.length) {
        body.innerHTML = '<tr><td colspan="4" class="empty">No users configured.</td></tr>';
        return;
      }
      body.innerHTML = users.map((u) => {
        const meta = STATUS_META[u.status] || STATUS_META.not_sent;
        return `<tr>
          <td><strong>${esc(u.name)}</strong></td>
          <td><span class="dot ${meta.dot}"></span><span class="badge ${meta.badge}">${meta.label}</span></td>
          <td>${fmtTime(u.sent_at)}</td>
          <td>${fmtTime(u.replied_at)}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      body.innerHTML = '<tr><td colspan="4" class="empty">Failed to load status.</td></tr>';
    }
  }

  // ---- Entries ----------------------------------------------------------

  async function loadUsers() {
    try {
      const { users } = await api('/api/users');
      const sel = document.getElementById('filter-user');
      for (const u of users) {
        const opt = document.createElement('option');
        opt.value = u.slack_user_id;
        opt.textContent = u.name;
        sel.appendChild(opt);
      }
    } catch (e) { /* ignore */ }
  }

  async function loadEntries() {
    const body = document.getElementById('entries-body');
    const params = new URLSearchParams();
    const user = document.getElementById('filter-user').value;
    const from = document.getElementById('filter-from').value;
    const to = document.getElementById('filter-to').value;
    const q = document.getElementById('filter-q').value.trim();
    if (user) params.set('user', user);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (q) params.set('q', q);

    try {
      const { entries } = await api('/api/entries?' + params.toString());
      if (!entries.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">No entries found.</td></tr>';
        return;
      }
      body.innerHTML = entries.map((e) => {
        const parsedBadge = e.parsed
          ? '<span class="badge badge-green">Yes</span>'
          : '<span class="badge badge-amber">No</span>';
        const hours = (e.hours === null || e.hours === undefined) ? '—' : e.hours;
        return `<tr>
          <td>${esc(e.date)}</td>
          <td><strong>${esc(e.name)}</strong></td>
          <td class="num">${esc(hours)}</td>
          <td class="cell-desc">${esc(e.description) || '<span class="muted">—</span>'}</td>
          <td class="cell-raw">${esc(e.raw_reply)}</td>
          <td>${parsedBadge}</td>
          <td>${fmtDateTime(e.logged_at)}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Failed to load entries.</td></tr>';
    }
  }

  // ---- Tabs -------------------------------------------------------------

  function initTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      });
    });
  }

  // ---- Filters ----------------------------------------------------------

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function initFilters() {
    ['filter-user', 'filter-from', 'filter-to'].forEach((id) => {
      document.getElementById(id).addEventListener('change', loadEntries);
    });
    document.getElementById('filter-q').addEventListener('input', debounce(loadEntries, 300));
    document.getElementById('filter-clear').addEventListener('click', () => {
      document.getElementById('filter-user').value = '';
      document.getElementById('filter-from').value = '';
      document.getElementById('filter-to').value = '';
      document.getElementById('filter-q').value = '';
      loadEntries();
    });
  }

  // ---- Boot -------------------------------------------------------------

  async function refreshAll() {
    await Promise.all([loadSummary(), loadStatus(), loadEntries()]);
  }

  function init() {
    initTabs();
    initFilters();
    loadUsers();
    refreshAll();

    document.getElementById('refresh-btn').addEventListener('click', refreshAll);
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    });

    // Light auto-refresh of summary + status every 60s.
    setInterval(() => { loadSummary(); loadStatus(); }, 60000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
