/* ComfyUI Workflow Diff — UI */
(function () {
  'use strict';

  const core = window.ComfyDiffCore;
  if (!core) {
    document.body.innerHTML = '<pre style="padding:20px;color:#f88">core.js 未载入，请确认文件完整。</pre>';
    return;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const NS = 'http://www.w3.org/2000/svg';

  const state = {
    a: null,
    b: null,
    file: { a: null, b: null },
    loading: { a: false, b: false },
    errors: { a: '', b: '' },
    diff: null,
    filter: 'all',
    query: '',
    selectedNodeKey: null,
    selectedGraphId: null,
    selectedParamKey: null,
    inspector: null,
    graph: {
      scale: 1,
      tx: 0,
      ty: 0,
      selectedId: null,
      onlyChanges: true,
      showLinks: false,
      built: false,
      autoFit: true,
      nodeEls: new Map(),
      groupEls: new Map(),
      groupMarkEls: new Map(),
      pinEls: new Map(),
      animation: 0,
      suppressClickUntil: 0
    }
  };

  const els = {
    slotA: $('#slotA'), slotB: $('#slotB'),
    fileA: $('#fileA'), fileB: $('#fileB'),
    typeA: $('#typeA'), typeB: $('#typeB'),
    nameA: $('#nameA'), nameB: $('#nameB'),
    metaA: $('#metaA'), metaB: $('#metaB'),
    errorA: $('#errorA'), errorB: $('#errorB'),
    clearA: $('#clearA'), clearB: $('#clearB'),
    swapBtn: $('#swapBtn'),
    summaryPanel: $('#summaryPanel'),
    totalCount: $('#totalCount'),
    summaryChips: $('#summaryChips'),
    summaryNote: $('#summaryNote'),
    copyTodoBtn: $('#copyTodoBtn'),
    warningBox: $('#warningBox'),
    diffTools: $('#diffTools'),
    filterTabs: $$('.filter-tab'),
    countAll: $('#countAll'), countCopy: $('#countCopy'), countBypass: $('#countBypass'),
    countEnable: $('#countEnable'), countMode: $('#countMode'),
    countAdd: $('#countAdd'), countRemove: $('#countRemove'),
    searchInput: $('#searchInput'),
    diffScroll: $('#diffScroll'),
    diffList: $('#diffList'),
    btnExport: $('#btnExport'), btnHelp: $('#btnHelp'),
    graphMeta: $('#graphMeta'),
    graphWrap: $('#graphWrap'),
    graphSvg: $('#graphSvg'),
    graphViewport: $('#graphViewport'),
    changePins: $('#changePins'),
    groupActions: $('#groupActions'),
    graphEmpty: $('#graphEmpty'),
    graphLegend: $('#graphLegend'),
    zoomReadout: $('#zoomReadout'),
    btnOnlyChanges: $('#btnOnlyChanges'),
    btnLinks: $('#btnLinks'),
    btnFocusChanges: $('#btnFocusChanges'),
    btnFit: $('#btnFit'),
    btnZoomOut: $('#btnZoomOut'),
    btnZoomIn: $('#btnZoomIn'),
    inspector: $('#inspector'),
    inspectorGroup: $('#inspectorGroup'),
    inspectorTitle: $('#inspectorTitle'),
    inspectorSub: $('#inspectorSub'),
    inspectorBadges: $('#inspectorBadges'),
    inspectorAction: $('#inspectorAction'),
    inspectorTabs: $('#inspectorTabs'),
    inspectorBody: $('#inspectorBody'),
    inspectorClose: $('#inspectorClose'),
    copyNodeId: $('#copyNodeId'),
    copyNodeParams: $('#copyNodeParams'),
    copySummary: $('#copySummary'),
    toast: $('#toast'),
    helpModal: $('#helpModal'),
    helpClose: $('#helpClose'),
    dragOverlay: $('#dragOverlay')
  };

  let toastTimer = 0;
  let dragOverlayTimer = 0;
  const loadToken = { a: 0, b: 0 };

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function makeSvg(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) node.setAttribute(k, String(v));
      }
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function debounce(fn, ms) {
    let timer = 0;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function unique(list) {
    const out = [];
    const seen = new Set();
    for (const item of list || []) {
      const s = String(item || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function isHexColor(v) {
    return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());
  }

  function hexToRgba(hex, alpha) {
    if (!isHexColor(hex)) return 'rgba(63,120,158,' + alpha + ')';
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function formatType(parsed) {
    if (!parsed) return '';
    if (parsed.container === 'image') {
      return String(parsed.fileType || 'IMG').toUpperCase();
    }
    return 'JSON';
  }

  function sourceMeta(parsed) {
    if (!parsed) return '';
    const parts = [];
    if (parsed.kind === 'a1111') parts.push('A1111 参数摘要');
    else if (parsed.kind === 'api') parts.push('API 自动布局');
    else if (parsed.kind === 'summary') parts.push('参数摘要');
    else parts.push('UI 工作流');
    parts.push(parsed.nodes.length + ' 节点');
    if (parsed.width && parsed.height) parts.push(parsed.width + '×' + parsed.height);
    if (parsed.groups && parsed.groups.length > 1) parts.push(parsed.groups.length + ' 组');
    return parts.join(' · ');
  }

  function valuePreview(value, max) {
    if (value === undefined) return '—';
    return core.oneLine(value, max || 150);
  }

  function valueFull(value) {
    if (value === undefined) return '—';
    return core.stringifyForDisplay(value, true);
  }

  function modeClass(label) {
    const s = String(label || '');
    if (/bypass/i.test(s)) return 'bypass';
    if (/静音|mute/i.test(s)) return 'muted';
    return '';
  }

  function statusSide(caption, label, side) {
    const wrap = make('span', 'status-side ' + side);
    wrap.append(make('span', 'status-cap', caption), make('span', 'mode-pill ' + modeClass(label), label));
    return wrap;
  }

  function itemKindLabel(kind) {
    if (kind === 'status') return '状态';
    if (kind === 'node') return '节点';
    if (kind === 'link') return '连线';
    return '复制';
  }

  function showToast(message, isError, ms) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.toggle('error', !!isError);
    els.toast.hidden = false;
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, ms || (isError ? 7000 : 3800));
  }

  async function copyText(text, label) {
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_) {}
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {
        copied = false;
      }
    }
    if (copied) showToast((label || '内容') + '已复制');
    else showToast('复制失败：浏览器没有授予剪贴板权限', true);
  }

  const ACTION_META = {
    copy: { label: '复制 B 参数', short: '复制', icon: 'i-copy', className: 'copy' },
    bypass: { label: '改为 Bypass', short: 'BYPASS', icon: 'i-ban', className: 'bypass' },
    enable: { label: '启用节点', short: '启用', icon: 'i-play', className: 'enable' },
    mode: { label: '修改状态', short: '状态', icon: 'i-swap', className: 'mode' },
    add: { label: '仅 B 新增', short: '新增', icon: 'i-plus', className: 'add' },
    remove: { label: '仅 A 删除', short: '删除', icon: 'i-minus', className: 'remove' }
  };

  function actionMeta(key) {
    return ACTION_META[key] || ACTION_META.copy;
  }

  function actionIcon(name, className) {
    const svg = makeSvg('svg', { class: 'icon ' + (className || ''), 'aria-hidden': 'true' });
    svg.appendChild(makeSvg('use', { href: '#' + name }));
    return svg;
  }

  function actionBadge(nr, compact) {
    const meta = actionMeta(nr?.action);
    const badge = make('span', 'action-badge action-' + meta.className);
    badge.appendChild(actionIcon(meta.icon, 'action-icon'));
    const label = compact ? meta.short : (nr?.actionLabel || meta.label);
    const copyCount = nr?.copyCount || 0;
    let text = label;
    if (compact) {
      if (nr?.action === 'copy') text = '复制 ' + copyCount;
      else if (copyCount && nr.action !== 'copy') text = label + ' +' + copyCount;
    }
    badge.appendChild(make('span', '', text));
    return badge;
  }

  function copyIconButton(className, title) {
    const btn = make('button', 'icon-btn ' + (className || ''));
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    const svg = makeSvg('svg', { class: 'icon', 'aria-hidden': 'true' });
    svg.appendChild(makeSvg('use', { href: '#i-copy' }));
    btn.appendChild(svg);
    return btn;
  }

  function copyItemValue(item, side) {
    if (!item) return;
    if (side === 'A') {
      copyText(valueFull(item.hasA === false ? undefined : item.valueA), 'A 当前值');
      return;
    }
    if (side === 'B') {
      copyText(valueFull(item.hasB === false ? undefined : item.valueB), 'B 目标值');
      return;
    }
    if (item.kind === 'status' || item.kind === 'node') {
      copyText(item.valueA + ' → ' + item.valueB, '状态');
    } else {
      const preferred = item.hasB !== false && item.valueB !== undefined ? item.valueB : item.valueA;
      copyText(valueFull(preferred), item.hasB !== false && item.valueB !== undefined ? 'B 目标值' : 'A 当前值');
    }
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function timestampForFile() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ------------------------------------------------------------------ *
   * Loading files
   * ------------------------------------------------------------------ */

  function hideDragOverlay() {
    clearTimeout(dragOverlayTimer);
    els.dragOverlay.hidden = true;
  }

  function showDragOverlay() {
    clearTimeout(dragOverlayTimer);
    els.dragOverlay.hidden = false;
    // Safety net: if a browser skips dragleave/drop (for example when a file is
    // dropped on an iframe or the window loses focus), never leave the mask up.
    dragOverlayTimer = setTimeout(hideDragOverlay, 4000);
  }

  async function loadInto(key, file) {
    hideDragOverlay();
    if (!file) return;
    if (file.size > 80 * 1024 * 1024) {
      showToast('文件超过 80 MB，暂不处理。', true);
      return;
    }
    const token = ++loadToken[key];
    state.loading[key] = true;
    state.errors[key] = '';
    renderSlots();
    try {
      const parsed = await core.parseFile(file);
      if (token !== loadToken[key]) return;
      state[key] = parsed;
      state.file[key] = file;
      state.loading[key] = false;
      state.errors[key] = '';
      resetComparisonState();
      afterSourcesChanged(true);
      const warning = parsed.warnings && parsed.warnings[0];
      if (warning) showToast(warning, false, 5200);
    } catch (err) {
      if (token !== loadToken[key]) return;
      state.loading[key] = false;
      state[key] = null;
      state.file[key] = null;
      state.errors[key] = String(err.message || err);
      resetComparisonState();
      afterSourcesChanged(false);
      showToast('读取失败：' + String(err.message || err), true, 8000);
    }
  }

  function resetComparisonState() {
    state.diff = null;
    state.selectedNodeKey = null;
    state.selectedGraphId = null;
    state.selectedParamKey = null;
    state.inspector = null;
    state.graph.built = false;
    state.graph.autoFit = true;
    state.graph.onlyChanges = true;
    state.graph.showLinks = false;
    state.graph.scale = 1;
    state.graph.tx = 0;
    state.graph.ty = 0;
    state.graph.selectedId = null;
    state.graph.nodeEls = new Map();
    state.graph.groupEls = new Map();
    state.graph.groupMarkEls = new Map();
    state.graph.pinEls = new Map();
    els.inspector.hidden = true;
  }

  function afterSourcesChanged(fitGraphAfter) {
    if (state.a && state.b) {
      computeDiff({ fit: fitGraphAfter !== false });
    } else {
      state.diff = null;
      renderAll();
      clearGraph();
      updateGraphEmptyCopy();
    }
  }

  function computeDiff(opts) {
    opts = opts || {};
    if (!state.a || !state.b) {
      state.diff = null;
      renderAll();
      clearGraph();
      updateGraphEmptyCopy();
      return;
    }
    try {
      const previousSelection = state.selectedNodeKey;
      state.diff = core.compareParsed(state.a, state.b, { compareLinks: false });
      if (!['all', 'copy', 'bypass', 'enable', 'mode', 'add', 'remove'].includes(state.filter)) state.filter = 'all';
      else if (state.filter !== 'all' && !(state.diff.stats.actionCounts?.[state.filter] > 0)) state.filter = 'all';
      if (previousSelection && !state.diff.nodeResults.some(nr => nr.key === previousSelection)) {
        state.selectedNodeKey = null;
        state.selectedParamKey = null;
        state.inspector = null;
        els.inspector.hidden = true;
      }
      renderAll();
      renderGraph(opts.fit !== false ? 'fit' : 'preserve');
    } catch (err) {
      state.diff = null;
      renderAll();
      clearGraph();
      showToast('比较失败：' + (err.message || err), true, 8000);
    }
  }

  function clearSlot(key) {
    loadToken[key]++;
    state[key] = null;
    state.file[key] = null;
    state.loading[key] = false;
    state.errors[key] = '';
    resetComparisonState();
    afterSourcesChanged(false);
    if (key === 'a') els.fileA.value = '';
    else els.fileB.value = '';
  }

  function swapSources() {
    if (!state.a || !state.b) return;
    const a = state.a, b = state.b;
    const fa = state.file.a, fb = state.file.b;
    state.a = b; state.b = a;
    state.file.a = fb; state.file.b = fa;
    state.selectedNodeKey = null;
    state.selectedParamKey = null;
    state.inspector = null;
    state.graph.built = false;
    computeDiff({ fit: true });
    showToast('已交换 A / B');
  }

  /* ------------------------------------------------------------------ *
   * Source cards
   * ------------------------------------------------------------------ */

  function renderSlots() {
    renderSlot('a');
    renderSlot('b');
    els.swapBtn.disabled = !(state.a && state.b);
    els.btnExport.disabled = !state.diff;
  }

  function renderSlot(key) {
    const isA = key === 'a';
    const slot = isA ? els.slotA : els.slotB;
    const parsed = state[key];
    const err = state.errors[key];
    const loading = state.loading[key];
    const empty = $('.slot-empty', slot);
    const loaded = $('.slot-loaded', slot);
    const loadingEl = $('.slot-loading', slot);
    const errorEl = isA ? els.errorA : els.errorB;
    slot.classList.toggle('has-file', !!parsed);
    slot.classList.toggle('error', !!err && !parsed);
    slot.classList.toggle('loading', loading);
    empty.hidden = !!parsed;
    loaded.hidden = !parsed;
    loadingEl.hidden = !loading;
    errorEl.hidden = !err;
    if (err) {
      errorEl.textContent = err;
      slot.title = err;
    }
    if (!parsed) {
      if (!err) slot.title = '';
      if (isA) {
        els.nameA.textContent = '';
        els.metaA.textContent = '';
      } else {
        els.nameB.textContent = '';
        els.metaB.textContent = '';
      }
      return;
    }
    const typeEl = isA ? els.typeA : els.typeB;
    const nameEl = isA ? els.nameA : els.nameB;
    const metaEl = isA ? els.metaA : els.metaB;
    typeEl.textContent = formatType(parsed);
    nameEl.textContent = parsed.filename || '未命名';
    nameEl.title = parsed.filename || '';
    metaEl.textContent = sourceMeta(parsed);
    const tip = [
      parsed.filename,
      sourceMeta(parsed),
      parsed.metadataKeys && parsed.metadataKeys.length ? '元数据: ' + parsed.metadataKeys.join(', ') : '',
      parsed.warnings && parsed.warnings.length ? parsed.warnings.join('\n') : ''
    ].filter(Boolean).join('\n');
    slot.title = tip;
  }

  function bindSlot(key) {
    const slot = key === 'a' ? els.slotA : els.slotB;
    const input = key === 'a' ? els.fileA : els.fileB;
    const clearBtn = key === 'a' ? els.clearA : els.clearB;

    slot.addEventListener('click', e => {
      if (e.target.closest('.slot-clear')) return;
      input.click();
    });
    slot.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    clearBtn.addEventListener('click', e => {
      e.stopPropagation();
      clearSlot(key);
    });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) loadInto(key, file);
      input.value = '';
    });

    let dragDepth = 0;
    slot.addEventListener('dragenter', e => {
      if (!hasFilePayload(e)) return;
      e.preventDefault();
      dragDepth++;
      slot.classList.add('drag-active');
    });
    slot.addEventListener('dragover', e => {
      if (!hasFilePayload(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    });
    slot.addEventListener('dragleave', e => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 && !slot.contains(e.relatedTarget)) slot.classList.remove('drag-active');
    });
    slot.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0;
      slot.classList.remove('drag-active');
      hideDragOverlay();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadInto(key, file);
    });
  }

  function hasFilePayload(e) {
    return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  }

  /* ------------------------------------------------------------------ *
   * Summary / warnings
   * ------------------------------------------------------------------ */

  function renderSummary() {
    const diff = state.diff;
    if (!diff) {
      els.summaryPanel.hidden = true;
      els.warningBox.hidden = true;
      return;
    }
    els.summaryPanel.hidden = false;
    els.totalCount.textContent = diff.stats.changedNodes;
    clear(els.summaryChips);
    const counts = diff.stats.actionCounts || { copy: 0, bypass: 0, enable: 0, mode: 0, add: 0, remove: 0 };
    const chips = [
      { key: 'copy', label: '复制', n: counts.copy, hint: diff.stats.copyParams + ' 项' },
      { key: 'bypass', label: 'Bypass', n: counts.bypass },
      { key: 'enable', label: '启用', n: counts.enable },
      { key: 'mode', label: '状态', n: counts.mode },
      { key: 'add', label: '新增', n: counts.add },
      { key: 'remove', label: '删除', n: counts.remove }
    ];
    for (const chip of chips) {
      if (!chip.n) continue;
      const meta = actionMeta(chip.key);
      const el = make('button', 'action-chip action-' + meta.className + (state.filter === chip.key ? ' active' : ''));
      el.type = 'button';
      el.title = '只看' + meta.label;
      el.append(actionIcon(meta.icon, 'action-icon'));
      el.append(make('b', '', String(chip.n)));
      el.append(make('span', '', chip.label));
      if (chip.hint) el.append(make('small', '', chip.hint));
      el.addEventListener('click', () => setFilter(chip.key));
      els.summaryChips.appendChild(el);
    }
    if (!els.summaryChips.childElementCount) {
      els.summaryChips.appendChild(make('span', 'action-chip empty', diff.identical ? '无需操作' : '无差异'));
    }
    els.copyTodoBtn.disabled = diff.identical;

    if (diff.identical) {
      const ok = make('span', 'ok');
      ok.textContent = '✓ A 与 B 完全一致，无需修改';
      els.summaryNote.replaceChildren(ok);
    } else {
      const bits = [];
      if (diff.stats.copyNodes) bits.push(diff.stats.copyNodes + ' 个节点需复制');
      if (counts.bypass) bits.push(counts.bypass + ' 个改为 Bypass');
      if (counts.enable) bits.push(counts.enable + ' 个启用');
      if (counts.add) bits.push(counts.add + ' 个新增');
      if (counts.remove) bits.push(counts.remove + ' 个删除');
      if (diff.mode === 'summary') bits.push('摘要比较');
      els.summaryNote.textContent = bits.join(' · ');
    }
    renderWarnings(diff);
  }

  function renderWarnings(diff) {
    const messages = unique([
      ...(diff.warnings || []),
      ...(diff.a.warnings || []),
      ...(diff.b.warnings || [])
    ]);
    if (!messages.length) {
      els.warningBox.hidden = true;
      return;
    }
    els.warningBox.hidden = false;
    clear(els.warningBox);
    for (const msg of messages.slice(0, 4)) {
      const line = make('div', 'warning-line');
      const icon = makeSvg('svg', { class: 'icon', 'aria-hidden': 'true' });
      const use = makeSvg('use', { href: '#i-alert' });
      icon.appendChild(use);
      line.append(icon, make('span', '', msg));
      els.warningBox.appendChild(line);
    }
  }

  /* ------------------------------------------------------------------ *
   * Diff tools & list
   * ------------------------------------------------------------------ */

  function renderDiffTools() {
    const diff = state.diff;
    els.diffTools.hidden = !diff;
    if (!diff) return;
    const counts = diff.stats.actionCounts || {};
    els.countAll.textContent = diff.stats.changedNodes;
    els.countCopy.textContent = counts.copy || 0;
    els.countBypass.textContent = counts.bypass || 0;
    els.countEnable.textContent = counts.enable || 0;
    els.countMode.textContent = counts.mode || 0;
    els.countAdd.textContent = counts.add || 0;
    els.countRemove.textContent = counts.remove || 0;
    for (const tab of els.filterTabs) {
      tab.classList.toggle('active', tab.dataset.filter === state.filter);
      const key = tab.dataset.filter;
      const n = key === 'all' ? diff.stats.changedNodes : (counts[key] || 0);
      tab.classList.toggle('is-empty', n === 0);
    }
  }

  function setFilter(filter) {
    state.filter = filter || 'all';
    renderSummary();
    renderDiffTools();
    renderDiffList();
  }

  function filterNodeResults() {
    const diff = state.diff;
    if (!diff) return [];
    const q = state.query.trim().toLowerCase();
    const out = [];
    for (const nr of diff.nodeResults) {
      if (state.filter !== 'all' && nr.action !== state.filter) continue;
      const items = nr.items;
      if (q) {
        const hay = [
          nr.groupTitle,
          nr.displayNode.label,
          nr.displayNode.subtitle,
          nr.displayNode.type,
          nr.displayNode.id,
          nr.actionLabel,
          ...items.flatMap(it => [
            it.label,
            it.paramKey,
            it.localized,
            valuePreview(it.valueA, 350),
            valuePreview(it.valueB, 350)
          ])
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push({ nr, items });
    }
    return out;
  }

  function renderDiffList() {
    const diff = state.diff;
    const list = els.diffList;
    clear(list);
    if (!diff) {
      if (state.a || state.b) {
        renderOnboarding('还差一份来源', '已经载入 ' + (state.a ? 'A 当前' : 'B 目标') + '，再拖入另一份即可生成 A→B 操作清单。', [
          'A 与 B 可以都是 JSON，也可以都是图片，或一边 JSON 一边图片。',
          '图片建议使用 ComfyUI 直接输出的原图。'
        ]);
      } else {
        renderOnboarding('从 A 和 B 开始', '把当前工作流拖到 A，把目标工作流拖到 B。', [
          'A 是当前状态，B 是你要改成的目标状态。',
          '工具会直接告诉你：复制 B 的哪些值、哪些节点要 Bypass 或启用。',
          '默认只看变更、不显示连线；点击任意节点即可左右联动定位。'
        ]);
      }
      return;
    }
    if (diff.identical) {
      const empty = make('div', 'empty-state');
      const icon = make('div', 'empty-check');
      const svg = makeSvg('svg', { class: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
      const path = makeSvg('path', { d: 'm5 12 4 4L19 6' });
      svg.appendChild(path);
      icon.appendChild(svg);
      empty.append(icon, make('h3', '', 'A 与 B 一致，无需操作'), make('p', '', '没有需要复制的 B 值，也没有 Bypass / 启用变化。'));
      list.appendChild(empty);
      return;
    }
    const filtered = filterNodeResults();
    if (!filtered.length) {
      const empty = make('div', 'empty-state');
      empty.append(
        make('h3', '', '没有符合当前筛选的节点'),
        make('p', '', '换一个操作分类或关键词；点击图上的操作标签会自动清除筛选并定位。')
      );
      list.appendChild(empty);
      return;
    }

    let currentGroup = null;
    let groupWrap = null;
    let groupNodes = 0;
    let groupDivider = null;
    for (const entry of filtered) {
      const nr = entry.nr;
      if (nr.groupTitle !== currentGroup) {
        currentGroup = nr.groupTitle;
        groupNodes = filtered.filter(x => x.nr.groupTitle === currentGroup).length;
        groupDivider = make('div', 'group-divider');
        const mark = make('span', 'group-mark');
        mark.style.background = groupColor(nr);
        groupDivider.append(
          mark,
          make('span', 'group-name', currentGroup),
          make('span', 'group-count', groupNodes + ' 节点')
        );
        list.appendChild(groupDivider);
      }
      groupWrap = renderNodeBlock(nr, entry.items);
      list.appendChild(groupWrap);
    }
    applySelectionClasses();
  }

  function groupColor(nr) {
    const n = nr.displayNode;
    const found = state.diff && state.diff.graph.groups.find(g => g.title === nr.groupTitle);
    if (found && isHexColor(found.color)) return found.color;
    return isHexColor(n.color) ? n.color : '#3f789e';
  }

  function renderOnboarding(title, body, steps) {
    const wrap = make('div', 'onboarding');
    const icon = make('div', 'onboard-icon');
    const svg = makeSvg('svg', { class: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' });
    const p1 = makeSvg('path', { d: 'M4 7h6v4H4zM14 3h6v4h-6zM14 15h6v4h-6zM4 17h6v4H4z' });
    const p2 = makeSvg('path', { d: 'M10 9h4M7 11v6M17 7v8' });
    svg.append(p1, p2);
    icon.appendChild(svg);
    wrap.append(icon, make('h3', '', title), make('p', '', body));
    if (steps && steps.length) {
      const ol = make('ol');
      for (const s of steps) ol.appendChild(make('li', '', s));
      wrap.appendChild(ol);
    }
    const tip = make('div', 'tip', '小提示：聊天软件转存的图片通常已经丢失元数据；请使用 ComfyUI 直接输出的原图。');
    wrap.appendChild(tip);
    els.diffList.appendChild(wrap);
  }

  function copyNodeBValues(nr) {
    if (!nr) return;
    const lines = [
      '[' + nr.groupTitle + '] ' + nr.displayNode.label + ' #' + nr.displayNode.id,
      '操作: ' + nr.actionLabel
    ];
    for (const item of nr.items) {
      if (item.kind === 'status') {
        lines.push('状态: ' + item.valueA + ' → ' + item.valueB);
      } else if ((item.kind === 'param' || item.kind === 'link') && item.hasB !== false && item.valueB !== undefined) {
        lines.push(item.label + ': ' + valueFull(item.valueB));
      }
    }
    copyText(lines.join('\n'), '该节点的 B 目标值');
  }

  function renderNodeBlock(nr, items) {
    const meta = actionMeta(nr.action);
    const block = make('div', 'node-block status-' + nr.status + ' action-' + meta.className);
    block.dataset.nodeKey = nr.key;
    const head = make('div', 'node-head');
    head.dataset.nodeKey = nr.key;
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.setAttribute('aria-label', '定位并查看「' + nr.displayNode.label + '」');
    head.title = '点击定位；' + nr.actionLabel;
    const bar = make('span', 'status-bar');
    const titleWrap = make('div', 'node-title-wrap');
    const name = make('div', 'node-name', nr.displayNode.label || nr.displayNode.type);
    const sub = make('div', 'node-sub');
    const subText = make('span', '', nr.displayNode.subtitle || nr.displayNode.type);
    const id = make('span', 'node-id', '#' + nr.displayNode.id);
    sub.append(subText, id);
    titleWrap.append(name, sub);
    const badges = make('div', 'node-badges');
    badges.appendChild(actionBadge(nr, true));
    let copyBtn = null;
    if (nr.copyCount) {
      copyBtn = copyIconButton('node-copy', '复制该节点全部 B 值');
      copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        copyNodeBValues(nr);
      });
    }
    head.append(bar, titleWrap, badges);
    if (copyBtn) head.appendChild(copyBtn);
    block.appendChild(head);

    const itemsWrap = make('div', 'node-items');
    for (const item of items) {
      itemsWrap.appendChild(renderDiffRow(nr, item));
    }
    block.appendChild(itemsWrap);

    const activate = () => selectNodeByKey(nr.key, { focusGraph: true, scrollList: false });
    head.addEventListener('click', e => {
      if (e.target.closest('.node-copy')) return;
      activate();
    });
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
    return block;
  }

  function renderDiffRow(nr, item) {
    const row = make('div', 'diff-row' + (item.kind === 'status' ? ' param-row-status' : ''));
    row.dataset.nodeKey = nr.key;
    row.dataset.paramKey = item.paramKey;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.setAttribute('aria-label', '查看 ' + item.label + ' 的 A 到 B 差异');
    row.title = [
      '点击查看详情',
      item.label,
      'A 当前: ' + valuePreview(item.valueA, 500),
      'B 目标: ' + valuePreview(item.valueB, 500)
    ].join('\n');

    const pLine = make('div', 'param-line');
    const pName = make('span', 'param-name', item.label || item.paramKey);
    if (item.kind === 'param' && item.paramKey && item.paramKey !== item.label) {
      pName.appendChild(make('span', 'key', item.paramKey));
    }
    pLine.appendChild(pName);
    pLine.appendChild(make('span', 'kind-mark', itemKindLabel(item.kind)));
    if (item.hasB !== false && item.valueB !== undefined && (item.kind === 'param' || item.kind === 'link')) {
      const copyB = copyIconButton('diff-copy', '复制 B 目标值');
      copyB.addEventListener('click', e => {
        e.stopPropagation();
        copyText(valueFull(item.valueB), 'B 目标值');
      });
      pLine.appendChild(copyB);
    }

    const vLine = make('div', 'value-line');
    const oldText = item.hasA === false || item.valueA === undefined ? '不存在' : valuePreview(item.valueA, 115);
    const newText = item.hasB === false || item.valueB === undefined ? '不存在' : valuePreview(item.valueB, 115);
    const aLabel = make('span', 'side-label', 'A');
    const aVal = make('span', 'value-cell' + (item.hasA === false || item.valueA === undefined ? ' missing' : ''), oldText);
    const arrow = make('span', 'arrow', '→');
    const bLabel = make('span', 'side-label b-label', 'B');
    const bVal = make('span', 'value-cell b' + (item.hasB === false || item.valueB === undefined ? ' missing' : ''), newText);
    vLine.append(aLabel, aVal, arrow, bLabel, bVal);

    row.append(pLine, vLine);
    const activate = () => selectParam(nr.key, item.paramKey);
    row.addEventListener('click', e => {
      e.stopPropagation();
      activate();
    });
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
    return row;
  }

  /* ------------------------------------------------------------------ *
   * Selection / inspector
   * ------------------------------------------------------------------ */

  function findNodeResult(key) {
    return state.diff && state.diff.nodeResults.find(nr => nr.key === key);
  }

  function ensureNodeVisibleInList(key) {
    if (!state.diff || !key) return;
    const visible = filterNodeResults().some(entry => entry.nr.key === key);
    if (visible) return;
    state.filter = 'all';
    state.query = '';
    if (els.searchInput) els.searchInput.value = '';
    renderSummary();
    renderDiffTools();
    renderDiffList();
  }

  function selectNodeByKey(key, opts) {
    if (!key) return;
    const nr = findNodeResult(key);
    if (!nr) return;
    ensureNodeVisibleInList(key);
    opts = opts || {};
    state.selectedNodeKey = key;
    state.selectedParamKey = null;
    state.selectedGraphId = (nr.bNode || nr.aNode).id;
    state.inspector = {
      nodeResult: nr,
      node: nr.displayNode,
      tab: opts.tab || 'changed',
      paramKey: null,
      graphOnly: false
    };
    renderInspector();
    applySelectionClasses();
    if (opts.focusGraph !== false) focusGraphNode(state.selectedGraphId);
    if (opts.scrollList) scrollNodeIntoView(key);
  }

  function selectParam(nodeKey, paramKey) {
    const nr = findNodeResult(nodeKey);
    if (!nr) return;
    ensureNodeVisibleInList(nodeKey);
    state.selectedNodeKey = nodeKey;
    state.selectedParamKey = paramKey;
    state.selectedGraphId = (nr.bNode || nr.aNode).id;
    state.inspector = {
      nodeResult: nr,
      node: nr.displayNode,
      tab: 'changed',
      paramKey,
      graphOnly: false
    };
    renderInspector();
    applySelectionClasses();
    focusGraphNode(state.selectedGraphId);
    scrollNodeIntoView(nodeKey);
    const item = els.inspectorBody.querySelector('[data-param-key="' + cssEscape(paramKey) + '"]');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  function selectGraphNode(id) {
    if (Date.now() < state.graph.suppressClickUntil) return;
    if (!state.diff) return;
    const gn = state.diff.graph.nodes.find(n => n.id === id);
    if (!gn) return;
    if (gn.diff) {
      // A graph click should open the detail panel and land on the first
      // changed parameter, not merely select the node.
      const first = gn.diff.items.find(it => it.kind === 'param' || it.kind === 'status' || it.kind === 'link') || gn.diff.items[0];
      if (first) selectParam(gn.diff.key, first.paramKey);
      else selectNodeByKey(gn.diff.key, { focusGraph: true, scrollList: true, tab: 'changed' });
      return;
    }
    state.selectedNodeKey = null;
    state.selectedParamKey = null;
    state.selectedGraphId = id;
    state.inspector = {
      nodeResult: null,
      node: gn,
      tab: 'all',
      paramKey: null,
      graphOnly: true
    };
    renderInspector();
    applySelectionClasses();
    focusGraphNode(id);
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function scrollNodeIntoView(key) {
    const block = els.diffList.querySelector('.node-block[data-node-key="' + cssEscape(key) + '"]');
    if (!block) return;
    block.scrollIntoView({ block: 'center', behavior: 'smooth' });
    block.classList.remove('attention');
    void block.offsetWidth;
    block.classList.add('attention');
    setTimeout(() => block.classList.remove('attention'), 1100);
  }

  function applySelectionClasses() {
    for (const block of $$('.node-block', els.diffList)) {
      block.classList.toggle('selected', block.dataset.nodeKey === state.selectedNodeKey);
    }
    for (const row of $$('.diff-row', els.diffList)) {
      row.classList.toggle('selected', row.dataset.nodeKey === state.selectedNodeKey && row.dataset.paramKey === state.selectedParamKey);
    }
    for (const [id, nodeEl] of state.graph.nodeEls) {
      nodeEl.classList.toggle('selected', id === state.selectedGraphId);
    }
    for (const [id, pinEl] of state.graph.pinEls) {
      pinEl.classList.toggle('selected', id === state.selectedGraphId);
    }
  }

  function inspectorBadges(nr, node) {
    const wrap = els.inspectorBadges;
    clear(wrap);
    if (nr) {
      wrap.appendChild(actionBadge(nr, false));
      if (nr.action === 'copy') wrap.appendChild(make('span', 'badge normal', '正常启用'));
      if (nr.status === 'added') wrap.appendChild(make('span', 'badge added', '仅 B 存在'));
      if (nr.status === 'removed') wrap.appendChild(make('span', 'badge removed', '仅 A 存在'));
      if (nr.pairBy === 'signature') wrap.appendChild(make('span', 'badge status', '按名称匹配'));
      if (nr.items.some(it => it.kind === 'link')) wrap.appendChild(make('span', 'badge status', '连线变化'));
    } else if (node && node.mode === 4) wrap.appendChild(make('span', 'badge bypass', 'BYPASS'));
    else if (node && node.mode === 2) wrap.appendChild(make('span', 'badge muted', '静音'));
    else if (node) wrap.appendChild(make('span', 'badge normal', '正常启用'));
    if (!wrap.childElementCount) wrap.appendChild(make('span', 'badge', nr ? nr.items.length + ' 项' : '无差异'));
  }

  function renderInspectorAction(nr, node) {
    const box = els.inspectorAction;
    if (!nr) {
      box.hidden = true;
      clear(box);
      return;
    }
    box.hidden = false;
    clear(box);
    const meta = actionMeta(nr.action);
    box.className = 'inspector-action action-' + meta.className;
    const iconWrap = make('div', 'ia-icon');
    iconWrap.appendChild(actionIcon(meta.icon, 'action-icon'));
    const text = make('div', 'ia-text');
    let title = nr.actionLabel;
    let sub = '';
    if (nr.action === 'copy') {
      title = '复制 B 的 ' + nr.copyCount + ' 个参数';
      sub = 'A 当前与 B 目标只有参数不同，节点状态不需要改。';
    } else if (nr.action === 'bypass') {
      title = '把该节点改为 Bypass' + (nr.copyCount ? '，并复制 ' + nr.copyCount + ' 个参数' : '');
      sub = 'A 当前：' + (nr.modeFrom === 0 ? '正常' : core.modeLabel(nr.modeFrom)) + ' → B 目标：Bypass';
    } else if (nr.action === 'enable') {
      title = '启用该节点' + (nr.copyCount ? '，并复制 ' + nr.copyCount + ' 个参数' : '');
      sub = 'A 当前：' + core.modeLabel(nr.modeFrom) + ' → B 目标：正常';
    } else if (nr.action === 'mode') {
      title = nr.actionLabel;
      sub = 'A 当前：' + core.modeLabel(nr.modeFrom) + ' → B 目标：' + core.modeLabel(nr.modeTo);
    } else if (nr.action === 'add') {
      title = 'B 新增了该节点';
      sub = '需要在 A 中补上这个节点。';
    } else if (nr.action === 'remove') {
      title = 'B 删除了该节点';
      sub = 'A 中仍存在，B 中已没有这个节点。';
    }
    text.append(make('div', 'ia-title', title));
    if (sub) text.appendChild(make('div', 'ia-sub', sub));
    box.append(iconWrap, text);
    if (nr.copyCount) {
      const copy = make('button', 'btn btn-tiny ia-copy');
      copy.type = 'button';
      copy.appendChild(actionIcon('i-copy'));
      copy.appendChild(document.createTextNode('复制 B 目标值'));
      copy.addEventListener('click', () => copyNodeBValues(nr));
      box.appendChild(copy);
    }
  }

  function renderInspector() {
    const ins = state.inspector;
    if (!ins) {
      els.inspector.hidden = true;
      return;
    }
    const node = ins.node;
    const nr = ins.nodeResult;
    els.inspector.hidden = false;
    els.inspectorGroup.textContent = (nr ? nr.groupTitle : node.group?.title || '未分组') + '  /  NODE';
    els.inspectorTitle.textContent = node.label || node.type;
    clear(els.inspectorSub);
    els.inspectorSub.append(
      document.createTextNode((node.subtitle || node.displayType || node.type) + '  '),
      make('span', 'mono', '#' + node.id)
    );
    inspectorBadges(nr, node);
    renderInspectorAction(nr, node);

    for (const btn of $$('button', els.inspectorTabs)) {
      btn.classList.toggle('active', btn.dataset.itab === ins.tab);
    }
    els.inspectorTabs.hidden = !!ins.graphOnly;

    const body = els.inspectorBody;
    clear(body);
    if (ins.tab === 'all' || ins.graphOnly) {
      renderAllParams(body, nr, node);
    } else {
      renderChangedItems(body, nr, node);
    }
    els.copyNodeId.disabled = false;
    els.copyNodeParams.disabled = !nr || !nr.copyCount;
    els.copySummary.disabled = !nr;
  }

  function renderChangedItems(body, nr, node) {
    if (!nr) {
      const notice = make('div', 'node-notice unchanged');
      notice.textContent = '这个节点没有 A→B 变更。切到「全部参数」可以查看两边的目标值。';
      body.appendChild(notice);
      return;
    }
    if (nr.status === 'added' || nr.status === 'removed') {
      const notice = make('div', 'node-notice ' + nr.status);
      notice.textContent = nr.status === 'added'
        ? '此节点只存在于 B（目标），下面列出它的全部参数。'
        : '此节点只存在于 A（当前），下面列出它的全部参数。';
      body.appendChild(notice);
      renderAllParams(body, nr, node);
      return;
    }
    if (!nr.items.length) {
      body.appendChild(make('div', 'no-changes', '没有参数差异'));
      return;
    }
    const statuses = nr.items.filter(it => it.kind === 'status');
    const others = nr.items.filter(it => it.kind !== 'status');
    if (statuses.length) {
      const label = make('div', 'inspector-section-label', '节点状态');
      body.appendChild(label);
      for (const it of statuses) body.appendChild(renderInspectorItem(nr, it));
    }
    if (others.length) {
      body.appendChild(make('div', 'inspector-section-label', '参数 / 连线'));
      for (const it of others) body.appendChild(renderInspectorItem(nr, it));
    }
  }

  function renderInspectorItem(nr, item) {
    const wrap = make('div', 'inspector-item');
    wrap.dataset.paramKey = item.paramKey;
    wrap.classList.toggle('selected', item.paramKey === state.selectedParamKey);
    const head = make('div', 'inspector-item-head');
    head.append(
      make('span', 'param-label', item.label || item.paramKey),
      make('span', 'kind-pill', itemKindLabel(item.kind))
    );
    const copyTarget = item.kind === 'status' || item.kind === 'node'
      ? '复制状态变化'
      : (item.hasB !== false && item.valueB !== undefined ? '复制 B 目标值' : '复制 A 当前值');
    const headCopy = copyIconButton('param-copy', copyTarget);
    headCopy.addEventListener('click', e => {
      e.stopPropagation();
      copyItemValue(item);
    });
    head.appendChild(headCopy);
    if (item.kind === 'param') head.appendChild(make('span', 'param-code', item.paramKey));
    wrap.appendChild(head);

    if (item.kind === 'status') {
      const row = make('div', 'status-compare');
      row.append(
        statusSide('A 当前', item.valueA, 'a'),
        make('span', 'arrow', '→'),
        statusSide('B 目标', item.valueB, 'b')
      );
      wrap.appendChild(row);
      return wrap;
    }
    if (item.kind === 'node') {
      const notice = make('div', 'node-notice ' + (nr.status === 'added' ? 'added' : 'removed'));
      notice.textContent = item.valueA + ' → ' + item.valueB;
      wrap.appendChild(notice);
      return wrap;
    }

    const values = make('div', 'compare-values');
    const aBox = compareBox('a', 'A', '当前', item.valueA, item.hasA !== false && item.valueA !== undefined, item, true);
    const bBox = compareBox('b', 'B', '目标', item.valueB, item.hasB !== false && item.valueB !== undefined, item, false);
    if (item.kind === 'param' && typeof item.valueA === 'string' && typeof item.valueB === 'string' &&
        (item.valueA.length + item.valueB.length > 90 || /[\n\r]/.test(item.valueA + item.valueB))) {
      const ops = diffTokens(item.valueA, item.valueB);
      if (ops) {
        aBox.querySelector('.box-value').replaceChildren(...textDiffNodes(ops, 'a'));
        bBox.querySelector('.box-value').replaceChildren(...textDiffNodes(ops, 'b'));
      }
    }
    values.append(aBox, bBox);
    wrap.appendChild(values);
    return wrap;
  }

  function compareBox(side, letter, sub, value, exists, item, isA) {
    const box = make('div', 'compare-box ' + side);
    const label = make('div', 'box-label');
    const b = make('b', '', letter);
    label.append(b, document.createTextNode(' · ' + sub));
    if (exists) {
      const copy = copyIconButton('box-copy', '复制 ' + letter + ' 值');
      copy.addEventListener('click', e => {
        e.stopPropagation();
        copyItemValue(item, letter);
      });
      label.appendChild(copy);
    }
    const val = make('div', 'box-value');
    if (!exists) {
      val.classList.add('missing');
      val.textContent = '不存在（该侧没有这个参数）';
    } else {
      const text = valueFull(value);
      val.textContent = text;
      if (text.length > 900) val.classList.add('diff-text');
    }
    box.append(label, val);
    return box;
  }

  function textDiffNodes(ops, side) {
    const frag = [];
    for (const op of ops) {
      if (op.type === 'equal') {
        frag.push(make('span', 'same', op.text));
      } else if (op.type === 'del' && side === 'a') {
        frag.push(make('span', 'del', op.text));
      } else if (op.type === 'ins' && side === 'b') {
        frag.push(make('span', 'ins', op.text));
      }
    }
    return frag;
  }

  function tokenizeDiff(s) {
    if (!s) return [];
    return s.split(/(\s+|[,，;；、\n])/g).filter(t => t !== '');
  }

  function diffTokens(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return null;
    if (a.length + b.length > 24000) return null;
    const A = tokenizeDiff(a);
    const B = tokenizeDiff(b);
    if (A.length > 1200 || B.length > 1200) return null;
    const n = A.length, m = B.length;
    const dp = new Uint16Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = A[i] === B[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        ops.push({ type: 'equal', text: A[i] }); i++; j++;
      } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
        ops.push({ type: 'del', text: A[i++] });
      } else {
        ops.push({ type: 'ins', text: B[j++] });
      }
    }
    while (i < n) ops.push({ type: 'del', text: A[i++] });
    while (j < m) ops.push({ type: 'ins', text: B[j++] });
    return ops;
  }

  function renderAllParams(body, nr, node) {
    const aNode = nr ? nr.aNode : (nr ? null : node);
    const bNode = nr ? nr.bNode : (nr ? null : node);
    const useA = nr ? aNode : node;
    const useB = nr ? bNode : node;
    const aParams = new Map((useA?.params || []).map(p => [p.key, p]));
    const bParams = new Map((useB?.params || []).map(p => [p.key, p]));
    const keys = [];
    for (const k of aParams.keys()) keys.push(k);
    for (const k of bParams.keys()) if (!aParams.has(k)) keys.push(k);
    if (nr && aNode && bNode && Number(aNode.mode) !== Number(bNode.mode)) {
      const statusRow = make('div', 'inspector-item');
      statusRow.append(make('div', 'inspector-section-label', '节点状态'));
      const row = make('div', 'status-compare');
      row.append(
        statusSide('A 当前', core.modeLabel(aNode.mode), 'a'),
        make('span', 'arrow', '→'),
        statusSide('B 目标', core.modeLabel(bNode.mode), 'b')
      );
      statusRow.appendChild(row);
      body.appendChild(statusRow);
    }
    if (!keys.length) {
      body.appendChild(make('div', 'no-changes', '这个节点没有可比较的控件参数。'));
      return;
    }
    const table = make('table', 'all-param-table');
    const thead = make('thead');
    const headRow = make('tr');
    headRow.append(
      make('th', 'pk', '参数'),
      make('th', 'pv', 'A 当前'),
      make('th', 'pv', 'B 目标')
    );
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const key of keys) {
      const ap = aParams.get(key);
      const bp = bParams.get(key);
      const changed = !ap || !bp || !core.valuesEqual(ap.value, bp.value);
      const tr = make('tr', changed ? 'changed' : '');
      const pk = make('td', 'pk');
      const pkText = make('div', 'pk-text');
      pkText.append(
        make('div', '', (bp && bp.label) || (ap && ap.label) || key),
        make('div', 'mono', key)
      );
      const rowCopy = copyIconButton('row-copy', bp ? '复制 B 目标值' : '复制 A 当前值');
      rowCopy.addEventListener('click', e => {
        e.stopPropagation();
        copyText(valueFull(bp ? bp.value : ap.value), bp ? 'B 值' : 'A 值');
      });
      pk.append(pkText, rowCopy);
      const av = make('td', 'pv old');
      const bv = make('td', 'pv new');
      if (ap) {
        av.textContent = valuePreview(ap.value, 300);
        av.title = valueFull(ap.value);
      } else {
        av.textContent = '—';
        av.classList.add('missing-val');
      }
      if (bp) {
        bv.textContent = valuePreview(bp.value, 300);
        bv.title = valueFull(bp.value);
      } else {
        bv.textContent = '—';
        bv.classList.add('missing-val');
      }
      tr.append(pk, av, bv);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  function copyNodeSummary() {
    const ins = state.inspector;
    if (!ins || !ins.nodeResult) {
      showToast('这个节点没有差异可复制');
      return;
    }
    const nr = ins.nodeResult;
    const lines = [
      '[' + nr.groupTitle + '] ' + nr.displayNode.label + ' · ' + (nr.displayNode.subtitle || nr.displayNode.type) + ' #' + nr.displayNode.id,
      '操作: ' + nr.actionLabel,
      'A 当前: ' + (state.a?.filename || 'A'),
      'B 目标: ' + (state.b?.filename || 'B')
    ];
    for (const item of nr.items) {
      if (item.kind === 'node') {
        lines.push('- ' + item.label + ': ' + item.valueA + ' → ' + item.valueB);
      } else {
        lines.push('- ' + item.label + ': ' + valuePreview(item.valueA, 260) + ' → ' + valuePreview(item.valueB, 260));
      }
    }
    copyText(lines.join('\n'), '节点差异摘要');
  }

  /* ------------------------------------------------------------------ *
   * Graph view
   * ------------------------------------------------------------------ */

  function clearGraph() {
    clear(els.graphViewport);
    state.graph.built = false;
    state.graph.nodeEls = new Map();
    state.graph.groupEls = new Map();
    state.graph.groupMarkEls = new Map();
    state.graph.pinEls = new Map();
    clear(els.changePins);
    clear(els.groupActions);
    els.changePins.classList.remove('visible');
    els.groupActions.classList.remove('visible');
    els.graphLegend.hidden = true;
    els.btnFit.disabled = true;
    els.btnZoomIn.disabled = true;
    els.btnZoomOut.disabled = true;
    els.btnFocusChanges.disabled = true;
    els.graphMeta.textContent = '等待载入';
    els.zoomReadout.textContent = '100%';
    updateGraphEmptyCopy();
  }

  function updateGraphEmptyCopy() {
    if (state.diff) {
      els.graphEmpty.hidden = true;
      return;
    }
    els.graphEmpty.hidden = false;
    const h2 = $('h2', els.graphEmpty);
    const ps = $$('p', els.graphEmpty);
    if (!state.a && !state.b) {
      h2.textContent = '两图一放，改动一目了然';
      ps[0].innerHTML = '左侧拖入两份 <strong>.json</strong> 工作流，或两张带 ComfyUI 元数据的成品图。';
      ps[1].hidden = false;
      ps[1].textContent = '支持 PNG 内嵌 workflow / prompt，JPEG/WebP EXIF，以及 A1111 参数摘要。';
    } else if (state.a || state.b) {
      h2.textContent = '还差一份来源';
      ps[0].textContent = '已经载入 ' + (state.a ? 'A 当前' : 'B 目标') + '，再拖入另一份即可生成 A→B 操作清单。';
      ps[1].hidden = true;
    } else {
      h2.textContent = '暂时没有可显示的图';
      ps[0].textContent = '载入两份工作流后，这里会显示它们的大致节点图。';
      ps[1].hidden = true;
    }
  }

  function renderGraph(mode) {
    const diff = state.diff;
    if (!diff) {
      clearGraph();
      return;
    }
    const old = {
      scale: state.graph.scale,
      tx: state.graph.tx,
      ty: state.graph.ty,
      selected: state.graph.selectedId,
      built: state.graph.built
    };
    const viewport = els.graphViewport;
    clear(viewport);
    state.graph.nodeEls = new Map();
    state.graph.groupEls = new Map();
    state.graph.groupMarkEls = new Map();
    state.graph.pinEls = new Map();
    clear(els.changePins);
    clear(els.groupActions);
    els.graphEmpty.hidden = true;
    els.graphLegend.hidden = false;
    els.btnFit.disabled = false;
    els.btnZoomIn.disabled = false;
    els.btnZoomOut.disabled = false;
    els.btnFocusChanges.disabled = !diff.graph.nodes.some(n => n.graphStatus !== 'unchanged');
    els.graphMeta.textContent = diff.stats.changedNodes + ' 个节点待处理 · ' + diff.stats.copyParams + ' 个 B 值 · 点击节点查看操作';

    const g = diff.graph;
    const bounds = g.bounds;
    const pad = 80;
    const bg = makeSvg('rect', {
      x: bounds.minX - 1600,
      y: bounds.minY - 1600,
      width: Math.max(1200, bounds.maxX - bounds.minX + 3200),
      height: Math.max(900, bounds.maxY - bounds.minY + 3200),
      fill: 'url(#gridPattern)',
      opacity: '.42',
      'pointer-events': 'none'
    });
    viewport.appendChild(bg);

    // Groups.
    const changedGroupTitles = new Set(diff.nodeResults.map(nr => nr.groupTitle));
    for (const group of g.groups) {
      if (!(group.w > 2 && group.h > 2)) continue;
      const groupG = makeSvg('g', {
        class: 'ggroup' + (group.removed ? ' removed-group' : '') + (changedGroupTitles.has(group.title) ? ' has-changes' : '')
      });
      const color = isHexColor(group.color) ? group.color : '#3f789e';
      const box = makeSvg('rect', {
        x: group.x, y: group.y, width: group.w, height: group.h,
        rx: 8,
        fill: hexToRgba(color, group.removed ? 0.025 : 0.045),
        stroke: hexToRgba(color, group.removed ? 0.52 : 0.36),
        'stroke-width': 1.2,
        'vector-effect': 'non-scaling-stroke'
      });
      box.setAttribute('class', 'group-box');
      const label = makeSvg('text', {
        x: group.x + 12, y: group.y + 20,
        fill: hexToRgba(color, 0.95),
        'font-size': '12.5',
        'font-family': 'var(--sans)',
        'font-weight': '600',
        'letter-spacing': '.04em'
      });
      label.textContent = truncateText(group.title, Math.max(6, Math.floor((group.w - 24) / 7)));
      groupG.append(box, label);
      viewport.appendChild(groupG);
      state.graph.groupEls.set(group.title, groupG);
    }

    // Links.
    const nodeMap = new Map(g.nodes.map(n => [n.id, n]));
    for (const link of g.links || []) {
      const source = nodeMap.get(String(link.source));
      const target = nodeMap.get(String(link.target));
      if (!source || !target || source.graphStatus === 'removed' || target.graphStatus === 'removed') continue;
      const sx = source.x + Math.max(40, source.w);
      const sy = source.y + 30 + Math.min(60, (Number(link.sourceSlot) || 0) * 12);
      const tx = target.x;
      const ty = target.y + 34 + Math.min(70, (Number(link.targetSlot) || 0) * 12);
      const dx = Math.max(36, Math.min(150, Math.abs(tx - sx) * 0.45));
      const path = makeSvg('path', {
        class: 'glink',
        d: 'M' + sx + ',' + sy + ' C' + (sx + dx) + ',' + sy + ' ' + (tx - dx) + ',' + ty + ' ' + tx + ',' + ty,
        fill: 'none',
        stroke: '#4e6f91',
        'stroke-width': '1',
        opacity: '.22',
        'vector-effect': 'non-scaling-stroke'
      });
      viewport.appendChild(path);
    }

    // Nodes.
    for (const n of g.nodes) {
      const nr = n.diff;
      const meta = nr ? actionMeta(nr.action) : null;
      const modeClass = modeClassForNode(n);
      const actionKey = nr ? nr.action : 'none';
      const nodeG = makeSvg('g', {
        class: 'gnode ' + (n.graphStatus || 'unchanged') + ' ' + modeClass +
          (nr ? ' action-' + meta.className : ' action-none'),
        'data-id': n.id,
        'data-action': actionKey,
        transform: 'translate(' + n.x + ',' + n.y + ')'
      });
      const rawFill = isHexColor(n.bgcolor) ? n.bgcolor : '#18212c';
      const rawStroke = isHexColor(n.color) ? n.color : '#33465c';
      const statusTint = n.mode === 4 ? '#1a1224' : (n.mode === 2 ? '#191d23' : '#10241a');
      const actionTints = {
        copy: '#3a2a10',
        bypass: '#2a1740',
        enable: '#0e2a19',
        mode: '#102437',
        add: '#0e2b20',
        remove: '#301514'
      };
      const baseTint = nr ? (actionTints[actionKey] || statusTint) : statusTint;
      const fill = mixHex(rawFill, baseTint, nr ? 0.34 : (n.mode === 4 ? 0.52 : (n.mode === 2 ? 0.42 : 0.18)));
      const stroke = mixHex(rawStroke, '#3a4d62', 0.22);

      if (nr) {
        let outlineColor = '#f0a93b';
        if (actionKey === 'bypass') outlineColor = nr.copyCount ? 'url(#bypassCopyGradient)' : '#b58cff';
        else if (actionKey === 'enable') outlineColor = nr.copyCount ? 'url(#enableCopyGradient)' : '#46c46a';
        else if (actionKey === 'mode') outlineColor = '#58a6ff';
        else if (actionKey === 'add') outlineColor = '#46c46a';
        else if (actionKey === 'remove') outlineColor = '#f2645c';
        const outline = makeSvg('rect', {
          class: 'action-outline action-' + meta.className,
          x: -4, y: -4,
          width: Math.max(40, n.w) + 8,
          height: Math.max(30, n.h) + 8,
          rx: 9,
          fill: 'none',
          stroke: outlineColor,
          'stroke-width': nr.copyCount && actionKey !== 'copy' ? '2.2' : '1.7',
          'vector-effect': 'non-scaling-stroke',
          'pointer-events': 'none'
        });
        nodeG.appendChild(outline);
      }

      const rect = makeSvg('rect', {
        class: 'node-bg',
        x: 0, y: 0, width: Math.max(40, n.w), height: Math.max(30, n.h),
        rx: 6,
        fill,
        stroke,
        'stroke-width': '1.15',
        'vector-effect': 'non-scaling-stroke'
      });
      nodeG.appendChild(rect);
      if (n.mode === 4) {
        const overlay = makeSvg('rect', {
          x: 0, y: 0, width: Math.max(40, n.w), height: Math.max(30, n.h),
          rx: 6,
          fill: 'url(#bypassPattern)',
          'pointer-events': 'none'
        });
        nodeG.appendChild(overlay);
      }
      if (nr) {
        const patternId = actionKey === 'bypass' ? 'bypassHatch' :
          actionKey === 'copy' ? 'copyDots' :
            actionKey === 'enable' || actionKey === 'add' ? 'enableWash' :
              'statusWash';
        nodeG.appendChild(makeSvg('rect', {
          class: 'action-fill action-' + meta.className,
          x: 0, y: 0, width: Math.max(40, n.w), height: Math.max(30, n.h),
          rx: 6,
          fill: 'url(#' + patternId + ')',
          opacity: '.7',
          'pointer-events': 'none'
        }));
      }
      const accentColor = nr ?
        (actionKey === 'copy' ? '#f0a93b' :
          actionKey === 'bypass' ? '#b58cff' :
            actionKey === 'enable' || actionKey === 'add' ? '#46c46a' :
              actionKey === 'remove' ? '#f2645c' : '#58a6ff') :
        statusColorForNode(n);
      const accent = makeSvg('rect', {
        x: 0, y: 0, width: nr ? 5 : 3.5, height: Math.max(30, n.h),
        rx: 2,
        fill: accentColor,
        opacity: n.graphStatus === 'unchanged' ? '.7' : '.98'
      });
      nodeG.appendChild(accent);

      const textColor = n.graphStatus === 'removed' ? '#d9a29e' : '#e3eaf2';
      const titleFs = n.w < 160 ? 10.5 : 12;
      const title = makeSvg('text', {
        class: 'node-text',
        x: 11, y: 19,
        fill: textColor,
        'font-size': String(titleFs),
        'font-weight': '600',
        'font-family': 'var(--sans)'
      });
      title.textContent = truncateText(n.label || n.type, Math.max(4, Math.floor((n.w - 22) / (titleFs * 0.56))));
      nodeG.appendChild(title);

      const subText = (n.subtitle || n.displayType || n.type) + '  #' + n.id;
      const sub = makeSvg('text', {
        class: 'node-text',
        x: 11, y: 35,
        fill: '#8494a7',
        'font-size': '9.5',
        'font-family': 'var(--sans)'
      });
      sub.textContent = truncateText(subText, Math.max(6, Math.floor((n.w - 22) / 5.4)));
      nodeG.appendChild(sub);

      const isSummaryNode = /参数摘要|生成参数摘要/.test(n.group?.title || '');
      if (isSummaryNode && n.h > 66) {
        const candidate = n.params.find(p => typeof p.value === 'string' && p.value.length > 8) || n.params[0];
        if (candidate) {
          const preview = candidate.label + ': ' + core.oneLine(candidate.value, 80);
          const previewEl = makeSvg('text', {
            class: 'node-text',
            x: 11, y: 55,
            fill: '#9aabbe',
            'font-size': '9.8',
            'font-family': 'var(--sans)'
          });
          previewEl.textContent = truncateText(preview, Math.max(6, Math.floor((n.w - 22) / 5.2)));
          nodeG.appendChild(previewEl);
        }
      } else if (n.graphStatus !== 'unchanged' && n.diff && n.h > 62) {
        const labels = n.diff.items
          .filter(it => it.kind !== 'node')
          .map(it => it.label)
          .filter((v, i, arr) => arr.indexOf(v) === i);
        const summaryText = labels.slice(0, 2).join(' · ') + (labels.length > 2 ? ' +' + (labels.length - 2) : '');
        if (summaryText) {
          const changeText = makeSvg('text', {
            class: 'node-text',
            x: 11, y: 54,
            fill: n.graphStatus === 'added' ? '#7bd990' : n.graphStatus === 'removed' ? '#f29a94' : '#e0ad5e',
            'font-size': '9.5',
            'font-family': 'var(--mono)'
          });
          changeText.textContent = truncateText(summaryText, Math.max(5, Math.floor((n.w - 22) / 5.6)));
          nodeG.appendChild(changeText);
        }
      }

      if (n.w > 64) {
        const sText = statusLabelForNode(n);
        const sColor = statusColorForNode(n);
        const sX = Math.max(40, n.w) - 8;
        const sY = Math.max(30, n.h) - 8;
        const status = makeSvg('text', {
          class: 'node-text node-status-text',
          x: sX, y: sY,
          fill: sColor,
          'font-size': '8',
          'font-family': 'var(--mono)',
          'text-anchor': 'end',
          opacity: '.9'
        });
        status.textContent = sText;
        nodeG.appendChild(status);
        const dotX = sX - sText.length * 5.1 - 7;
        if (dotX > 4) {
          nodeG.appendChild(makeSvg('circle', {
            class: 'node-status-dot',
            cx: dotX, cy: sY - 2.6, r: 2.2,
            fill: sColor,
            opacity: '.9'
          }));
        }
      }

      if (nr && n.w > 120 && n.h > 52) {
        const actionText = nr.action === 'copy' ? ('复制 B ×' + (nr.copyCount || 1)) :
          nr.actionLabel + (nr.copyCount && nr.action !== 'copy' ? ' +' + nr.copyCount : '');
        const actionColor = actionKey === 'copy' ? '#f0a93b' :
          actionKey === 'bypass' ? '#c5a7ff' :
            actionKey === 'enable' || actionKey === 'add' ? '#7bd990' :
              actionKey === 'remove' ? '#f29a94' : '#8cc8ff';
        const actionTextEl = makeSvg('text', {
          class: 'node-text node-diff-text',
          x: 11, y: Math.max(30, n.h) - 8,
          fill: actionColor,
          'font-size': '8.5',
          'font-family': 'var(--mono)',
          opacity: '.95'
        });
        actionTextEl.textContent = actionText;
        nodeG.appendChild(actionTextEl);
      }

      if (nr) {
        const r = 9;
        const cx = Math.max(40, n.w) - 10;
        const cy = 10;
        const color = actionKey === 'copy' ? '#f0a93b' :
          actionKey === 'bypass' ? '#b58cff' :
            actionKey === 'enable' || actionKey === 'add' ? '#46c46a' :
              actionKey === 'remove' ? '#f2645c' : '#58a6ff';
        nodeG.appendChild(makeSvg('circle', {
          class: 'node-diff-badge',
          cx, cy, r, fill: color, opacity: '.98'
        }));
        const badgeText = makeSvg('text', {
          x: cx, y: cy + 3.2,
          fill: '#081018',
          'font-size': '8',
          'font-weight': '700',
          'font-family': 'var(--mono)',
          'text-anchor': 'middle'
        });
        const badgeCount = nr.action === 'copy' ? (nr.copyCount || n.changeCount || 1) : (n.changeCount || 1);
        badgeText.textContent = String(Math.min(99, badgeCount));
        nodeG.appendChild(badgeText);
      }

      const titleEl = makeSvg('title');
      titleEl.textContent = [
        n.label + '  #' + n.id,
        n.subtitle || n.displayType || n.type,
        '组：' + (n.group?.title || '未分组'),
        '状态：' + core.modeLabel(n.mode),
        n.graphStatus === 'unchanged' ? '无差异' : (nr ? nr.actionLabel : '有差异'),
        '点击查看 B 目标值和操作详情'
      ].join('\n');
      nodeG.appendChild(titleEl);

      nodeG.addEventListener('click', e => {
        e.stopPropagation();
        if (Date.now() < state.graph.suppressClickUntil) return;
        selectGraphNode(n.id);
      });
      viewport.appendChild(nodeG);
      state.graph.nodeEls.set(n.id, nodeG);
    }

    buildChangePins(g);
    buildGroupSummaries();
    state.graph.built = true;
    state.graph.selectedId = state.selectedGraphId;
    applyGraphModes();
    applySelectionClasses();
    updateActionOverlays();

    if (mode === 'preserve' && old.built) {
      state.graph.scale = old.scale;
      state.graph.tx = old.tx;
      state.graph.ty = old.ty;
      applyGraphTransform();
    } else {
      requestAnimationFrame(() => fitGraph());
    }
  }

  function pinLabel(n) {
    const nr = n.diff;
    const meta = actionMeta(nr?.action);
    if (!nr) return meta.short;
    if (nr.action === 'copy') return '复制 ' + (nr.copyCount || n.changeCount || 1);
    if (nr.copyCount) return meta.short + ' +' + nr.copyCount;
    return meta.short;
  }

  function buildChangePins(graph) {
    clear(els.changePins);
    state.graph.pinEls = new Map();
    for (const n of graph.nodes) {
      if (n.graphStatus === 'unchanged' || !n.diff) continue;
      const nr = n.diff;
      const meta = actionMeta(nr.action);
      const pin = make('button', 'change-pin action-' + meta.className);
      pin.type = 'button';
      pin.dataset.id = n.id;
      pin.dataset.action = nr.action;
      const main = make('span', 'pin-main');
      main.appendChild(actionIcon(meta.icon, 'action-icon'));
      main.appendChild(make('span', 'pin-label', pinLabel(n)));
      if (nr.action !== 'bypass' && nr.action !== 'add' && nr.action !== 'remove') {
        const st = statusLabelForNode(n);
        const stCls = st === 'BYPASS' ? 'bypass' : st === 'MUTE' ? 'mute' : 'normal';
        main.appendChild(make('span', 'pin-status ' + stCls, st));
      }
      pin.appendChild(main);
      pin.appendChild(make('span', 'pin-node', n.label || n.type));
      pin.title = (n.group?.title || '未分组') + ' / ' + n.label + '  #' + n.id + '\n' +
        nr.actionLabel + ' · 点击查看 B 目标值';
      pin.setAttribute('aria-label', pin.title);
      pin.addEventListener('click', e => {
        e.stopPropagation();
        const first = nr.items.find(it => it.kind === 'param' || it.kind === 'status' || it.kind === 'link') || nr.items[0];
        if (first) selectParam(nr.key, first.paramKey);
        else selectNodeByKey(nr.key, { focusGraph: true, scrollList: true });
      });
      els.changePins.appendChild(pin);
      state.graph.pinEls.set(n.id, pin);
    }
  }

  function buildGroupSummaries() {
    clear(els.groupActions);
    state.graph.groupMarkEls = new Map();
    if (!state.diff) return;
    const groups = new Map();
    for (const nr of state.diff.nodeResults) {
      if (!groups.has(nr.groupTitle)) groups.set(nr.groupTitle, { actions: {}, total: 0 });
      const entry = groups.get(nr.groupTitle);
      entry.actions[nr.action] = (entry.actions[nr.action] || 0) + 1;
      entry.total++;
    }
    for (const [title, info] of groups) {
      const group = state.diff.graph.groups.find(g => g.title === title);
      if (!group) continue;
      const el = make('button', 'group-action-summary');
      el.type = 'button';
      el.title = title + '：' + info.total + ' 个变更节点';
      el.appendChild(make('span', 'gas-name', title));
      const items = make('span', 'gas-items');
      for (const key of ['copy', 'bypass', 'enable', 'mode', 'add', 'remove']) {
        if (!info.actions[key]) continue;
        const meta = actionMeta(key);
        const mini = make('span', 'gas-chip action-' + meta.className);
        mini.appendChild(actionIcon(meta.icon, 'action-icon'));
        mini.appendChild(document.createTextNode(String(info.actions[key])));
        mini.title = meta.label + ' ' + info.actions[key];
        items.appendChild(mini);
      }
      el.appendChild(items);
      el.addEventListener('click', e => {
        e.stopPropagation();
        const nodes = state.diff.graph.nodes.filter(n => n.graphStatus !== 'unchanged' && (n.group?.title || '未分组') === title);
        const b = nodeBounds(nodes);
        if (b) {
          state.graph.autoFit = false;
          fitBounds(b, 120, 0.98);
        }
      });
      els.groupActions.appendChild(el);
      state.graph.groupMarkEls.set(title, { el, group });
    }
  }

  function updateChangePins() {
    if (!state.diff || !state.graph.built) {
      els.changePins.classList.remove('visible');
      return;
    }
    const g = state.graph;
    const show = g.scale < 0.62;
    els.changePins.classList.toggle('visible', show);
    if (!show) return;
    const vw = els.graphWrap.clientWidth;
    const vh = els.graphWrap.clientHeight;
    // Make sure every pin has layout even if the previous pass hid it offscreen;
    // measuring a display:none pin as 0 breaks overlap avoidance.
    for (const pin of state.graph.pinEls.values()) {
      pin.style.display = 'flex';
      pin.style.visibility = 'hidden';
    }
    const byId = new Map(state.diff.graph.nodes.map(n => [n.id, n]));
    const placed = [];
    for (const [id, pin] of state.graph.pinEls) {
      const n = byId.get(id);
      if (!n) { pin.style.display = 'none'; continue; }
      const w = pin.offsetWidth || 54;
      const h = pin.offsetHeight || 32;
      const cx = (n.x + Math.max(40, n.w) / 2) * g.scale + g.tx;
      const cy = (n.y + Math.max(30, n.h) / 2) * g.scale + g.ty;
      if (cx < -30 || cx > vw + 30 || cy < -30 || cy > vh + 30) {
        pin.style.display = 'none';
        continue;
      }
      let chosen = null;
      for (const dy of [0, -h - 5, h + 5, -2 * (h + 5), 2 * (h + 5), -3 * (h + 5), 3 * (h + 5)]) {
        const rect = { x1: cx - w / 2, y1: cy + dy - h / 2, x2: cx + w / 2, y2: cy + dy + h / 2 };
        const clash = placed.some(p => rect.x1 < p.x2 && rect.x2 > p.x1 && rect.y1 < p.y2 && rect.y2 > p.y1);
        if (!clash) { chosen = { ...rect, cy: cy + dy }; break; }
      }
      const rect = chosen || { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, cy };
      placed.push(rect);
      pin.style.display = 'flex';
      pin.style.visibility = '';
      pin.style.left = ((rect.x1 + rect.x2) / 2) + 'px';
      pin.style.top = rect.cy + 'px';
      pin.classList.toggle('pin-offset', Math.abs(rect.cy - cy) > 2);
    }
  }

  function updateGroupSummaries() {
    if (!state.diff || !state.graph.built) {
      els.groupActions.classList.remove('visible');
      return;
    }
    const g = state.graph;
    const show = state.graph.onlyChanges && g.scale >= 0.14 && g.scale < 0.55;
    els.groupActions.classList.toggle('visible', show);
    if (!show) return;
    const vw = els.graphWrap.clientWidth;
    const vh = els.graphWrap.clientHeight;
    for (const [title, entry] of state.graph.groupMarkEls) {
      const group = entry.group;
      const x = group.x * g.scale + g.tx + 7;
      const y = group.y * g.scale + g.ty + 6;
      const visible = x > -120 && x < vw + 20 && y > -30 && y < vh + 30;
      entry.el.style.display = visible ? 'flex' : 'none';
      entry.el.style.left = x + 'px';
      entry.el.style.top = y + 'px';
    }
  }

  function updateZoomLod() {
    const scale = state.graph.scale;
    els.graphWrap.classList.toggle('zoom-far', scale < 0.36);
    els.graphWrap.classList.toggle('zoom-mid', scale >= 0.36 && scale < 0.68);
  }

  function updateActionOverlays() {
    updateChangePins();
    updateGroupSummaries();
    updateZoomLod();
  }

  function mixHex(hex, target, amount) {
    if (!isHexColor(hex)) return target;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    let t = target.replace('#', '');
    if (t.length === 3) t = t.split('').map(c => c + c).join('');
    const mix = (a, b) => Math.round(a + (b - a) * amount).toString(16).padStart(2, '0');
    return '#' +
      mix(parseInt(h.slice(0, 2), 16), parseInt(t.slice(0, 2), 16)) +
      mix(parseInt(h.slice(2, 4), 16), parseInt(t.slice(2, 4), 16)) +
      mix(parseInt(h.slice(4, 6), 16), parseInt(t.slice(4, 6), 16));
  }

  function modeClassForNode(n) {
    if (Number(n.mode) === 4) return 'mode-bypass';
    if (Number(n.mode) === 2) return 'mode-muted';
    return 'mode-normal';
  }

  function statusLabelForNode(n) {
    if (Number(n.mode) === 4) return 'BYPASS';
    if (Number(n.mode) === 2) return 'MUTE';
    return 'ON';
  }

  function statusColorForNode(n) {
    if (Number(n.mode) === 4) return '#b58cff';
    if (Number(n.mode) === 2) return '#8b99aa';
    return '#59c07a';
  }

  function truncateText(text, max) {
    text = String(text || '');
    if (text.length <= max) return text;
    return text.slice(0, Math.max(1, max - 1)) + '…';
  }

  function applyGraphModes() {
    if (state.diff && state.diff.identical) state.graph.onlyChanges = false;
    if (state.graph.onlyChanges) state.graph.showLinks = false;
    els.graphWrap.classList.toggle('focus-changes', state.graph.onlyChanges);
    els.graphWrap.classList.toggle('hide-links', !state.graph.showLinks);
    els.btnOnlyChanges.classList.toggle('active', state.graph.onlyChanges);
    els.btnLinks.classList.toggle('active', state.graph.showLinks);
    if (!state.diff) return;
    const changedGroups = new Set();
    for (const n of state.diff.graph.nodes) {
      if (n.graphStatus !== 'unchanged') changedGroups.add(n.group?.title || '未分组');
    }
    for (const [title, el] of state.graph.groupEls) {
      el.classList.toggle('has-changes', changedGroups.has(title));
    }
    for (const [id, el] of state.graph.nodeEls) {
      el.classList.toggle('selected', id === state.selectedGraphId);
    }
    updateActionOverlays();
  }

  function applyGraphTransform() {
    const g = state.graph;
    els.graphViewport.setAttribute('transform', 'translate(' + g.tx + ',' + g.ty + ') scale(' + g.scale + ')');
    els.zoomReadout.textContent = Math.round(g.scale * 100) + '%';
    updateActionOverlays();
  }

  function nodeBounds(nodes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + Math.max(40, n.w));
      maxY = Math.max(maxY, n.y + Math.max(30, n.h));
    }
    if (!nodes.length) return null;
    return { minX, minY, maxX, maxY };
  }

  function fitGraph(padding) {
    if (!state.diff || !state.graph.built) return;
    state.graph.autoFit = true;
    let bounds = state.diff.graph.bounds;
    if (state.graph.onlyChanges) {
      const changed = state.diff.graph.nodes.filter(n => n.graphStatus !== 'unchanged');
      const cb = nodeBounds(changed);
      if (cb) bounds = cb;
    }
    fitBounds(bounds, padding == null ? 86 : padding, 1.35);
  }

  function fitBounds(bounds, padding, maxScale) {
    const vw = els.graphWrap.clientWidth;
    const vh = els.graphWrap.clientHeight;
    if (!vw || !vh) {
      requestAnimationFrame(() => fitBounds(bounds, padding, maxScale));
      return;
    }
    const bw = Math.max(120, bounds.maxX - bounds.minX);
    const bh = Math.max(80, bounds.maxY - bounds.minY);
    let scale = Math.min((vw - padding * 2) / bw, (vh - padding * 2) / bh);
    scale = Math.max(0.025, Math.min(maxScale || 1.35, scale));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const tx = vw / 2 - cx * scale;
    const ty = vh / 2 - cy * scale;
    animateView(scale, tx, ty, 260);
  }

  function focusGraphNode(id) {
    if (!state.diff || !state.graph.built) return;
    const n = state.diff.graph.nodes.find(x => x.id === id);
    if (!n) return;
    state.graph.autoFit = false;
    const vw = els.graphWrap.clientWidth;
    const vh = els.graphWrap.clientHeight;
    if (!vw || !vh) return;
    const inspectorOpen = state.inspector && !els.inspector.hidden;
    const usableW = inspectorOpen && vw > 900 ? vw - 386 : vw;
    const scale = Math.max(0.65, Math.min(1.3, state.graph.scale < 0.65 ? 0.78 : Math.max(state.graph.scale, 0.65)));
    const cx = (n.x + Math.max(40, n.w) / 2);
    const cy = (n.y + Math.max(30, n.h) / 2);
    const tx = usableW / 2 - cx * scale;
    const ty = vh / 2 - cy * scale;
    animateView(scale, tx, ty, 330);
  }

  function animateView(scale, tx, ty, duration) {
    const g = state.graph;
    cancelAnimationFrame(g.animation);
    const from = { scale: g.scale, tx: g.tx, ty: g.ty };
    const start = performance.now();
    const d = duration || 220;
    function step(now) {
      const t = Math.min(1, (now - start) / d);
      const e = 1 - Math.pow(1 - t, 3);
      g.scale = from.scale + (scale - from.scale) * e;
      g.tx = from.tx + (tx - from.tx) * e;
      g.ty = from.ty + (ty - from.ty) * e;
      applyGraphTransform();
      if (t < 1) g.animation = requestAnimationFrame(step);
    }
    g.animation = requestAnimationFrame(step);
  }

  function zoomAt(clientX, clientY, factor) {
    if (!state.diff || !state.graph.built) return;
    cancelAnimationFrame(state.graph.animation);
    const rect = els.graphWrap.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const g = state.graph;
    g.autoFit = false;
    const oldScale = g.scale;
    const newScale = Math.max(0.025, Math.min(3.4, oldScale * factor));
    const wx = (sx - g.tx) / oldScale;
    const wy = (sy - g.ty) / oldScale;
    g.scale = newScale;
    g.tx = sx - wx * newScale;
    g.ty = sy - wy * newScale;
    applyGraphTransform();
  }

  function zoomBy(factor) {
    const rect = els.graphWrap.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  function focusChanges() {
    if (!state.diff) return;
    const changed = state.diff.graph.nodes.filter(n => n.graphStatus !== 'unchanged');
    if (!changed.length) {
      showToast('没有可聚焦的变更节点');
      return;
    }
    if (changed.length === 1) {
      focusGraphNode(changed[0].id);
      return;
    }
    state.graph.autoFit = false;
    fitBounds(nodeBounds(changed), 120, 0.98);
  }

  function bindGraphInteraction() {
    els.graphWrap.addEventListener('wheel', e => {
      if (!state.diff || !state.graph.built) return;
      if (e.target.closest('.inspector') || e.target.closest('.toast')) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0014);
      zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    let pan = null;
    els.graphWrap.addEventListener('pointerdown', e => {
      if (!state.diff || !state.graph.built) return;
      if (e.button !== 0) return;
      if (e.target.closest('.inspector') || e.target.closest('.graph-actions') || e.target.closest('.toast')) return;
      pan = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        tx: state.graph.tx,
        ty: state.graph.ty,
        moved: false,
        captured: false
      };
      // Important: do NOT setPointerCapture here. Pointer capture retargets
      // pointerup/click to graphWrap, which makes real clicks on SVG nodes
      // (and on the HTML change pins) silently do nothing. Capture only after
      // the pointer has actually moved enough to be a pan gesture.
    });
    els.graphWrap.addEventListener('pointermove', e => {
      if (!pan || e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      if (!pan.moved && Math.abs(dx) + Math.abs(dy) <= 4) return;
      if (!pan.moved) {
        pan.moved = true;
        try {
          els.graphWrap.setPointerCapture(e.pointerId);
          pan.captured = true;
        } catch (_) {}
        els.graphWrap.style.cursor = 'grabbing';
      }
      cancelAnimationFrame(state.graph.animation);
      state.graph.autoFit = false;
      state.graph.tx = pan.tx + dx;
      state.graph.ty = pan.ty + dy;
      applyGraphTransform();
    });
    const endPan = e => {
      if (!pan || e.pointerId !== pan.id) return;
      const moved = pan.moved;
      pan = null;
      els.graphWrap.style.cursor = '';
      try {
        if (els.graphWrap.hasPointerCapture && els.graphWrap.hasPointerCapture(e.pointerId)) {
          els.graphWrap.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      if (moved) state.graph.suppressClickUntil = Date.now() + 180;
    };
    window.addEventListener('pointerup', endPan, true);
    window.addEventListener('pointercancel', endPan, true);
    els.graphWrap.addEventListener('dblclick', e => {
      if (e.target.closest('.inspector')) return;
      fitGraph();
    });
  }

  /* ------------------------------------------------------------------ *
   * Toolbar / help / init
   * ------------------------------------------------------------------ */

  function renderAll() {
    renderSlots();
    renderSummary();
    renderDiffTools();
    renderDiffList();
    updateGraphEmptyCopy();
    els.btnExport.disabled = !state.diff;
  }

  function bindToolbar() {
    els.swapBtn.addEventListener('click', swapSources);
    els.btnExport.addEventListener('click', () => {
      if (!state.diff) return;
      const md = core.buildMarkdownReport(state.diff);
      downloadText('ComfyUI-diff-' + timestampForFile() + '.md', md, 'text/markdown');
      showToast('报告已导出');
    });
    els.btnHelp.addEventListener('click', openHelp);
    els.helpClose.addEventListener('click', closeHelp);
    els.helpModal.addEventListener('click', e => {
      if (e.target === els.helpModal) closeHelp();
    });

    for (const tab of els.filterTabs) {
      tab.addEventListener('click', () => {
        if (tab.classList.contains('is-empty') && tab.dataset.filter !== 'all') return;
        setFilter(tab.dataset.filter);
      });
    }
    els.searchInput.addEventListener('input', debounce(() => {
      state.query = els.searchInput.value;
      renderDiffList();
    }, 110));
    els.copyTodoBtn.addEventListener('click', () => {
      if (!state.diff) return;
      copyText(core.buildActionChecklist(state.diff), 'A→B 待办清单');
    });

    els.btnOnlyChanges.addEventListener('click', () => {
      state.graph.onlyChanges = !state.graph.onlyChanges;
      applyGraphModes();
      fitGraph();
    });
    els.btnLinks.addEventListener('click', () => {
      // Links only make sense with the unchanged context visible. Turning on
      // links automatically leaves "只看变更" mode.
      if (state.graph.onlyChanges) state.graph.onlyChanges = false;
      state.graph.showLinks = !state.graph.showLinks;
      applyGraphModes();
      fitGraph();
    });
    els.btnFit.addEventListener('click', () => fitGraph());
    els.btnZoomIn.addEventListener('click', () => zoomBy(1.2));
    els.btnZoomOut.addEventListener('click', () => zoomBy(1 / 1.2));
    els.btnFocusChanges.addEventListener('click', focusChanges);

    els.inspectorClose.addEventListener('click', closeInspector);
    for (const btn of $$('button', els.inspectorTabs)) {
      btn.addEventListener('click', () => {
        if (!state.inspector) return;
        state.inspector.tab = btn.dataset.itab;
        renderInspector();
      });
    }
    els.copyNodeId.addEventListener('click', () => {
      if (!state.inspector) return;
      copyText(String(state.inspector.node.id), '节点 ID');
    });
    els.copyNodeParams.addEventListener('click', () => {
      if (!state.inspector || !state.inspector.nodeResult) {
        showToast('这个节点没有 A→B 变更');
        return;
      }
      copyNodeBValues(state.inspector.nodeResult);
    });
    els.copySummary.addEventListener('click', copyNodeSummary);

    document.addEventListener('keydown', e => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
      if (e.key === 'Escape' && !els.dragOverlay.hidden) {
        hideDragOverlay();
        return;
      }
      if (e.key === 'Escape') {
        if (!els.helpModal.hidden) { closeHelp(); return; }
        if (state.inspector) { closeInspector(); return; }
        if (typing && els.searchInput.value) {
          els.searchInput.value = '';
          state.query = '';
          renderDiffList();
        }
      }
      if (typing) return;
      if (e.key === '0') { e.preventDefault(); fitGraph(); }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.2); }
      if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.2); }
    });
  }

  function closeInspector() {
    state.inspector = null;
    state.selectedNodeKey = null;
    state.selectedParamKey = null;
    state.selectedGraphId = null;
    els.inspector.hidden = true;
    applySelectionClasses();
  }

  function openHelp() {
    els.helpModal.hidden = false;
    setTimeout(() => els.helpClose.focus(), 20);
  }
  function closeHelp() {
    els.helpModal.hidden = true;
    els.btnHelp.focus();
  }

  function bindGlobalDrop() {
    window.addEventListener('dragenter', e => {
      if (!hasFilePayload(e)) return;
      e.preventDefault();
      showDragOverlay();
    });
    window.addEventListener('dragover', e => {
      if (!hasFilePayload(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      showDragOverlay();
    });
    window.addEventListener('dragleave', e => {
      // relatedTarget is null when the pointer leaves the window. Do not
      // inspect dataTransfer here: some browsers expose an empty types list on
      // dragleave, which used to leave the overlay stuck on screen.
      if (!e.relatedTarget) hideDragOverlay();
    });
    window.addEventListener('drop', e => {
      hideDragOverlay();
      if (!hasFilePayload(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      handleGlobalFiles(files);
    });
    window.addEventListener('dragend', hideDragOverlay);
    window.addEventListener('blur', hideDragOverlay);
    window.addEventListener('pointerdown', () => {
      if (!els.dragOverlay.hidden) hideDragOverlay();
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hideDragOverlay();
    });
  }

  function handleGlobalFiles(files) {
    if (!files.length) return;
    if (files.length >= 2) {
      loadInto('a', files[0]);
      loadInto('b', files[1]);
      if (files.length > 2) showToast('一次比较两个文件，已使用前两个。');
      return;
    }
    const file = files[0];
    if (!state.a) return loadInto('a', file);
    if (!state.b) return loadInto('b', file);
    loadInto('b', file);
  }

  function bindResize() {
    let timer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!state.diff || !state.graph.built) return;
        if (state.graph.autoFit) fitGraph();
        else applyGraphTransform();
      }, 120);
    });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(debounce(() => {
        if (!state.diff || !state.graph.built) return;
        if (state.graph.autoFit) fitGraph();
        else if (!state.graph.animation) applyGraphTransform();
      }, 100));
      ro.observe(els.graphWrap);
    }
  }

  function exposeDebugApi() {
    window.__comfyDiff = {
      state,
      els,
      loadInto,
      computeDiff,
      selectNodeByKey,
      selectParam,
      fitGraph,
      focusGraphNode,
      sourceMeta
    };
  }

  function init() {
    bindSlot('a');
    bindSlot('b');
    bindToolbar();
    bindGraphInteraction();
    bindGlobalDrop();
    bindResize();
    renderAll();
    clearGraph();
    exposeDebugApi();
  }

  init();
})();
