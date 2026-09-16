(function () {
  'use strict';

  const CONFIG_KEY = 'reishoku.supabase.config.v1';
  const APP_ID = 'frozen_ingredients';
  const ALL_CATEGORIES = '__all__';
  const TAB_KEY = 'reishoku.active.tab.v1';
  const CATEGORY_KEY = 'reishoku.active.category.v1';
  const WORKER_KEY = 'reishoku.workerId';
  const LOGIN_KEY = 'reishoku.login.v1';
  const ids = [
    'setupScreen', 'authScreen', 'appShell', 'setupForm', 'setupUrl', 'setupAnonKey',
    'authForm', 'loginWorkerSelect', 'loginPin', 'loginMessage', 'refreshButton', 'signOutButton',
    'syncStatus', 'categorySelect', 'workerSelect', 'inboundForm', 'inboundFridge', 'inboundMaterial', 'inboundExpiration',
    'inboundQuantity', 'inboundUnit', 'inboundNote', 'inboundStockFridgeTab', 'inboundStockMaterialTab',
    'inboundFridgeInventoryPanel', 'inboundMaterialInventoryPanel', 'inboundFridgeInventoryList', 'inboundMaterialInventoryList', 'outboundForm', 'outboundFridge', 'outboundMaterial',
    'outboundLotList', 'outboundQuantity', 'outboundUnit', 'outboundAvailable', 'outboundNote', 'fridgeInventoryList',
    'materialInventoryList', 'categoryMasterPanel', 'fridgeMasterPanel', 'materialMasterPanel',
    'categoryForm', 'categoryId', 'categoryName', 'categoryDisplayOrder', 'categoryActive', 'clearCategoryForm',
    'categoryMasterList', 'fridgeForm', 'fridgeId',
    'fridgeName', 'fridgeNote', 'fridgeActive', 'clearFridgeForm', 'fridgeMasterList', 'materialForm',
    'materialId', 'materialCategory', 'supplierName', 'materialName', 'materialUnit', 'materialActive', 'clearMaterialForm',
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
    commonAuth: null,
    commonMode: false,
    commonSession: null,
    loggedIn: false,
    workerId: getStore(WORKER_KEY) || '',
    activeCategoryId: '',
    activeTab: getStore(TAB_KEY) || 'inbound',
    inboundStockMode: 'fridges',
    masterMode: 'categories',
    selectedLotId: '',
    workers: [],
    categories: [],
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
    fillSetup(config);
    if (!configured(config)) return showSetup();
    try {
      await connect(config);
    } catch (error) {
      showSetup();
      toast(message(error), 'error');
    }
  }

  function bind() {
    el.setupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const config = {
        supabaseUrl: el.setupUrl.value.trim(),
        supabaseAnonKey: el.setupAnonKey.value.trim()
      };
      if (!configured(config)) return toast('Supabaseの接続情報を入力してください。', 'error');
      setJson(CONFIG_KEY, config);
      await connect(config);
    });
    el.authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await login();
    });
    el.refreshButton.addEventListener('click', () => loadData());
    el.signOutButton.addEventListener('click', signOut);
    el.categorySelect.addEventListener('change', () => {
      state.activeCategoryId = el.categorySelect.value;
      setStore(CATEGORY_KEY, state.activeCategoryId);
      state.selectedLotId = '';
      renderAll();
    });
    el.workerSelect.addEventListener('change', () => {
      if (state.commonMode) {
        el.workerSelect.value = state.workerId;
        toast('作業者を変更する場合は、ログアウトして選び直してください。');
        return;
      }
      const worker = activeWorkers().find((item) => item.workerId === el.workerSelect.value);
      if (!worker) return;
      state.workerId = worker.workerId;
      saveLogin(worker);
      renderWorkers();
    });
    el.inboundForm.addEventListener('submit', inbound);
    el.inboundMaterial.addEventListener('change', renderUnits);
    document.querySelectorAll('[data-inbound-stock-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.inboundStockMode = button.dataset.inboundStockMode === 'materials' ? 'materials' : 'fridges';
        renderInboundStockMode();
      });
    });
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
    el.categoryForm.addEventListener('submit', saveCategory);
    el.fridgeForm.addEventListener('submit', saveFridge);
    el.materialForm.addEventListener('submit', saveMaterial);
    el.materialCategory.addEventListener('change', () => {
      renderMasterLists();
      icons();
    });
    el.clearCategoryForm.addEventListener('click', resetCategoryForm);
    el.clearFridgeForm.addEventListener('click', resetFridgeForm);
    el.clearMaterialForm.addEventListener('click', () => resetMaterialForm());
    el.categoryMasterList.addEventListener('click', editCategory);
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
    state.commonAuth = initCommonAuth(config);
    state.commonMode = state.commonAuth ? await state.commonAuth.mode(APP_ID) : false;
    state.client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey,
      state.commonAuth ? { global: { fetch: state.commonAuth.authorizedFetch } } : undefined
    );
    status('接続中', true);
    if (state.commonMode) {
      await loadCommonLoginUsers();
      const session = await state.commonAuth.session();
      if (validCommonSession(session)) return unlockCommon(session);
      showAuth('共通PINでログインしてください。');
      status('未ログイン');
      return;
    }
    await loadWorkers();
    if (restoreLogin()) return unlock();
    showAuth('ログインしてください。');
    status('未ログイン');
  }

  function initCommonAuth(config) {
    if (!window.BusinessAuth) return null;
    const commonConfig = window.BusinessConfig || {};
    const url = commonConfig.url || config.supabaseUrl;
    const key = commonConfig.key || config.supabaseAnonKey;
    window.BusinessAuth.init(url, key);
    return window.BusinessAuth;
  }

  async function loadCommonLoginUsers() {
    const users = await state.commonAuth.users(APP_ID);
    state.workers = (users || []).map(mapCommonWorker);
    renderWorkers();
    if (!state.workers.length) showAuth('資材在庫の利用権限がある作業者が未登録です。');
  }

  function validCommonSession(session) {
    return Boolean(session && session.ok !== false && state.commonAuth.allows(session, APP_ID, 'viewer'));
  }

  async function unlockCommon(session) {
    state.commonSession = session;
    state.workerId = session.workerId;
    setStore(WORKER_KEY, session.workerId);
    removeStore(LOGIN_KEY);
    if (!state.workers.some((worker) => worker.workerId === session.workerId)) {
      state.workers.push(mapCommonWorker(session, state.workers.length));
    }
    await unlock();
  }

  async function loadWorkers() {
    const { data, error } = await state.client
      .from('workers')
      .select('worker_id, worker_name, role, display_order, active, note')
      .order('display_order', { ascending: true })
      .order('worker_id', { ascending: true });
    if (error) throw error;
    state.workers = (data || []).map(mapWorker);
    renderWorkers();
    if (!state.workers.length) showAuth('作業者マスタが未登録です。');
  }

  async function login() {
    el.loginMessage.textContent = '';
    try {
      if (state.commonMode) return await loginCommon();
      return await loginLegacy();
    } catch (error) {
      el.loginMessage.textContent = message(error);
    }
  }

  async function loginCommon() {
    const worker = activeWorkers().find((item) => item.workerId === el.loginWorkerSelect.value);
    if (!worker) return showAuth('作業者を選択してください。');
    const session = await state.commonAuth.login(worker.workerId, el.loginPin.value, APP_ID);
    if (!validCommonSession(session)) {
      el.loginMessage.textContent = '資材在庫の利用権限がありません。';
      return;
    }
    el.loginPin.value = '';
    await unlockCommon(session);
  }

  async function loginLegacy() {
    const worker = activeWorkers().find((item) => item.workerId === el.loginWorkerSelect.value);
    if (!worker) return showAuth('作業者を選択してください。');
    const pin = workerPin(worker);
    if (!pin) return el.loginMessage.textContent = '旧方式のPINが未設定です。共通PINで運用する場合は共通認証SQLと権限設定を確認してください。';
    if (clean(el.loginPin.value) !== pin) return el.loginMessage.textContent = 'PINが違います。';
    state.workerId = worker.workerId;
    saveLogin(worker);
    el.loginPin.value = '';
    await unlock();
  }

  function saveLogin(worker) {
    setStore(WORKER_KEY, worker.workerId);
    setJson(LOGIN_KEY, { workerId: worker.workerId, workerName: worker.workerName, loggedInAt: new Date().toISOString() });
  }

  function restoreLogin() {
    const saved = getJson(LOGIN_KEY);
    if (!saved || !saved.workerId) return false;
    const worker = activeWorkers().find((item) => item.workerId === saved.workerId);
    if (!worker) return false;
    state.workerId = worker.workerId;
    setStore(WORKER_KEY, worker.workerId);
    return true;
  }

  async function signOut() {
    if (state.commonMode && state.commonAuth) {
      try { await state.commonAuth.logout(); } catch (_error) {}
    }
    removeStore(LOGIN_KEY);
    removeStore(WORKER_KEY);
    state.commonSession = null;
    state.loggedIn = false;
    state.workerId = '';
    state.lots = [];
    if (state.commonMode && state.commonAuth) {
      try { await loadCommonLoginUsers(); } catch (_error) {}
    }
    showAuth('ログアウトしました。');
    status('未ログイン');
  }

  async function unlock() {
    state.loggedIn = true;
    showApp();
    renderWorkers();
    await loadData();
  }

  async function loadData(options) {
    if (!state.client || !state.loggedIn) return;
    if (!options || !options.silent) status('更新中', true);
    const workersQuery = state.commonMode
      ? commonWorkersResult()
      : state.client.from('workers').select('worker_id, worker_name, role, display_order, active, note').order('display_order', { ascending: true }).order('worker_id', { ascending: true });
    const [workers, categories, fridges, materials, lots] = await Promise.all([
      workersQuery,
      state.client.from('inventory_item_categories').select('*').order('display_order', { ascending: true }).order('name', { ascending: true }),
      state.client.from('frozen_ingredient_fridges').select('*').order('name', { ascending: true }),
      state.client.from('frozen_ingredient_materials').select('*').order('supplier_name', { ascending: true }).order('material_name', { ascending: true }),
      state.client
        .from('frozen_ingredient_stock_lots')
        .select('id, fridge_id, material_id, expiration_date, quantity, received_at, updated_at, fridge:frozen_ingredient_fridges(id, name, is_active), material:frozen_ingredient_materials(id, category_id, supplier_name, material_name, unit_name, is_active)')
        .gt('quantity', 0)
        .order('expiration_date', { ascending: true })
    ]);
    const error = workers.error || categories.error || fridges.error || materials.error || lots.error;
    if (error) {
      status('更新失敗');
      return toast(message(error), 'error');
    }
    state.workers = state.commonMode ? (workers.data || []).map(mapCommonWorker) : (workers.data || []).map(mapWorker);
    state.categories = categories.data || [];
    if (!activeWorkers().some((worker) => worker.workerId === state.workerId)) {
      await signOut();
      return showAuth('作業者が無効になりました。再ログインしてください。');
    }
    state.fridges = fridges.data || [];
    state.materials = materials.data || [];
    state.lots = (lots.data || []).map((lot) => ({ ...lot, quantity: Number(lot.quantity || 0) }));
    ensureCategory();
    renderAll();
    status(`更新済み ${time(new Date())}`);
  }

  async function commonWorkersResult() {
    try {
      return { data: await state.commonAuth.users(APP_ID), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async function inbound(event) {
    event.preventDefault();
    if (!canUse('operator')) return toast('入出庫は作業者以上の権限が必要です。', 'error');
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
    if (!canUse('operator')) return toast('入出庫は作業者以上の権限が必要です。', 'error');
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

  async function saveCategory(event) {
    event.preventDefault();
    if (!canUse('admin')) return toast('マスタ管理は管理者権限が必要です。', 'error');
    const id = el.categoryId.value;
    const values = {
      name: clean(el.categoryName.value),
      display_order: Number(el.categoryDisplayOrder.value || 999),
      is_active: el.categoryActive.checked
    };
    if (!values.name) return;
    if (excludedCategory(values.name)) return toast('にんにく、黒にんにく、米穀は別システムで管理します。', 'error');
    const query = id
      ? state.client.from('inventory_item_categories').update(values).eq('id', id)
      : state.client.from('inventory_item_categories').insert(values);
    const { error } = await query;
    if (error) return toast(message(error), 'error');
    resetCategoryForm();
    toast('カテゴリを保存しました。');
    await loadData({ silent: true });
  }

  async function saveFridge(event) {
    event.preventDefault();
    if (!canUse('admin')) return toast('マスタ管理は管理者権限が必要です。', 'error');
    const id = el.fridgeId.value;
    const values = { name: clean(el.fridgeName.value), note: clean(el.fridgeNote.value) || null, is_active: el.fridgeActive.checked };
    if (!values.name) return;
    const query = id
      ? state.client.from('frozen_ingredient_fridges').update(values).eq('id', id)
      : state.client.from('frozen_ingredient_fridges').insert(values);
    const { error } = await query;
    if (error) return toast(message(error), 'error');
    resetFridgeForm();
    toast('保管場所を保存しました。');
    await loadData({ silent: true });
  }

  async function saveMaterial(event) {
    event.preventDefault();
    if (!canUse('admin')) return toast('マスタ管理は管理者権限が必要です。', 'error');
    const id = el.materialId.value;
    const values = {
      category_id: el.materialCategory.value || materialFormCategoryId(),
      supplier_name: clean(el.supplierName.value),
      material_name: clean(el.materialName.value),
      unit_name: clean(el.materialUnit.value),
      is_active: el.materialActive.checked
    };
    if (!values.category_id || !values.supplier_name || !values.material_name || !values.unit_name) return toast('品目内容を確認してください。', 'error');
    const query = id
      ? state.client.from('frozen_ingredient_materials').update(values).eq('id', id)
      : state.client.from('frozen_ingredient_materials').insert(values);
    const { error } = await query;
    if (error) return toast(message(error), 'error');
    resetMaterialForm(values.category_id);
    toast('品目を保存しました。');
    await loadData({ silent: true });
  }

  function renderAll() {
    renderWorkers();
    renderCategories();
    renderTabs();
    renderSelects();
    renderInboundInventory();
    renderFridgeInventory();
    renderMaterialInventory();
    renderMasterMode();
    renderMasterLists();
    renderUnits();
    icons();
  }

  function renderTabs() {
    if (!panels[state.activeTab]) state.activeTab = 'inbound';
    document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.activeTab));
    Object.entries(panels).forEach(([tab, id]) => document.getElementById(id).classList.toggle('hidden', tab !== state.activeTab));
  }

  function setTab(tab) {
    state.activeTab = panels[tab] ? tab : 'inbound';
    setStore(TAB_KEY, state.activeTab);
    renderTabs();
    if (state.activeTab === 'outbound') renderOutboundLots();
    icons();
  }

  function renderSelects() {
    const activeFridges = sortName(state.fridges.filter((item) => item.is_active));
    const activeMaterials = sortMaterials(state.materials.filter((item) => item.is_active && inCurrentCategory(item)));
    fillSelect(el.inboundFridge, activeFridges, (item) => item.name, '保管場所が未登録です');
    fillSelect(el.inboundMaterial, activeMaterials, materialLabel, materialEmptyText());
    const fridgeIds = new Set(activeLots().map((lot) => lot.fridge_id));
    fillSelect(el.outboundFridge, sortName(state.fridges.filter((item) => fridgeIds.has(item.id))), (item) => item.name, '出庫できる在庫がありません');
    renderOutboundMaterials();
    renderUnits();
  }

  function renderOutboundMaterials() {
    const fridgeId = el.outboundFridge.value;
    const ids = new Set(activeLots().filter((lot) => lot.fridge_id === fridgeId).map((lot) => lot.material_id));
    fillSelect(el.outboundMaterial, sortMaterials(state.materials.filter((item) => ids.has(item.id))), materialLabel, 'この保管場所に在庫がありません');
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

  function renderInboundInventory() {
    el.inboundFridgeInventoryList.innerHTML = inboundFridgeInventoryHtml();
    el.inboundMaterialInventoryList.innerHTML = inboundMaterialInventoryHtml();
    renderInboundStockMode();
  }

  function renderInboundStockMode() {
    const materials = state.inboundStockMode === 'materials';
    el.inboundStockFridgeTab.classList.toggle('active', !materials);
    el.inboundStockMaterialTab.classList.toggle('active', materials);
    el.inboundFridgeInventoryPanel.classList.toggle('hidden', materials);
    el.inboundMaterialInventoryPanel.classList.toggle('hidden', !materials);
  }

  function renderMaterialInventory() {
    el.materialInventoryList.innerHTML = materialInventoryHtml('在庫がありません。');
  }

  function materialInventoryHtml(emptyLabel) {
    const groups = groupBy(activeLots().sort(compareLotsForMaterial), (lot) => lot.material_id);
    return sortMaterials(state.materials.filter(inCurrentCategory)).map((material) => {
      const lots = groups.get(material.id) || [];
      if (!lots.length) return '';
      const rows = lots.map((lot) => stockRow(lot, 'material')).join('');
      return `<article class="inventory-group">
        <div class="group-header"><div><h3>${esc(material.material_name)}</h3><div class="stock-sub">${esc(materialMeta(material))}</div></div><div class="quantity">${esc(qtyUnit(sum(lots), material))}</div></div>
        ${rows}
      </article>`;
    }).join('') || `<div class="empty-row">${esc(emptyLabel)}</div>`;
  }

  function inboundFridgeInventoryHtml() {
    const groups = groupBy(activeLots().sort(compareLotsForFridge), (lot) => lot.fridge_id);
    return sortName(state.fridges).map((fridge) => {
      const lots = groups.get(fridge.id) || [];
      if (!lots.length) return '';
      const materialGroups = groupBy(lots, (lot) => lot.material_id);
      const rows = Array.from(materialGroups.values())
        .map((rowLots) => ({ material: materialFor(rowLots[0]), lots: rowLots }))
        .filter((row) => row.material)
        .sort((a, b) => compareMaterials(a.material, b.material))
        .map((row) => summaryRow(materialName(row.material), materialMeta(row.material), qtyUnit(sum(row.lots), row.material), expiryChips(row.lots, row.material)))
        .join('');
      return summaryGroup(fridge.name, fridgeSummary(lots), ['品目', '数量', '期限/管理日'], rows);
    }).join('') || `<div class="empty-row">${esc(currentStockEmptyText())}</div>`;
  }

  function inboundMaterialInventoryHtml() {
    const groups = groupBy(activeLots().sort(compareLotsForMaterial), (lot) => lot.material_id);
    return sortMaterials(state.materials.filter(inCurrentCategory)).map((material) => {
      const lots = groups.get(material.id) || [];
      if (!lots.length) return '';
      const fridgeGroups = groupBy(lots, (lot) => lot.fridge_id);
      const rows = Array.from(fridgeGroups.values())
        .map((rowLots) => ({ fridge: fridgeFor(rowLots[0]), lots: rowLots }))
        .sort((a, b) => String(fridgeName(a.fridge)).localeCompare(String(fridgeName(b.fridge)), 'ja'))
        .map((row) => summaryRow(fridgeName(row.fridge), '', qtyUnit(sum(row.lots), material), expiryChips(row.lots, material)))
        .join('');
      return summaryGroup(material.material_name, qtyUnit(sum(lots), material), ['保管場所', '数量', '期限/管理日'], rows, materialMeta(material));
    }).join('') || `<div class="empty-row">${esc(currentStockEmptyText())}</div>`;
  }

  function summaryGroup(title, quantity, headers, rows, sub) {
    return `<article class="inventory-group summary-group">
      <div class="group-header"><div><h3>${esc(title)}</h3>${sub ? `<div class="stock-sub">${esc(sub)}</div>` : ''}</div><div class="quantity">${esc(quantity)}</div></div>
      <div class="summary-table-wrap">
        <table class="summary-table">
          <thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </article>`;
  }

  function summaryRow(title, sub, quantity, detail) {
    return `<tr>
      <td><div class="stock-title">${esc(title)}</div>${sub ? `<div class="stock-sub">${esc(sub)}</div>` : ''}</td>
      <td class="quantity">${esc(quantity)}</td>
      <td><div class="stock-meta summary-meta">${detail}</div></td>
    </tr>`;
  }

  function expiryChips(lots, material) {
    const groups = groupBy([...lots].sort(compareLotsForFridge), (lot) => lot.expiration_date);
    return Array.from(groups.entries()).map(([expirationDate, rowLots]) => {
      const exp = expiry(expirationDate);
      return `<span class="date-pill ${exp.className}" title="${esc(exp.label)}">${esc(date(expirationDate))} ${esc(qtyUnit(sum(rowLots), material))}</span>`;
    }).join('');
  }

  function stockRow(lot, mode) {
    const exp = expiry(lot.expiration_date);
    const material = materialFor(lot);
    const title = mode === 'fridge' ? materialName(material) : fridgeName(fridgeFor(lot));
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

  function renderCategories() {
    const categories = activeCategories();
    const previous = state.activeCategoryId || el.categorySelect.value;
    el.categorySelect.innerHTML = '';
    if (!categories.length) {
      const option = new Option('カテゴリ未登録', '');
      option.disabled = true;
      option.selected = true;
      el.categorySelect.append(option);
      el.categorySelect.disabled = true;
      fillMaterialCategory([]);
      return;
    }
    if (previous === ALL_CATEGORIES) {
      state.activeCategoryId = ALL_CATEGORIES;
    } else if (!categories.some((category) => category.id === previous)) {
      state.activeCategoryId = preferredCategoryId(categories);
      setStore(CATEGORY_KEY, state.activeCategoryId);
    }
    el.categorySelect.disabled = false;
    el.categorySelect.append(new Option('全て', ALL_CATEGORIES));
    categories.forEach((category) => el.categorySelect.append(new Option(category.name, category.id)));
    el.categorySelect.value = state.activeCategoryId;
    fillMaterialCategory(categories);
  }

  function fillMaterialCategory(categories) {
    const fallback = materialFormCategoryId(categories);
    const previous = el.materialCategory.value || fallback;
    el.materialCategory.innerHTML = '';
    if (!categories.length) {
      const option = new Option('カテゴリ未登録', '');
      option.disabled = true;
      option.selected = true;
      el.materialCategory.append(option);
      el.materialCategory.disabled = true;
      return;
    }
    el.materialCategory.disabled = false;
    categories.forEach((category) => el.materialCategory.append(new Option(category.name, category.id)));
    el.materialCategory.value = categories.some((category) => category.id === previous) ? previous : fallback;
  }

  function renderMasterMode() {
    document.querySelectorAll('[data-master-mode]').forEach((button) => button.classList.toggle('active', button.dataset.masterMode === state.masterMode));
    el.categoryMasterPanel.classList.toggle('hidden', state.masterMode !== 'categories');
    el.fridgeMasterPanel.classList.toggle('hidden', state.masterMode !== 'fridges');
    el.materialMasterPanel.classList.toggle('hidden', state.masterMode !== 'materials');
  }

  function renderMasterLists() {
    el.categoryMasterList.innerHTML = sortCategories(state.categories).map((category) => masterItem(category.name, `表示順 ${category.display_order || 999}`, category.is_active, 'category', category.id)).join('') || '<div class="empty-row">カテゴリが未登録です。</div>';
    el.fridgeMasterList.innerHTML = sortName(state.fridges).map((fridge) => masterItem(fridge.name, fridge.note, fridge.is_active, 'fridge', fridge.id)).join('') || '<div class="empty-row">保管場所が未登録です。</div>';
    el.materialMasterList.innerHTML = materialMasterListHtml();
  }

  function masterItem(title, sub, active, kind, id) {
    return `<div class="master-item">
      <div class="master-main"><div><div class="master-title">${esc(title)}</div><div class="master-sub">${esc(sub || '')}</div></div></div>
      <div class="master-actions"><span class="state-pill ${active ? 'active' : 'paused'}">${active ? '使用中' : '停止中'}</span><button class="icon-button" type="button" data-edit-${kind}="${esc(id)}" aria-label="編集" title="編集"><i data-lucide="pencil"></i></button></div>
    </div>`;
  }

  function materialMasterListHtml() {
    const categories = activeCategories();
    const categoryId = materialMasterCategoryId(categories);
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return '<div class="empty-row">カテゴリが未登録です。</div>';
    const materials = sortMaterials(state.materials.filter((material) => material.category_id === categoryId));
    if (!materials.length) return '<div class="empty-row">このカテゴリの品目が未登録です。</div>';
    const rows = materials.map(materialMasterRow).join('');
    return summaryGroup(category.name, `${materials.length}品目`, ['品目', '単位', '状態/編集'], rows);
  }

  function materialMasterRow(material) {
    return `<tr>
      <td><div class="stock-title">${esc(material.material_name)}</div><div class="stock-sub">${esc(material.supplier_name || '')}</div></td>
      <td class="quantity">${esc(unitName(material) || '-')}</td>
      <td class="master-action-cell"><div class="master-table-actions"><span class="state-pill ${material.is_active ? 'active' : 'paused'}">${material.is_active ? '使用中' : '停止中'}</span><button class="icon-button" type="button" data-edit-material="${esc(material.id)}" aria-label="編集" title="編集"><i data-lucide="pencil"></i></button></div></td>
    </tr>`;
  }

  function renderWorkers() {
    const workers = activeWorkers();
    if (state.commonMode) {
      fillWorker(el.loginWorkerSelect, workers, '資材在庫の利用権限がある作業者が未登録です');
      if (state.commonSession) {
        const current = workers.find((worker) => worker.workerId === state.workerId) || mapCommonWorker(state.commonSession, 0);
        fillWorker(el.workerSelect, [current], '作業者なし');
        el.workerSelect.value = state.workerId;
        el.workerSelect.disabled = true;
      }
      return;
    }
    fillWorker(el.loginWorkerSelect, workers, '作業者が未登録です');
    fillWorker(el.workerSelect, workers, '作業者なし');
    el.workerSelect.disabled = false;
    if (state.workerId && workers.some((worker) => worker.workerId === state.workerId)) {
      el.loginWorkerSelect.value = state.workerId;
      el.workerSelect.value = state.workerId;
    }
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

  function fillWorker(select, rows, emptyLabel) {
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
    rows.forEach((worker) => select.append(new Option(worker.workerName, worker.workerId)));
    if (rows.some((worker) => worker.workerId === previous)) select.value = previous;
  }

  function editCategory(event) {
    const button = event.target.closest('[data-edit-category]');
    if (!button) return;
    const category = state.categories.find((item) => item.id === button.dataset.editCategory);
    if (!category) return;
    el.categoryId.value = category.id;
    el.categoryName.value = category.name || '';
    el.categoryDisplayOrder.value = category.display_order || 999;
    el.categoryActive.checked = Boolean(category.is_active);
    el.categoryName.focus();
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
    el.materialCategory.value = material.category_id || materialFormCategoryId();
    el.supplierName.value = material.supplier_name || '';
    el.materialName.value = material.material_name || '';
    el.materialUnit.value = material.unit_name || 'kg';
    el.materialActive.checked = Boolean(material.is_active);
    el.supplierName.focus();
  }

  function resetCategoryForm() {
    el.categoryId.value = '';
    el.categoryName.value = '';
    el.categoryDisplayOrder.value = '999';
    el.categoryActive.checked = true;
  }

  function resetFridgeForm() {
    el.fridgeId.value = '';
    el.fridgeName.value = '';
    el.fridgeNote.value = '';
    el.fridgeActive.checked = true;
  }

  function resetMaterialForm(categoryId) {
    el.materialId.value = '';
    el.materialCategory.value = categoryId || materialMasterCategoryId();
    el.supplierName.value = '';
    el.materialName.value = '';
    el.materialUnit.value = 'kg';
    el.materialActive.checked = true;
  }

  function showSetup() {
    el.setupScreen.classList.remove('hidden');
    el.authScreen.classList.add('hidden');
    el.appShell.classList.add('hidden');
    icons();
  }

  function showAuth(text) {
    el.setupScreen.classList.add('hidden');
    el.authScreen.classList.remove('hidden');
    el.appShell.classList.add('hidden');
    el.loginMessage.textContent = text || '';
    renderWorkers();
    icons();
  }

  function showApp() {
    el.setupScreen.classList.add('hidden');
    el.authScreen.classList.add('hidden');
    el.appShell.classList.remove('hidden');
    renderTabs();
  }

  function readConfig() {
    if (window.BusinessConfig && window.BusinessConfig.url && window.BusinessConfig.key) {
      return {
        supabaseUrl: window.BusinessConfig.url,
        supabaseAnonKey: window.BusinessConfig.key
      };
    }
    const stored = getJson(CONFIG_KEY);
    if (configured(stored)) return stored;
    return {
      supabaseUrl: window.APP_CONFIG && window.APP_CONFIG.supabaseUrl ? window.APP_CONFIG.supabaseUrl : '',
      supabaseAnonKey: window.APP_CONFIG && window.APP_CONFIG.supabaseAnonKey ? window.APP_CONFIG.supabaseAnonKey : ''
    };
  }

  function fillSetup(config) {
    el.setupUrl.value = config.supabaseUrl || '';
    el.setupAnonKey.value = config.supabaseAnonKey || '';
  }

  function configured(config) {
    return Boolean(config && config.supabaseUrl && config.supabaseAnonKey && !String(config.supabaseUrl).includes('YOUR-') && !String(config.supabaseAnonKey).includes('YOUR-'));
  }

  function mapWorker(row) {
    return {
      workerId: row.worker_id || '',
      workerName: row.worker_name || row.worker_id || '',
      role: row.role || 'operator',
      displayOrder: Number(row.display_order || 999),
      active: row.active !== false,
      note: row.note || ''
    };
  }

  function mapCommonWorker(row, index) {
    return {
      workerId: row.workerId || row.worker_id || '',
      workerName: row.workerName || row.worker_name || row.workerId || row.worker_id || '',
      role: row.role || 'operator',
      displayOrder: Number(row.displayOrder || row.display_order || index || 999),
      active: row.active !== false,
      note: ''
    };
  }

  function workerPin(worker) {
    const match = clean(worker && worker.note).match(/(?:PIN|pin|ＰＩＮ|暗証番号)\s*[:：=]\s*([0-9A-Za-z_-]+)/);
    return match ? match[1] : '';
  }

  function activeWorkers() { return state.workers.filter((worker) => worker.active); }
  function canUse(level) {
    return !state.commonMode || state.commonAuth.allows(state.commonSession, APP_ID, level);
  }
  function ensureCategory() {
    const categories = activeCategories();
    if (!categories.length) {
      state.activeCategoryId = '';
      removeStore(CATEGORY_KEY);
      return;
    }
    if (state.activeCategoryId === ALL_CATEGORIES) return;
    if (!categories.some((category) => category.id === state.activeCategoryId)) {
      state.activeCategoryId = preferredCategoryId(categories);
      setStore(CATEGORY_KEY, state.activeCategoryId);
    }
  }
  function activeCategories() {
    return sortCategories(state.categories.filter((category) => category.is_active && !excludedCategory(category.name)));
  }
  function preferredCategoryId(categories) {
    const frozen = categories.find((category) => category.name === '冷食');
    return (frozen || categories[0]).id;
  }
  function materialFormCategoryId(categories = activeCategories()) {
    if (state.activeCategoryId && state.activeCategoryId !== ALL_CATEGORIES && categories.some((category) => category.id === state.activeCategoryId)) {
      return state.activeCategoryId;
    }
    return categories.length ? preferredCategoryId(categories) : '';
  }
  function materialMasterCategoryId(categories = activeCategories()) {
    const current = el.materialCategory && el.materialCategory.value;
    if (current && categories.some((category) => category.id === current)) return current;
    return materialFormCategoryId(categories);
  }
  function excludedCategory(name) {
    return ['にんにく', '黒にんにく', '米穀', '玄米', '白米'].includes(clean(name));
  }
  function activeLots() {
    return state.lots.filter((lot) => Number(lot.quantity) > 0 && inCurrentCategory(materialFor(lot)));
  }
  function inCurrentCategory(material) {
    if (!material) return false;
    if (state.activeCategoryId === ALL_CATEGORIES) {
      return activeCategories().some((category) => category.id === material.category_id);
    }
    return Boolean(state.activeCategoryId && material.category_id === state.activeCategoryId);
  }
  function renderUnits() {
    const inboundMaterial = state.materials.find((item) => item.id === el.inboundMaterial.value);
    const outboundMaterial = state.materials.find((item) => item.id === el.outboundMaterial.value);
    el.inboundUnit.textContent = unitName(inboundMaterial) || '単位';
    el.outboundUnit.textContent = unitName(outboundMaterial) || '単位';
  }
  function materialFor(lot) {
    return state.materials.find((item) => item.id === lot.material_id) || lot.material || null;
  }
  function fridgeFor(lot) {
    return state.fridges.find((item) => item.id === lot.fridge_id) || lot.fridge || null;
  }
  function fridgeName(fridge) { return fridge ? fridge.name : '保管場所不明'; }
  function categoryName(categoryId) {
    const category = state.categories.find((item) => item.id === categoryId);
    return category ? category.name : '';
  }
  function materialCategoryPrefix(material) {
    if (state.activeCategoryId !== ALL_CATEGORIES) return '';
    const name = categoryName(material && material.category_id);
    return name ? `${name} / ` : '';
  }
  function materialLabel(material) {
    const unit = unitName(material);
    return `${materialCategoryPrefix(material)}${material.supplier_name} / ${material.material_name}${unit ? `（${unit}）` : ''}`;
  }
  function materialName(material) { return material ? material.material_name : '品目不明'; }
  function materialMeta(material) {
    if (!material) return '';
    const unit = unitName(material);
    return `${materialCategoryPrefix(material)}${unit ? `${material.supplier_name} / ${unit}` : material.supplier_name}`;
  }
  function materialEmptyText(suffix = '') {
    return state.activeCategoryId === ALL_CATEGORIES ? `品目が未登録です${suffix}` : `このカテゴリの品目が未登録です${suffix}`;
  }
  function currentStockEmptyText() {
    return state.activeCategoryId === ALL_CATEGORIES ? '現在庫がありません。' : 'このカテゴリの現在庫がありません。';
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
  function sortCategories(items) {
    return [...items].sort((a, b) => Number(a.display_order || 999) - Number(b.display_order || 999) || String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
  }
  function sortName(items) { return [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja')); }
  function sortMaterials(items) {
    return [...items].sort(compareMaterials);
  }
  function compareMaterials(a, b) {
    return String(a && a.supplier_name || '').localeCompare(String(b && b.supplier_name || ''), 'ja') || String(a && a.material_name || '').localeCompare(String(b && b.material_name || ''), 'ja');
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
    if (text.includes('active fridge not found')) return '使用中の保管場所を選択してください。';
    if (text.includes('active material not found')) return '使用中の品目を選択してください。';
    if (text.includes('duplicate key')) return '同じ内容がすでに登録されています。';
    if (text.includes('inventory_item_categories') || text.includes('category_id')) return 'カテゴリ追加SQLが未実行です。supabase-add-inventory-categories.sqlをSupabase SQL Editorで実行してください。';
    if (text.includes('frozen_ingredient_record_inbound')) return '入出庫RPCのSQLセットアップを確認してください。';
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
  function getJson(key) {
    try {
      const value = getStore(key);
      return value ? JSON.parse(value) : null;
    } catch (_error) {
      return null;
    }
  }
  function setJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_error) {}
  }
})();
