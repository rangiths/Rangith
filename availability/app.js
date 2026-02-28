(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  // days schema: { "YYYY-MM-DD": { "a": "busy"|"not-preferred", "n": "busy"|"not-preferred" } }
  // Only non-available slots are stored. Empty day objects are deleted.

  var appState = { v: 2, name: '', users: [] };
  var currentUserIndex = -1;
  var browseMode = false;

  var today = new Date();
  var viewYear = today.getFullYear();
  var viewMonth = today.getMonth();

  // ── URL Encoding ───────────────────────────────────────────────────────────

  function encodeState(state) {
    return LZString.compressToEncodedURIComponent(JSON.stringify(state));
  }

  function decodeState(encoded) {
    var json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) throw new Error('decompression failed');
    return JSON.parse(json);
  }

  // ── Status Helpers ─────────────────────────────────────────────────────────

  var STATUS_RANK = { 'available': 0, 'not-preferred': 1, 'busy': 2 };
  var RANK_STATUS = ['available', 'not-preferred', 'busy'];
  var CYCLE = { 'available': 'busy', 'busy': 'not-preferred', 'not-preferred': 'available' };

  function getSlotStatus(user, dateStr, slot) {
    var day = user.days[dateStr];
    if (!day) return 'available';
    return day[slot] || 'available';
  }

  function getAggregateSlotStatus(dateStr, slot) {
    var max = 0;
    for (var i = 0; i < appState.users.length; i++) {
      var s = getSlotStatus(appState.users[i], dateStr, slot);
      if (STATUS_RANK[s] > max) max = STATUS_RANK[s];
    }
    return RANK_STATUS[max];
  }

  function getCurrentUserSlotStatus(dateStr, slot) {
    if (currentUserIndex < 0) return 'available';
    return getSlotStatus(appState.users[currentUserIndex], dateStr, slot);
  }

  function cycleSlot(dateStr, slot) {
    if (currentUserIndex < 0) return;
    var userDays = appState.users[currentUserIndex].days;
    if (!userDays[dateStr]) userDays[dateStr] = {};
    var current = userDays[dateStr][slot] || 'available';
    var next = CYCLE[current];
    if (next === 'available') {
      delete userDays[dateStr][slot];
      if (Object.keys(userDays[dateStr]).length === 0) delete userDays[dateStr];
    } else {
      userDays[dateStr][slot] = next;
    }
  }

  // ── Browse Mode ────────────────────────────────────────────────────────────

  function exitBrowseMode() {
    if (!browseMode) return;
    browseMode = false;
    document.getElementById('browse-banner').classList.add('hidden');
    document.getElementById('slot-hint').classList.remove('hidden');
    document.querySelector('.edit-cal-btn').classList.remove('hidden');
    document.getElementById('calendar-grid').classList.remove('browse-mode');
  }

  window.enterBrowseMode = function () {
    browseMode = true;
    currentUserIndex = -1;
    hideModal();
    document.getElementById('header-greeting').textContent = 'Browsing';
    document.getElementById('cal-name').textContent = appState.name;
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('browse-banner').classList.remove('hidden');
    document.getElementById('slot-hint').classList.add('hidden');
    document.querySelector('.edit-cal-btn').classList.add('hidden');
    document.getElementById('calendar-grid').classList.add('browse-mode');
    renderCalendar();
    updateShareLink();
  };

  // ── Weekday Afternoon Pre-fill ─────────────────────────────────────────────

  function initWeekdayAfternoons(user) {
    var now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    for (var m = 0; m < 2; m++) {
      var yr = today.getFullYear();
      var mo = today.getMonth() + m;
      if (mo > 11) { mo -= 12; yr++; }
      var daysInMonth = new Date(yr, mo + 1, 0).getDate();
      for (var d = 1; d <= daysInMonth; d++) {
        var date = new Date(yr, mo, d);
        if (date < now) continue;
        var dow = date.getDay();
        if (dow === 0 || dow === 6) continue; // skip weekends
        var mm = String(mo + 1).padStart(2, '0');
        var dd = String(d).padStart(2, '0');
        var dateStr = yr + '-' + mm + '-' + dd;
        if (!user.days[dateStr]) user.days[dateStr] = {};
        user.days[dateStr].a = 'busy';
      }
    }
  }

  // ── Calendar Rendering ─────────────────────────────────────────────────────

  var MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  function buildCells(year, month) {
    var firstDow = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var cells = [];
    for (var i = 0; i < firstDow; i++) cells.push(null);
    for (var d = 1; d <= daysInMonth; d++) {
      var mm = String(month + 1).padStart(2, '0');
      var dd = String(d).padStart(2, '0');
      cells.push(year + '-' + mm + '-' + dd);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function isToday(dateStr) {
    var y = today.getFullYear();
    var m = String(today.getMonth() + 1).padStart(2, '0');
    var d = String(today.getDate()).padStart(2, '0');
    return dateStr === y + '-' + m + '-' + d;
  }

  function isPast(dateStr) {
    var t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var parts = dateStr.split('-');
    var cellDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return cellDate < t;
  }

  function buildCellHtml(dateStr) {
    var aggA = getAggregateSlotStatus(dateStr, 'a');
    var aggN = getAggregateSlotStatus(dateStr, 'n');
    var ownA = getCurrentUserSlotStatus(dateStr, 'a');
    var ownN = getCurrentUserSlotStatus(dateStr, 'n');
    var past = isPast(dateStr) ? ' past' : '';
    var todayCls = isToday(dateStr) ? ' today' : '';
    var dayNum = parseInt(dateStr.split('-')[2], 10);

    // Solid background = whole-day aggregate (most restrictive of the two slots)
    var aggWhole = STATUS_RANK[aggA] >= STATUS_RANK[aggN] ? aggA : aggN;

    // Split bands only when afternoon and night aggregate differently
    var bands = '';
    if (aggA !== aggN) {
      bands = '<div class="band band-top status-' + aggA + '"></div>' +
              '<div class="band band-bottom status-' + aggN + '"></div>';
    }

    return '<div class="day-cell status-' + aggWhole + todayCls + past + '" data-date="' + dateStr + '">' +
      bands +
      '<span class="day-num">' + dayNum + '</span>' +
      '<div class="slot-icons">' +
        '<span class="slot-icon status-' + ownA + '" data-date="' + dateStr + '" data-slot="a">&#9728;</span>' +
        '<span class="slot-icon status-' + ownN + '" data-date="' + dateStr + '" data-slot="n">&#9789;</span>' +
      '</div>' +
    '</div>';
  }

  function renderCalendar() {
    document.getElementById('month-label').textContent =
      MONTH_NAMES[viewMonth] + ' ' + viewYear;

    var cells = buildCells(viewYear, viewMonth);
    var html = '';
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] === null) {
        html += '<div class="day-cell empty"></div>';
      } else {
        html += buildCellHtml(cells[i]);
      }
    }
    document.getElementById('calendar-grid').innerHTML = html;
  }

  function rerenderDay(dateStr) {
    var cell = document.querySelector('.day-cell[data-date="' + dateStr + '"]');
    if (!cell) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = buildCellHtml(dateStr);
    cell.parentNode.replaceChild(tmp.firstChild, cell);
  }

  // ── Month Navigation ───────────────────────────────────────────────────────

  window.changeMonth = function (delta) {
    viewMonth += delta;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
    renderCalendar();
  };

  // ── Share Link ─────────────────────────────────────────────────────────────

  function updateShareLink() {
    var encoded = encodeState(appState);
    history.replaceState(null, '', '#' + encoded);
    var url = window.location.href;
    document.getElementById('share-url').value = url;
    // Hash-only URLs have no meaningful length limit (hash is never sent to the server)
  }

  window.copyLink = async function () {
    var input = document.getElementById('share-url');
    var btn = document.getElementById('copy-btn');
    var url = input.value;

    btn.textContent = 'Shortening…';
    btn.disabled = true;

    var toCopy = url;
    try {
      var resp = await fetch('https://da.gd/shorten?url=' + encodeURIComponent(url));
      var short = await resp.text();
      if (short && short.startsWith('https://da.gd/')) toCopy = short.trim();
    } catch (e) { /* fall back to full URL */ }

    var names = appState.users.map(function (u) { return u.name; }).join(', ');
    var message = '';
    if (appState.name) message += appState.name + '\n';
    message += 'Please fill out your availability: ' + toCopy;
    if (names) message += '\nAlready filled out: ' + names;
    toCopy = message;

    try {
      await navigator.clipboard.writeText(toCopy);
    } catch (e) {
      var ta = document.createElement('textarea');
      ta.value = toCopy;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    btn.disabled = false;
    setTimeout(function () {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 1800);
  };

  // ── Tooltip ────────────────────────────────────────────────────────────────

  var tooltip = document.getElementById('day-tooltip');
  var tooltipTarget = null;

  function showTooltip(dateStr, anchorEl) {
    if (appState.users.length < (browseMode ? 1 : 2)) return;
    var lines = [];
    appState.users.forEach(function (u) {
      var a = getSlotStatus(u, dateStr, 'a');
      var n = getSlotStatus(u, dateStr, 'n');
      if (a === 'available' && n === 'available') {
        lines.push('<strong>' + escapeHtml(u.name) + ':</strong> Available all day');
      } else {
        var parts = [];
        if (a !== 'available') parts.push('&#9728; ' + statusLabel(a));
        if (n !== 'available') parts.push('&#9789; ' + statusLabel(n));
        lines.push('<strong>' + escapeHtml(u.name) + ':</strong> ' + parts.join(', '));
      }
    });
    tooltip.innerHTML = lines.join('<br>');
    tooltip.classList.add('visible');
    positionTooltip(anchorEl);
  }

  function statusLabel(s) {
    return { 'busy': 'Busy', 'not-preferred': 'Not preferred', 'available': 'Available' }[s];
  }

  function positionTooltip(anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    var tipH = tooltip.offsetHeight || 60;
    var tipW = tooltip.offsetWidth || 200;
    var top = rect.top - tipH - 8 > 0 ? rect.top - tipH - 8 : rect.bottom + 8;
    var left = Math.min(rect.left, window.innerWidth - tipW - 8);
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
    tooltipTarget = null;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Event Delegation ───────────────────────────────────────────────────────

  var gridEl = document.getElementById('calendar-grid');

  gridEl.addEventListener('click', function (e) {
    if (browseMode) return;
    // Check if a slot icon was clicked
    var slotEl = e.target.closest('[data-slot]');
    var dateStr, dayCell;

    if (slotEl) {
      dayCell = slotEl.closest('.day-cell');
      if (!dayCell || dayCell.classList.contains('past') || dayCell.classList.contains('empty')) return;
      dateStr = slotEl.dataset.date;
      cycleSlot(dateStr, slotEl.dataset.slot);
    } else {
      // Whole-day click
      dayCell = e.target.closest('.day-cell[data-date]');
      if (!dayCell || dayCell.classList.contains('past') || dayCell.classList.contains('empty')) return;
      dateStr = dayCell.dataset.date;
      var ownA = getCurrentUserSlotStatus(dateStr, 'a');
      var ownN = getCurrentUserSlotStatus(dateStr, 'n');
      var userDays = appState.users[currentUserIndex].days;
      var target;
      if (ownA !== ownN) {
        // Mixed state: unify to the most restrictive slot first, don't cycle yet
        target = STATUS_RANK[ownA] >= STATUS_RANK[ownN] ? ownA : ownN;
      } else {
        // Already unified: cycle
        target = CYCLE[ownA];
      }
      if (target === 'available') {
        delete userDays[dateStr];
      } else {
        userDays[dateStr] = { a: target, n: target };
      }
    }

    rerenderDay(dateStr);
    updateShareLink();
    hideTooltip();
  });

  gridEl.addEventListener('mouseenter', function (e) {
    var dayCell = e.target.closest('.day-cell[data-date]');
    if (!dayCell || dayCell.classList.contains('empty') || dayCell.classList.contains('past')) return;
    tooltipTarget = dayCell;
    showTooltip(dayCell.dataset.date, dayCell);
  }, true);

  gridEl.addEventListener('mouseleave', function (e) {
    var dayCell = e.target.closest('.day-cell[data-date]');
    if (dayCell && dayCell === tooltipTarget) hideTooltip();
  }, true);

  document.addEventListener('touchstart', function (e) {
    if (!tooltip.classList.contains('visible')) return;
    if (!e.target.closest('.day-cell')) hideTooltip();
  }, { passive: true });

  // ── Modal ──────────────────────────────────────────────────────────────────

  // ── User Dropdown ──────────────────────────────────────────────────────────

  window.toggleUserDropdown = function () {
    var dropdown = document.getElementById('user-dropdown');
    if (dropdown.classList.contains('hidden')) {
      populateUserDropdown();
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  };

  window.hideUserDropdown = function () {
    document.getElementById('user-dropdown').classList.add('hidden');
  };

  function populateUserDropdown() {
    var list = document.getElementById('user-dropdown-list');
    list.innerHTML = appState.users.map(function (u, i) {
      var isActive = !browseMode && i === currentUserIndex;
      return '<li class="' + (isActive ? 'active' : '') + '" onclick="switchToUser(' + i + ')">' +
        escapeHtml(u.name) +
        (isActive ? '<span class="checkmark">&#10003;</span>' : '') +
      '</li>';
    }).join('') +
    '<li class="new-user-item" onclick="showModal()">+ New user</li>';
  }

  window.switchToUser = function (idx) {
    if (idx === currentUserIndex && !browseMode) { hideUserDropdown(); return; }
    exitBrowseMode();
    currentUserIndex = idx;
    var name = appState.users[idx].name;
    sessionStorage.setItem('calUser', JSON.stringify({ name: name, userIndex: idx }));
    document.getElementById('header-greeting').textContent = 'Hi, ' + name;
    hideUserDropdown();
    renderCalendar();
    updateShareLink();
  };

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.user-switcher')) {
      hideUserDropdown();
    }
  });

  // ── Calendar Naming ────────────────────────────────────────────────────────

  window.startEditCalName = function () {
    var wrap = document.querySelector('.cal-name-wrap');
    var span = document.getElementById('cal-name');
    var current = appState.name;
    var input = document.createElement('input');
    input.className = 'cal-name-input-inline';
    input.value = current;
    span.replaceWith(input);
    input.focus();
    input.select();

    var saved = false;
    function save() {
      if (saved) return;
      saved = true;
      var val = input.value.trim() || current;
      appState.name = val;
      var newSpan = document.createElement('span');
      newSpan.id = 'cal-name';
      newSpan.className = 'cal-name';
      newSpan.textContent = val;
      input.replaceWith(newSpan);
      updateShareLink();
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') { input.value = current; input.blur(); }
    });
  };

  window.showModal = function () {
    updateModalSubtitle();
    document.getElementById('name-input').value = '';
    document.getElementById('name-error').textContent = '';
    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(function () {
      var first = appState.name === ''
        ? document.getElementById('cal-name-input')
        : document.getElementById('name-input');
      first.focus();
    }, 50);
  };

  function hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  function updateModalSubtitle() {
    var users = appState.users;
    var existingEl = document.getElementById('existing-users');
    var calNameField = document.getElementById('cal-name-field');
    var joiningLabel = document.getElementById('joining-label');

    if (appState.name === '') {
      // Fresh calendar: show calendar name input
      calNameField.classList.remove('hidden');
      joiningLabel.classList.add('hidden');
      document.getElementById('modal-subtitle').textContent = 'Enter your name to get started.';
      existingEl.innerHTML = '';
    } else {
      // Shared calendar: show joining label, hide calendar name input
      calNameField.classList.add('hidden');
      joiningLabel.classList.remove('hidden');
      joiningLabel.innerHTML = 'You\'re joining: <strong>' + escapeHtml(appState.name) + '</strong>';
      if (users.length === 0) {
        document.getElementById('modal-subtitle').textContent = 'Enter your name to get started.';
        existingEl.innerHTML = '';
      } else {
        document.getElementById('modal-subtitle').textContent = 'Enter your name to view and edit your availability.';
        var names = users.map(function (u) { return '<li>' + escapeHtml(u.name) + '</li>'; }).join('');
        existingEl.innerHTML = '<div class="existing-users-list"><p>Already marked availability:</p><ul>' + names + '</ul></div>';
      }
    }

    var hasBrowsable = users.length > 0;
    document.getElementById('browse-btn').classList.toggle('hidden', !hasBrowsable);
    document.getElementById('modal-browse-divider').classList.toggle('hidden', !hasBrowsable);
  }

  window.handleNameSubmit = function () {
    // Capture calendar name for fresh calendars
    if (appState.name === '') {
      var calInput = document.getElementById('cal-name-input');
      var calName = calInput.value.trim();
      if (!calName) {
        calInput.focus();
        document.getElementById('name-error').textContent = 'Please enter a calendar name.';
        return;
      }
      appState.name = calName;
    }

    var input = document.getElementById('name-input');
    var name = input.value.trim();
    if (!name) {
      document.getElementById('name-error').textContent = 'Please enter your name.';
      return;
    }

    var idx = -1;
    for (var i = 0; i < appState.users.length; i++) {
      if (appState.users[i].name.toLowerCase() === name.toLowerCase()) { idx = i; break; }
    }

    if (idx >= 0) {
      currentUserIndex = idx;
    } else {
      var newUser = { name: name, days: {} };
      initWeekdayAfternoons(newUser);
      appState.users.push(newUser);
      currentUserIndex = appState.users.length - 1;
    }

    exitBrowseMode();
    sessionStorage.setItem('calUser', JSON.stringify({ name: name, userIndex: currentUserIndex }));
    document.getElementById('header-greeting').textContent = 'Hi, ' + name;
    document.getElementById('cal-name').textContent = appState.name;
    document.getElementById('app').classList.remove('hidden');
    hideModal();
    renderCalendar();
    updateShareLink();
  };

  document.getElementById('cal-name-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('name-input').focus();
  });

  document.getElementById('name-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') window.handleNameSubmit();
  });

  // ── Hash Change ────────────────────────────────────────────────────────────

  window.addEventListener('hashchange', function () {
    var hash = window.location.hash.slice(1);
    if (!hash) return;
    try {
      var newState = decodeState(hash);
      if (currentUserIndex >= 0 && newState.users[currentUserIndex]) {
        newState.users[currentUserIndex] = appState.users[currentUserIndex];
      }
      appState = newState;
      renderCalendar();
    } catch (e) {}
  });

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    var hash = window.location.hash.slice(1);
    if (hash) {
      try {
        appState = decodeState(hash);
      } catch (e) {
        appState = { v: 2, users: [] };
        document.getElementById('warning-banner').classList.remove('hidden');
      }
    }

    var session = null;
    try { session = JSON.parse(sessionStorage.getItem('calUser') || 'null'); } catch (e) {}

    var sessionValid = session &&
      typeof session.userIndex === 'number' &&
      appState.users[session.userIndex] &&
      appState.users[session.userIndex].name.toLowerCase() === session.name.toLowerCase();

    if (sessionValid) {
      currentUserIndex = session.userIndex;
      document.getElementById('header-greeting').textContent = 'Hi, ' + appState.users[currentUserIndex].name;
      document.getElementById('cal-name').textContent = appState.name;
      document.getElementById('app').classList.remove('hidden');
      document.getElementById('modal-overlay').classList.add('hidden');
      renderCalendar();
      updateShareLink();
    } else {
      updateModalSubtitle();
    }
  }

  init();

})();
