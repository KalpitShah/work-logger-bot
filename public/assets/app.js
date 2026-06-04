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

  // Appends the currently selected workspace id to a URLSearchParams (creating
  // one if needed) so every API call is scoped to the selected workspace.
  function wsParam(params) {
    params = params || new URLSearchParams();
    const ws = document.getElementById('filter-workspace').value;
    if (ws) params.set('workspace', ws);
    return params;
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

  function fmtDay(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return esc(dateStr);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Trim float noise; show whole numbers without a trailing ".0".
  function fmtHours(n) {
    return String(Math.round((Number(n) || 0) * 100) / 100);
  }

  const STATUS_META = {
    replied:        { label: 'Replied',  badge: 'badge-green', dot: 'dot-green' },
    awaiting_reply: { label: 'Awaiting', badge: 'badge-amber', dot: 'dot-amber' },
    not_sent:       { label: 'Not sent', badge: 'badge-gray',  dot: 'dot-gray' },
  };

  // ---- Summary ----------------------------------------------------------

  async function loadSummary() {
    const s = await api('/api/summary?' + wsParam().toString());
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
      const { users } = await api('/api/status/today?' + wsParam().toString());
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

  // ---- Hours by person matrix -------------------------------------------

  function matrixParams() {
    const params = new URLSearchParams();
    const from = document.getElementById('matrix-from').value;
    const to = document.getElementById('matrix-to').value;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (!from && !to) params.set('days', '30');
    wsParam(params);
    return params;
  }

  async function loadMatrix() {
    const headRow = document.getElementById('matrix-head-row');
    const body = document.getElementById('matrix-body');
    const foot = document.getElementById('matrix-foot');
    try {
      const data = await api('/api/hours-matrix?' + matrixParams().toString());
      const users = data.users || [];
      const span = users.length + 2;

      // Reflect the resolved range back into the (possibly empty) date inputs.
      if (!document.getElementById('matrix-from').value) {
        document.getElementById('matrix-from').value = data.from;
      }
      if (!document.getElementById('matrix-to').value) {
        document.getElementById('matrix-to').value = data.to;
      }

      headRow.innerHTML =
        '<th>Date</th>' +
        users.map((u) => `<th class="num">${esc(u.name)}</th>`).join('') +
        '<th class="num">Total</th>';

      if (!data.rows.length) {
        body.innerHTML = `<tr><td class="empty" colspan="${span}">No data in this range.</td></tr>`;
        foot.innerHTML = '';
        return;
      }

      body.innerHTML = data.rows.map((r) => {
        const cells = users.map((u) => {
          const h = r.cells[u.slack_user_id] || 0;
          return `<td class="num">${h ? fmtHours(h) : '<span class="muted">·</span>'}</td>`;
        }).join('');
        const total = r.total ? fmtHours(r.total) : '<span class="muted">—</span>';
        return `<tr><td class="cell-day">${esc(fmtDay(r.date))}</td>${cells}<td class="num">${total}</td></tr>`;
      }).join('');

      const totalCells = users.map(
        (u) => `<td class="num">${fmtHours(data.totals[u.slack_user_id] || 0)}</td>`
      ).join('');
      foot.innerHTML =
        `<tr class="matrix-total"><td>Total</td>${totalCells}<td class="num">${fmtHours(data.grandTotal || 0)}</td></tr>`;
    } catch (e) {
      body.innerHTML = '<tr><td class="empty">Failed to load hours.</td></tr>';
      foot.innerHTML = '';
    }
  }

  function exportMatrix() {
    const a = document.createElement('a');
    a.href = '/api/export.csv?' + matrixParams().toString();
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---- Entries ----------------------------------------------------------

  async function loadUsers() {
    try {
      const sel = document.getElementById('filter-user');
      sel.length = 1; // keep the static "All users" option, drop the rest
      const { users } = await api('/api/users?' + wsParam().toString());
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
    wsParam(params);

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

  // ---- Workspaces -------------------------------------------------------

  async function loadWorkspaces() {
    try {
      const { workspaces } = await api('/api/workspaces');
      const sel = document.getElementById('filter-workspace');
      sel.innerHTML = '';
      for (const w of workspaces) {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.name;
        sel.appendChild(opt);
      }
      // Hide the selector when there's only one workspace.
      sel.style.display = workspaces.length > 1 ? '' : 'none';
    } catch (e) { /* ignore */ }
  }

  // ---- Boot -------------------------------------------------------------

  async function refreshAll() {
    await Promise.all([loadSummary(), loadStatus(), loadMatrix(), loadEntries()]);
  }

  function initMatrix() {
    document.getElementById('matrix-apply').addEventListener('click', loadMatrix);
    document.getElementById('matrix-export').addEventListener('click', exportMatrix);
  }

  async function init() {
    initTabs();
    initFilters();
    initMatrix();

    // Load workspaces first so the selector (and its value) exists before any
    // scoped fetch runs.
    await loadWorkspaces();
    document.getElementById('filter-workspace').addEventListener('change', () => {
      loadUsers();
      refreshAll();
    });

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
