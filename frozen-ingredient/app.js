(function () {
  'use strict';

  const TAB_KEY = 'reishoku.active.tab.v1';
  const APP_ID = 'frozen_ingredients';
  const MENU_URL = new URL('../menu.html?openExternalBrowser=1', window.location.href).href;
  const ids = [
    'authScreen', 'appShell', 'loginMessage', 'homeButton', 'refreshButton', 'signOutButton',
    'syncStatus', 'currentRole', 'currentUser',
    'inboundForm', 'inboundFridge', 'inboundMaterial', 'inboundExpiration',
    'inboundQuantity', 'inboundUnit', 'inboundNote', 'outboundForm', 'outboundFridge', 'outboundMaterial',
    'outboundLotList', 'outboundQuantity', 'outboundUnit', 'outboundAvailable', 'outboundNote', 'fridgeInventoryList',
    'materialInventoryList', 'fridgeMasterPanel', 'materialMasterPanel', 'fridgeForm', 'fridgeId',
    'fridgeName', 'fridgeNote', 'fridgeActive', 'clearFridgeForm', 'fridgeMasterList', 'materialForm',
    'materialId', 'supplierName', 'materialName', 'materialUnit', 'materialActive', 'clearMaterialForm',
    'materialMasterList', 'toast'
  ];
  const panels = {
    inbound: 'tabInbound',
    outbound: 'tabOutbound',
    fridges: 'tabFridges',
    materials: 'tabMaterials',
    master: 'tabMaster'
  };
  const state = {
    client: null,
    loggedIn: false,
    workerId: '',
    session: null,
    role: '',
    activeTab: getStore(TAB_KEY) || 'inbound',
    masterMode: 'fridges',
    selectedLotId: '',
    fridges: [],
    materials: [],
    lots: []
  };
  const el = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    ids.forEach((id) => { el[id] = document.getElementById(id); });
    bind();
    icons();
    const config = readConfig();
    if (!configured(config)) return showAuth('本番Supabaseの接続設定を読み込めませんでした。');
    try {
      await connect(config);
    } catch (error) {
      showAuth(message(error));
      toast(message(error), 'error');
    }
  }

  function bind() {
    el.homeButton.addEventListener('click', returnToMenu);
    el.refreshButton.addEventListener('click', () => loadData());
    el.signOutButton.addEventListener('click', signOut);
    el.inboundForm.addEventListener('submit', inbound);
    el.inboundMaterial.addEventListener('change', renderUnits);
    el.outboundForm.addEventListener('submit', outbound);
    el.outboundFridge.addEventListener('change', () => {
      state.selectedLotId = '';
      renderOutboundMaterials();
    });
    el.outboundMaterial.addEventListener('change', () => {
      state.selectedLotId = '';
      renderOutboundLots();
      renderUnits();
    });
    el.outboundLotList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-lot-id]');
      if (!button) return;
      state.selectedLotId = button.dataset.lotId;
      renderOutboundLots();
    });
    el.fridgeForm.addEventListener('submit', saveFridge);
    el.materialForm.addEventListener('submit', saveMaterial);
    el.clearFridgeForm.addEventListener('click', resetFridgeForm);
    el.clearMaterialForm.addEventListener('click', resetMaterialForm);
    el.fridgeMasterList.addEventListener('click', editFridge);
    el.materialMasterList.addEventListener('click', editMaterial);
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => setTab(button.dataset.tab));
    });
    document.querySelectorAll('[data-master-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.masterMode = button.dataset.masterMode;
        renderMasterMode();
      });
    });
  }

  async function connect(config) {
    if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase client library was not loaded.');
    if (!window.BusinessAuth) throw new Error('共通認証を読み込めませんでした。');
    window.BusinessAuth.init(config.supabaseUrl, config.supabaseAnonKey);
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      global: { fetch: window.BusinessAuth.authorizedFetch }
    });
    status('接続中', true);
    const session = await window.BusinessAuth.session();
    if (!window.BusinessAuth.allows(session, APP_ID, 'viewer')) {
      showAuth('業務管理メニューでログインしてください。');
      window.location.replace(MENU_URL);
      return;
    }
    state.session = session;
    state.workerId = session.workerId;
    state.role = session.permissions[APP_ID];
    state.loggedIn = true;
    showApp();
    renderAccess();
    await loadData();
  }

  async function signOut() {
    try { await window.BusinessAuth.logout(); } finally { window.location.replace(MENU_URL); }
  }

  function returnToMenu() { window.location.href = MENU_URL; }

  async function loadData(options) {
    if (!state.client || !state.loggedIn) return;
    if (!options || !options.silent) status('更新中', true);
    const [fridges, materials, lots] = await Promise.all([
      state.client.from('frozen_ingredient_fridges').select('*').order('name', { ascending: true }),
      state.client.from('frozen_ingredient_materials').select('*').order('supplier_name', { ascending: true }).order('material_name', { ascending: true }),
      state.client
        .from('frozen_ingredient_stock_lots')
        .select('id, fridge_id, material_id, expiration_date, quantity, received_at, updated_at, fridge:frozen_ingredient_fridges(id, name, is_active), material:frozen_ingredient_materials(id, supplier_name, material_name, is_active)')
        .gt('quantity', 0)
        .order('expiration_date', { ascending: true })
    ]);
    const error = fridges.error || materials.error || lots.error;
    if (error) {
      status('更新失敗');
      return toast(message(error), 'error');
    }
    state.fridges = fridges.data || [];
    state.materials = materials.data || [];
    state.lots = (lots.data || []).map((lot) => ({ ...lot, quantity: Number(lot.quantity || 0) }));
    renderAll();
    status(`更新済み ${time(new Date())}`);
  }

  async function inbound(event) {
    event.preventDefault();
    if (!can('operator')) return toast('入庫操作の権限がありません。', 'error');
    const payload = {
      p_worker_id: state.workerId,
      p_fridge_id: el.inboundFridge.value,
      p_material_id: el.inboundMaterial.value,
      p_expiration_date: el.inboundExpiration.value,
      p_quantity: Number(el.inboundQuantity.value),
      p_note: clean(el.inboundNote.value) || null
    };
    if (!payload.p_fridge_id || !payload.p_material_id || !payload.p_expiration_date || payload.p_quantity <= 0) return toast('入庫内容を確認してください。', 'error');
    await runForm(el.inboundForm, '入庫登録中', async () => {
      const { error } = await state.client.rpc('frozen_ingredient_record_inbound', payload);
      if (error) throw error;
      el.inboundQuantity.value = '';
      el.inboundNote.value = '';
      toast('入庫を登録しました。');
    });
  }

  async function outbound(event) {
    event.preventDefault();
    if (!can('operator')) return toast('出庫操作の権限がありません。', 'error');
    const quantity = Number(el.outboundQuantity.value);
    if (!state.selectedLotId || quantity <= 0) return toast('出庫する在庫と数量を確認してください。', 'error');
    await runForm(el.outboundForm, '出庫登録中', async () => {
      const { error } = await state.client.rpc('frozen_ingredient_record_outbound', {
        p_worker_id: state.workerId,
        p_lot_id: state.selectedLotId,
        p_quantity: quantity,
        p_note: clean(el.outboundNote.value) || null
      });
      if (error) throw error;
      state.selectedLotId = '';
      el.outboundQuantity.value = '';
      el.outboundNote.value = '';
      toast('出庫を登録しました。');
    });
  }

  async function runForm(form, busyText, action) {
    setForm(form, true);
    status(busyText, true);
    try {
      await action();
      await loadData({ silent: true });
    } catch (error) {
      status('処理失敗');
      toast(message(error), 'error');
    } finally {
      setForm(form, false);
    }
  }

  async function saveFridge(event) {
    event.preventDefault();
    if (!can('admin')) return toast('マスタ管理の権限がありません。', 'error');
    const id = el.fridgeId.value;
    const values = { name: clean(el.fridgeName.value), note: clean(el.fridgeNote.value) || null, is_active: el.fridgeActive.checked };
    if (!values.name) return;
    const query = id
      ? state.client.from('frozen_ingredient_fridges').update(values).eq('id', id)
      : state.client.from('frozen_ingredient_fridges').insert(values);
    const { error } = await query;
    if (error) return toast(message(error), 'error');
    resetFridgeForm();
    toast('冷蔵庫を保存しました。');
    await loadData({ silent: true });
  }

  async function saveMaterial(event) {
    event.preventDefault();
    if (!can('admin')) return toast('マスタ管理の権限がありません。', 'error');
    const id = el.materialId.value;
    const values = {
      supplier_name: clean(el.supplierName.value),
      material_name: clean(el.materialName.value),
      unit_name: clean(el.materialUnit.value),
      is_active: el.materialActive.checked
    };
    if (!values.supplier_name || !values.material_name || !values.unit_name) return;
    const query = id
      ? state.client.from('frozen_ingredient_materials').update(values).eq('id', id)
      : state.client.from('frozen_ingredient_materials').insert(values);
    const { error } = await query;
    if (error) return toast(message(error), 'error');
    resetMaterialForm();
    toast('原料を保存しました。');
    await loadData({ silent: true });
  }

  function renderAll() {
    renderTabs();
    renderSelects();
    renderFridgeInventory();
    renderMaterialInventory();
    renderMasterMode();
    renderMasterLists();
    renderUnits();
    icons();
  }

  function renderTabs() {
    const permittedTabs = Object.keys(panels).filter(tabAllowed);
    if (!permittedTabs.includes(state.activeTab)) state.activeTab = can('operator') ? 'inbound' : 'fridges';
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.hidden = !tabAllowed(button.dataset.tab);
      button.classList.toggle('active', button.dataset.tab === state.activeTab);
    });
    document.querySelector('.bottom-tabs').style.gridTemplateColumns = `repeat(${permittedTabs.length}, minmax(0, 1fr))`;
    Object.entries(panels).forEach(([tab, id]) => document.getElementById(id).classList.toggle('hidden', tab !== state.activeTab));
  }

  function setTab(tab) {
    if (!tabAllowed(tab)) return;
    state.activeTab = tab;
    setStore(TAB_KEY, state.activeTab);
    renderTabs();
    if (state.activeTab === 'outbound') renderOutboundLots();
    icons();
  }

  function renderSelects() {
    const activeFridges = sortName(state.fridges.filter((item) => item.is_active));
    const activeMaterials = sortMaterials(state.materials.filter((item) => item.is_active));
    fillSelect(el.inboundFridge, activeFridges, (item) => item.name, '冷蔵庫が未登録です');
    fillSelect(el.inboundMaterial, activeMaterials, materialLabel, '原料が未登録です');
    const fridgeIds = new Set(activeLots().map((lot) => lot.fridge_id));
    fillSelect(el.outboundFridge, sortName(state.fridges.filter((item) => fridgeIds.has(item.id))), (item) => item.name, '出庫できる在庫がありません');
    renderOutboundMaterials();
    renderUnits();
  }

  function renderOutboundMaterials() {
    const fridgeId = el.outboundFridge.value;
    const ids = new Set(activeLots().filter((lot) => lot.fridge_id === fridgeId).map((lot) => lot.material_id));
    fillSelect(el.outboundMaterial, sortMaterials(state.materials.filter((item) => ids.has(item.id))), materialLabel, 'この冷蔵庫に在庫がありません');
    renderOutboundLots();
    renderUnits();
  }

  function renderOutboundLots() {
    const fridgeId = el.outboundFridge.value;
    const materialId = el.outboundMaterial.value;
    const lots = activeLots().filter((lot) => lot.fridge_id === fridgeId && lot.material_id === materialId).sort(compareLotsForFridge);
    if (!lots.some((lot) => lot.id === state.selectedLotId)) state.selectedLotId = '';
    if (!lots.length) {
      el.outboundLotList.innerHTML = '<div class="empty-row">出庫できる在庫がありません。</div>';
      el.outboundAvailable.value = '';
      return;
    }
    el.outboundLotList.innerHTML = lots.map((lot) => {
      const selected = lot.id === state.selectedLotId;
      const exp = expiry(lot.expiration_date);
      const material = materialFor(lot);
      return `<button class="lot-choice ${selected ? 'selected' : ''}" type="button" data-lot-id="${esc(lot.id)}">
        <span>${esc(date(lot.expiration_date))}</span>
        <strong>${esc(qtyUnit(lot.quantity, material))}</strong>
        <small class="${exp.className}">${esc(exp.label)}</small>
      </button>`;
    }).join('');
    const lot = lots.find((item) => item.id === state.selectedLotId);
    el.outboundAvailable.value = lot ? qtyUnit(lot.quantity, materialFor(lot)) : '';
  }

  function renderFridgeInventory() {
    const groups = groupBy(activeLots().sort(compareLotsForFridge), (lot) => lot.fridge_id);
    el.fridgeInventoryList.innerHTML = sortName(state.fridges).map((fridge) => {
      const lots = groups.get(fridge.id) || [];
      if (!lots.length) return '';
      const rows = lots.map((lot) => stockRow(lot, 'fridge')).join('');
      return `<article class="inventory-group">
        <div class="group-header"><h3>${esc(fridge.name)}</h3><div class="quantity">${esc(fridgeSummary(lots))}</div></div>
        ${rows}
      </article>`;
    }).join('') || '<div class="empty-row">在庫がありません。</div>';
  }

  function renderMaterialInventory() {
    const groups = groupBy(activeLots().sort(compareLotsForMaterial), (lot) => lot.material_id);
    el.materialInventoryList.innerHTML = sortMaterials(state.materials).map((material) => {
      const lots = groups.get(material.id) || [];
      if (!lots.length) return '';
      const rows = lots.map((lot) => stockRow(lot, 'material')).join('');
      return `<article class="inventory-group">
        <div class="group-header"><div><h3>${esc(material.material_name)}</h3><div class="stock-sub">${esc(materialMeta(material))}</div></div><div class="quantity">${esc(qtyUnit(sum(lots), material))}</div></div>
        ${rows}
      </article>`;
    }).join('') || '<div class="empty-row">在庫がありません。</div>';
  }

  function stockRow(lot, mode) {
    const exp = expiry(lot.expiration_date);
    const material = materialFor(lot);
    const title = mode === 'fridge' ? materialName(material) : lot.fridge ? lot.fridge.name : '冷蔵庫不明';
    const sub = mode === 'fridge' ? materialMeta(material) : '';
    return `<div class="stock-row">
      <div>
        <div class="stock-title">${esc(title)}</div>
        <div class="stock-sub">${esc(sub)}</div>
        <div class="stock-meta"><span class="date-pill ${exp.className}">${esc(date(lot.expiration_date))}</span><span class="date-pill ${exp.className}">${esc(exp.label)}</span></div>
      </div>
      <div class="quantity">${esc(qtyUnit(lot.quantity, material))}</div>
    </div>`;
  }

  function renderMasterMode() {
    document.querySelectorAll('[data-master-mode]').forEach((button) => button.classList.toggle('active', button.dataset.masterMode === state.masterMode));
    el.fridgeMasterPanel.classList.toggle('hidden', state.masterMode !== 'fridges');
    el.materialMasterPanel.classList.toggle('hidden', state.masterMode !== 'materials');
  }

  function renderMasterLists() {
    el.fridgeMasterList.innerHTML = sortName(state.fridges).map((fridge) => masterItem(fridge.name, fridge.note, fridge.is_active, 'fridge', fridge.id)).join('') || '<div class="empty-row">冷蔵庫が未登録です。</div>';
    el.materialMasterList.innerHTML = sortMaterials(state.materials).map((material) => masterItem(material.material_name, materialMeta(material), material.is_active, 'material', material.id)).join('') || '<div class="empty-row">原料が未登録です。</div>';
  }

  function masterItem(title, sub, active, kind, id) {
    return `<div class="master-item">
      <div class="master-main"><div><div class="master-title">${esc(title)}</div><div class="master-sub">${esc(sub || '')}</div></div></div>
      <div class="master-actions"><span class="state-pill ${active ? 'active' : 'paused'}">${active ? '使用中' : '停止中'}</span><button class="icon-button" type="button" data-edit-${kind}="${esc(id)}" aria-label="編集" title="編集"><i data-lucide="pencil"></i></button></div>
    </div>`;
  }

  function fillSelect(select, rows, label, emptyLabel) {
    const previous = select.value;
    select.innerHTML = '';
    if (!rows.length) {
      const option = new Option(emptyLabel, '');
      option.disabled = true;
      option.selected = true;
      select.append(option);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    rows.forEach((row) => select.append(new Option(label(row), row.id)));
    if (rows.some((row) => row.id === previous)) select.value = previous;
  }

  function editFridge(event) {
    const button = event.target.closest('[data-edit-fridge]');
    if (!button) return;
    const fridge = state.fridges.find((item) => item.id === button.dataset.editFridge);
    if (!fridge) return;
    el.fridgeId.value = fridge.id;
    el.fridgeName.value = fridge.name || '';
    el.fridgeNote.value = fridge.note || '';
    el.fridgeActive.checked = Boolean(fridge.is_active);
    el.fridgeName.focus();
  }

  function editMaterial(event) {
    const button = event.target.closest('[data-edit-material]');
    if (!button) return;
    const material = state.materials.find((item) => item.id === button.dataset.editMaterial);
    if (!material) return;
    el.materialId.value = material.id;
    el.supplierName.value = material.supplier_name || '';
    el.materialName.value = material.material_name || '';
    el.materialUnit.value = material.unit_name || 'kg';
    el.materialActive.checked = Boolean(material.is_active);
    el.supplierName.focus();
  }

  function resetFridgeForm() {
    el.fridgeId.value = '';
    el.fridgeName.value = '';
    el.fridgeNote.value = '';
    el.fridgeActive.checked = true;
  }

  function resetMaterialForm() {
    el.materialId.value = '';
    el.supplierName.value = '';
    el.materialName.value = '';
    el.materialUnit.value = 'kg';
    el.materialActive.checked = true;
  }

  function showAuth(text) {
    el.authScreen.classList.remove('hidden');
    el.appShell.classList.add('hidden');
    el.loginMessage.textContent = text || '';
    icons();
  }

  function showApp() {
    el.authScreen.classList.add('hidden');
    el.appShell.classList.remove('hidden');
    renderTabs();
  }

  function readConfig() {
    return {
      supabaseUrl: window.APP_CONFIG && window.APP_CONFIG.supabaseUrl ? window.APP_CONFIG.supabaseUrl : '',
      supabaseAnonKey: window.APP_CONFIG && window.APP_CONFIG.supabaseAnonKey ? window.APP_CONFIG.supabaseAnonKey : ''
    };
  }

  function configured(config) {
    return Boolean(config && config.supabaseUrl && config.supabaseAnonKey && !String(config.supabaseUrl).includes('YOUR-') && !String(config.supabaseAnonKey).includes('YOUR-'));
  }

  function can(minimum) { return window.BusinessAuth.allows(state.session, APP_ID, minimum); }
  function tabAllowed(tab) {
    if (!panels[tab]) return false;
    if (tab === 'master') return can('admin');
    if (tab === 'inbound' || tab === 'outbound') return can('operator');
    return can('viewer');
  }
  function renderAccess() {
    const names = { admin: '管理者', operator: '作業者', viewer: '閲覧者' };
    el.currentRole.textContent = names[state.role] || state.role;
    el.currentUser.textContent = state.session ? state.session.workerName : '';
    renderTabs();
  }
  function activeLots() { return state.lots.filter((lot) => Number(lot.quantity) > 0); }
  function renderUnits() {
    const inboundMaterial = state.materials.find((item) => item.id === el.inboundMaterial.value);
    const outboundMaterial = state.materials.find((item) => item.id === el.outboundMaterial.value);
    el.inboundUnit.textContent = unitName(inboundMaterial) || '単位';
    el.outboundUnit.textContent = unitName(outboundMaterial) || '単位';
  }
  function materialFor(lot) {
    return state.materials.find((item) => item.id === lot.material_id) || lot.material || null;
  }
  function materialLabel(material) {
    const unit = unitName(material);
    return `${material.supplier_name} / ${material.material_name}${unit ? `（${unit}）` : ''}`;
  }
  function materialName(material) { return material ? material.material_name : '原料不明'; }
  function materialMeta(material) {
    if (!material) return '';
    const unit = unitName(material);
    return unit ? `${material.supplier_name} / ${unit}` : material.supplier_name;
  }
  function unitName(material) {
    return clean(material && material.unit_name);
  }
  function qtyUnit(value, material) {
    const unit = unitName(material);
    return unit ? `${qty(value)} ${unit}` : qty(value);
  }
  function fridgeSummary(lots) {
    const units = new Set(lots.map((lot) => unitName(materialFor(lot))).filter(Boolean));
    if (units.size === 1) return qtyUnit(sum(lots), materialFor(lots[0]));
    return `${lots.length}ロット`;
  }
  function sortName(items) { return [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja')); }
  function sortMaterials(items) {
    return [...items].sort((a, b) => String(a.supplier_name || '').localeCompare(String(b.supplier_name || ''), 'ja') || String(a.material_name || '').localeCompare(String(b.material_name || ''), 'ja'));
  }
  function compareLotsForFridge(a, b) { return a.expiration_date.localeCompare(b.expiration_date) || materialName(materialFor(a)).localeCompare(materialName(materialFor(b)), 'ja'); }
  function compareLotsForMaterial(a, b) {
    return a.expiration_date.localeCompare(b.expiration_date) || String(a.fridge && a.fridge.name || '').localeCompare(String(b.fridge && b.fridge.name || ''), 'ja');
  }
  function groupBy(items, keyFn) {
    const map = new Map();
    items.forEach((item) => {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }
  function sum(lots) { return lots.reduce((total, lot) => total + Number(lot.quantity || 0), 0); }
  function expiry(text) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [y, m, d] = String(text).split('-').map(Number);
    const diff = Math.ceil((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
    if (diff < 0) return { className: 'expired', label: `${Math.abs(diff)}日超過` };
    if (diff === 0) return { className: 'soon', label: '本日期限' };
    return { className: diff <= 7 ? 'soon' : '', label: `残り${diff}日` };
  }
  function date(text) {
    if (!text) return '';
    const [y, m, d] = String(text).split('-');
    return `${y}/${m}/${d}`;
  }
  function time(dateValue) {
    return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(dateValue);
  }
  function qty(value) {
    return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 }).format(Number(value || 0));
  }
  function status(text, busy) {
    el.syncStatus.textContent = text;
    el.syncStatus.classList.toggle('busy', Boolean(busy));
  }
  function setForm(form, disabled) {
    form.querySelectorAll('input, select, button').forEach((item) => { item.disabled = disabled; });
  }
  function toast(text, type) {
    el.toast.textContent = text;
    el.toast.classList.toggle('error', type === 'error');
    el.toast.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.add('hidden'), 3200);
  }
  function message(error) {
    const text = error && error.message ? error.message : String(error || '');
    if (text.includes('Failed to fetch')) return 'Supabaseと接続できませんでした。';
    if (text.includes('active worker not found')) return '有効な作業者でログインしてください。';
    if (text.includes('not enough stock')) return '在庫数量が不足しています。';
    if (text.includes('active fridge not found')) return '使用中の冷蔵庫を選択してください。';
    if (text.includes('active material not found')) return '使用中の原料を選択してください。';
    if (text.includes('duplicate key')) return '同じ内容がすでに登録されています。';
    if (text.includes('frozen_ingredient_record_inbound')) return 'SupabaseのSQLセットアップを確認してください。';
    return text || '処理に失敗しました。';
  }
  function clean(value) { return String(value == null ? '' : value).trim(); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
  function icons() {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }
  function getStore(key) {
    try { return window.localStorage.getItem(key); } catch (_error) { return null; }
  }
  function setStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_error) {}
  }
  function removeStore(key) {
    try { window.localStorage.removeItem(key); } catch (_error) {}
  }
})();
