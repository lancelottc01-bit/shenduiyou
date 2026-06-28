const state = {
  products: [],
  filtered: [],
  category: '全部',
  keyword: '',
  cart: JSON.parse(localStorage.getItem('sdy_cart') || '{}'),
  store: JSON.parse(localStorage.getItem('sdy_store') || 'null'),
  renderIndex: 0,
  pageSize: 20,
  isRendering: false,
  observer: null,
  productMap: new Map()
};

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Math.round(Number(n || 0)).toLocaleString('zh-TW')}`;
const placeholder = 'https://placehold.co/600x600/F3F6FA/0F2742?text=%E7%A5%9E%E9%9A%8A%E5%8F%8B';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 1800);
}

function safeImage(url) {
  return String(url || '').trim() || placeholder;
}

function saveCart() {
  localStorage.setItem('sdy_cart', JSON.stringify(state.cart));
  renderCartBadge();
}

function saveStore(store) {
  state.store = store;
  localStorage.setItem('sdy_store', JSON.stringify(store));
}

function showLoadingUI() {
  if ($('productTotal')) $('productTotal').textContent = '商品載入中...';
  if ($('productGrid')) {
    $('productGrid').innerHTML = `
      <div class="loading-box">
        <div class="loading-title">📦 耗材整理中</div>
        <div class="loading-desc">正在整理餐飲耗材與箱購價格<br>首次開啟約需數秒</div>
        <div class="loading-tip">請稍候一下，神隊友馬上到位 🚚</div>
      </div>
    `;
  }
  if ($('quickList')) {
    $('quickList').innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  }
  if ($('categoryList')) {
    $('categoryList').innerHTML = '<button class="category-chip active">載入中...</button>';
  }
}

async function loadProducts() {
  showLoadingUI();
  try {
    const data = await API.getProducts();
    const rows = Array.isArray(data) ? data : (data.products || data.data || []);
    state.products = rows.map(normalizeProduct).filter(p => p.id && p.name && p.isVisible);
    state.productMap = new Map(state.products.map(p => [p.id, p]));
    applyFilter();
    renderFeaturedList();
    renderCategories();
    renderCartBadge();
  } catch (err) {
    console.error(err);
    if ($('productGrid')) $('productGrid').innerHTML = `<div class="empty">商品讀取失敗：${escapeHtml(err.message || '請重新整理一次')}</div>`;
    if ($('quickList')) $('quickList').innerHTML = '<div class="empty">熱門商品讀取失敗</div>';
    if ($('categoryList')) $('categoryList').innerHTML = '<button class="category-chip active">讀取失敗</button>';
  }
}

function normalizeProduct(p) {
  return {
    id: String(p.id || p.ID || '').trim(),
    category: String(p.category || p.Category || '其他').trim() || '其他',
    brand: String(p.brand || p.Brand || '').trim(),
    supplier: String(p.supplier || p.Supplier || '').trim(),
    name: String(p.name || p.Name || '').trim(),
    spec: String(p.spec || p.Spec || '').trim(),
    packQty: String(p.packQty || p.PackQty || '').trim(),
    packPrice: Number(p.packPrice || p.PackPrice || 0),
    packRewardPercent: Number(p.packRewardPercent || p.PackRewardPercent || 0),
    caseQty: String(p.caseQty || p.CaseQty || '').trim(),
    casePrice: Number(p.casePrice || p.CasePrice || 0),
    caseRewardPercent: Number(p.caseRewardPercent || p.CaseRewardPercent || 0),
    image: String(p.image || p.Image || placeholder).trim() || placeholder,
    tags: String(p.tags || p.Tags || '').trim(),
    isFeatured: String(p.isFeatured || p.featured || p.IsFeatured || '').toUpperCase() === 'TRUE',
    isRecommended: String(p.isRecommended || p.recommended || p.IsRecommended || '').toUpperCase() === 'TRUE',
    isVisible: String(p.isVisible || p.visible || p.IsVisible || 'TRUE').toUpperCase() !== 'FALSE',
    sort: Number(p.sort || p.Sort || 9999)
  };
}

function applyFilter() {
  const kw = state.keyword.trim().toLowerCase();
  let results = state.products.filter(p => {
    const matchCategory = state.category === '全部' || p.category === state.category;
    const text = `${p.name} ${p.category} ${p.brand} ${p.supplier} ${p.spec} ${p.tags}`.toLowerCase();
    return matchCategory && (!kw || text.includes(kw));
  });
  results.sort((a, b) => a.sort - b.sort);
  state.filtered = results;
  resetProductRender();
}

function resetProductRender() {
  state.renderIndex = 0;
  state.isRendering = false;
  if (state.observer) state.observer.disconnect();
  if ($('productTotal')) $('productTotal').textContent = `${state.filtered.length} 件`;
  const grid = $('productGrid');
  if (!grid) return;
  if (!state.filtered.length) {
    grid.innerHTML = '<div class="empty">找不到商品，可以直接傳訊息給業務。</div>';
    return;
  }
  grid.innerHTML = '';
  setupInfiniteScroll();
  renderNextProducts();
}

function renderNextProducts() {
  if (state.isRendering || state.renderIndex >= state.filtered.length) return;
  state.isRendering = true;
  const grid = $('productGrid');
  const fragment = document.createDocumentFragment();
  const start = state.renderIndex;
  const end = Math.min(start + state.pageSize, state.filtered.length);
  state.filtered.slice(start, end).forEach(p => {
    const template = document.createElement('template');
    template.innerHTML = productCard(p).trim();
    fragment.appendChild(template.content.firstElementChild);
  });
  grid.appendChild(fragment);
  state.renderIndex = end;
  state.isRendering = false;
  addLoadMoreTrigger();
}

function addLoadMoreTrigger() {
  const grid = $('productGrid');
  const old = $('loadMoreTrigger');
  if (old) old.remove();
  if (!grid || state.renderIndex >= state.filtered.length) return;
  const trigger = document.createElement('div');
  trigger.id = 'loadMoreTrigger';
  trigger.className = 'load-more-trigger';
  trigger.textContent = '繼續往下滑看更多耗材';
  grid.appendChild(trigger);
  if (state.observer) state.observer.observe(trigger);
}

function setupInfiniteScroll() {
  if (state.observer) state.observer.disconnect();
  state.observer = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    const trigger = $('loadMoreTrigger');
    if (trigger) trigger.remove();
    requestAnimationFrame(renderNextProducts);
  }, { root: null, rootMargin: '700px', threshold: 0 });
}

function renderFeaturedList() {
  const featured = state.products.filter(p => p.isFeatured).slice(0, 10);
  $('quickList').innerHTML = featured.length ? featured.map(productCardSmall).join('') : '<div class="empty">近期熱門商品整理中</div>';
}

function renderCategories() {
  const categories = ['全部', ...new Set(state.products.map(p => p.category).filter(Boolean))];
  $('categoryList').innerHTML = categories.map(c => `
    <button class="category-chip ${c === state.category ? 'active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>
  `).join('');
}

function productLabels(p) {
  const labels = [];
  if (p.isFeatured) labels.push('<span>🔥 熱銷</span>');
  if (p.isRecommended) labels.push('<span>⭐ 推薦</span>');
  return labels.length ? `<div class="product-labels">${labels.join('')}</div>` : '';
}

function rewardText(percent, price) {
  const amount = Math.round(Number(price || 0) * Number(percent || 0) / 100);
  return `${Number(percent || 0)}%｜約 ${money(amount)}`;
}

function productCardSmall(p) {
  return `
    <article class="quick-card">
      <img src="${escapeHtml(safeImage(p.image))}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" onerror="this.src='${placeholder}'" />
      <h3>${escapeHtml(p.name)}</h3>
      <div class="quick-brand">${escapeHtml(p.brand || p.category)}</div>
      <button class="add-btn" data-add-id="${escapeHtml(p.id)}" data-add-type="case">＋箱購</button>
    </article>
  `;
}

function productCard(p) {
  return `
    <article class="product-card">
      <div class="brand-row"><strong>${escapeHtml(p.brand || '神隊友')}</strong><span>${escapeHtml(p.category)}</span></div>
      <img src="${escapeHtml(safeImage(p.image))}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" onerror="this.src='${placeholder}'" />
      ${productLabels(p)}
      <div class="product-meta">
        <h3>${escapeHtml(p.name)}</h3>
        <div class="muted">廠商｜${escapeHtml(p.supplier || '未標示')}</div>
        <div class="muted">規格｜${escapeHtml(p.spec || '-')}</div>
      </div>
      <div class="buy-options">
        <div class="buy-box pack-box">
          <div class="buy-title">單包</div>
          <div class="buy-unit">${escapeHtml(p.packQty || '-')}</div>
          <div class="buy-price">${money(p.packPrice)}</div>
          <div class="reward-mini">回饋 ${rewardText(p.packRewardPercent, p.packPrice)}</div>
          <button class="option-btn" data-add-id="${escapeHtml(p.id)}" data-add-type="pack">＋單包</button>
        </div>
        <div class="buy-box case-box">
          <div class="case-ribbon">箱購優惠</div>
          <div class="buy-title">箱購</div>
          <div class="buy-unit">${escapeHtml(p.caseQty || '-')}</div>
          <div class="buy-price">${money(p.casePrice)}</div>
          <div class="reward-strong">回饋 ${rewardText(p.caseRewardPercent, p.casePrice)}</div>
          <button class="option-btn case-btn" data-add-id="${escapeHtml(p.id)}" data-add-type="case">＋箱購</button>
        </div>
      </div>
    </article>
  `;
}

function makeCartKey(productId, type) {
  return `${productId}__${type}`;
}

function parseCartKey(key) {
  const [id, type] = String(key).split('__');
  return { id, type };
}

function addToCart(productId, type) {
  const product = state.productMap.get(productId);
  if (!product) return toast('找不到商品');
  const key = makeCartKey(productId, type);
  state.cart[key] = (state.cart[key] || 0) + 1;
  saveCart();
  toast(`已加入${type === 'case' ? '箱購' : '單包'}到補貨車`);
}

function changeQty(key, delta) {
  const next = (state.cart[key] || 0) + delta;
  if (next <= 0) delete state.cart[key];
  else state.cart[key] = next;
  saveCart();
  renderCart();
  renderConfirm();
}

function getCartItems() {
  return Object.entries(state.cart).map(([key, qty]) => {
    const { id, type } = parseCartKey(key);
    const p = state.productMap.get(id);
    if (!p) return null;
    const isCase = type === 'case';
    const price = isCase ? p.casePrice : p.packPrice;
    const rewardPercent = isCase ? p.caseRewardPercent : p.packRewardPercent;
    const unitText = isCase ? p.caseQty : p.packQty;
    const subtotal = Math.round(price * qty);
    const rewardAmount = Math.round(subtotal * rewardPercent / 100);
    return {
      key, id, type, typeName: isCase ? '箱購' : '單包',
      name: p.name, brand: p.brand, supplier: p.supplier, image: p.image,
      qty, unitText, price, rewardPercent, subtotal, rewardAmount
    };
  }).filter(Boolean);
}

function getCartTotals() {
  const items = getCartItems();
  return {
    items,
    count: items.reduce((sum, item) => sum + item.qty, 0),
    subtotal: items.reduce((sum, item) => sum + item.subtotal, 0),
    reward: items.reduce((sum, item) => sum + item.rewardAmount, 0)
  };
}

function renderCartBadge() {
  const totals = getCartTotals();
  if ($('cartCount')) $('cartCount').textContent = totals.count;
  if ($('bottomCartTotal')) $('bottomCartTotal').textContent = money(totals.subtotal);
  if ($('cartSummaryText')) $('cartSummaryText').textContent = totals.count ? `已選 ${totals.count} 件｜回饋約 ${money(totals.reward)}` : '尚未加入商品';
}

function renderCart() {
  const { items, subtotal, reward } = getCartTotals();
  $('cartItems').innerHTML = items.length ? items.map(cartItemHtml).join('') : '<div class="empty">補貨車目前是空的</div>';
  $('cartTotal').textContent = money(subtotal);
  $('cartRewardTotal').textContent = money(reward);
}

function cartItemHtml(item) {
  return `
    <div class="cart-item">
      <img src="${escapeHtml(safeImage(item.image))}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" onerror="this.src='${placeholder}'" />
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="muted">${escapeHtml(item.typeName)}｜${escapeHtml(item.unitText)}</div>
        <div class="muted">${money(item.price)} / 小計 ${money(item.subtotal)} / 回饋 ${money(item.rewardAmount)}</div>
        <div class="qty-row">
          <button class="qty-btn" data-qty-key="${escapeHtml(item.key)}" data-delta="-1">−</button>
          <strong>${item.qty}</strong>
          <button class="qty-btn" data-qty-key="${escapeHtml(item.key)}" data-delta="1">＋</button>
        </div>
      </div>
    </div>
  `;
}

async function handleLogin(event) {
  event.preventDefault();
  const account = $('storeAccount').value.trim();
  const password = $('storePassword').value.trim();
  if (!account || !password) return toast('請輸入帳號密碼');
  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = '登入中...';
  try {
    const result = await API.storeLogin(account, password);
    if (!result.ok) throw new Error(result.message || '登入失敗');
    saveStore(result.store);
    $('loginPage').classList.add('hidden');
    renderConfirm();
    $('confirmPage').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    toast(err.message || '登入失敗');
  } finally {
    btn.disabled = false;
    btn.textContent = '登入查看採購確認';
  }
}

function renderConfirm() {
  const store = state.store;
  const { items, subtotal, reward } = getCartTotals();
  if (!store) return;
  const boss = store.bossName || store.storeName || '老闆';
  $('bossGreeting').textContent = `${boss}您好`;
  $('monthlyRewardText').textContent = money(store.monthlyReward || 0);
  $('storeInfoText').textContent = `${store.storeName || ''}｜${store.level || '一般店'}｜業務 ${store.salesName || '-'}`;
  $('confirmItems').innerHTML = items.length ? items.map(item => `
    <div class="summary-line">
      <span>${escapeHtml(item.name)}｜${escapeHtml(item.typeName)} × ${item.qty}</span>
      <span>${money(item.subtotal)}｜回饋 ${money(item.rewardAmount)}</span>
    </div>
  `).join('') : '<div class="empty">採購車目前是空的</div>';
  $('confirmSubtotal').textContent = money(subtotal);
  $('confirmReward').textContent = money(reward);
  $('confirmMonthlyAfter').textContent = money(Number(store.monthlyReward || 0) + reward);
}

async function submitOrder() {
  const store = state.store;
  const { items, subtotal } = getCartTotals();
  if (!store) return toast('請先登入店家帳號');
  if (!items.length) return toast('補貨車是空的');
  const btn = $('submitOrderBtn');
  btn.disabled = true;
  btn.textContent = '送出中...';
  try {
    const payload = {
      storeId: store.storeId,
      account: store.account,
      note: $('orderNote') ? $('orderNote').value.trim() : '',
      items: items.map(item => ({
        id: item.id,
        type: item.type,
        typeName: item.typeName,
        name: item.name,
        brand: item.brand,
        supplier: item.supplier,
        qty: item.qty,
        unitText: item.unitText,
        price: item.price,
        rewardPercent: item.rewardPercent
      }))
    };
    const result = await API.createOrder(payload);
    if (!result.ok) throw new Error(result.message || '採購單送出失敗');
    state.cart = {};
    saveCart();
    if (result.store) saveStore(result.store);
    $('confirmPage').innerHTML = `
      <div class="success-page">
        <div class="success-icon">✅</div>
        <h2>採購單已送出</h2>
        <p>神隊友已收到您的補貨需求。</p>
        <div class="success-card">
          <div>採購單號</div><strong>${escapeHtml(result.orderId)}</strong>
          <div>採購金額</div><strong>${money(result.subtotal || subtotal)}</strong>
          <div>本次回饋</div><strong>${money(result.rewardAmount || 0)}</strong>
          <div>本月累積回饋</div><strong>${money(result.monthlyRewardAfter || 0)}</strong>
        </div>
        <button class="primary-btn" onclick="location.reload()">回到補貨首頁</button>
      </div>
    `;
  } catch (err) {
    console.error(err);
    toast(err.message || '送出失敗');
  } finally {
    btn.disabled = false;
    btn.textContent = '送出採購單';
  }
}

let searchTimer = null;
function bindEvents() {
  $('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.keyword = e.target.value;
      applyFilter();
    }, 250);
  });

  $('reloadBtn').addEventListener('click', () => {
    state.category = '全部';
    state.keyword = '';
    $('searchInput').value = '';
    applyFilter();
    renderCategories();
  });

  $('cartBtn').addEventListener('click', () => {
    renderCart();
    $('cartDrawer').classList.remove('hidden');
  });

  $('checkoutBtn').addEventListener('click', () => {
    if (!getCartItems().length) return toast('請先加入商品');
    $('cartDrawer').classList.add('hidden');
    if (state.store) {
      renderConfirm();
      $('confirmPage').classList.remove('hidden');
    } else {
      $('loginPage').classList.remove('hidden');
    }
  });

  $('backFromLoginBtn').addEventListener('click', () => $('loginPage').classList.add('hidden'));
  $('backFromConfirmBtn').addEventListener('click', () => $('confirmPage').classList.add('hidden'));
  $('loginForm').addEventListener('submit', handleLogin);
  $('submitOrderBtn').addEventListener('click', submitOrder);

  document.body.addEventListener('click', e => {
    const addId = e.target.dataset.addId;
    const addType = e.target.dataset.addType;
    if (addId && addType) addToCart(addId, addType);

    const category = e.target.dataset.category;
    if (category) {
      state.category = category;
      renderCategories();
      applyFilter();
    }

    if (e.target.dataset.close === 'cart') $('cartDrawer').classList.add('hidden');

    const qtyKey = e.target.dataset.qtyKey;
    if (qtyKey) changeQty(qtyKey, Number(e.target.dataset.delta));
  });
}

(function boot() {
  bindEvents();
  renderCartBadge();
  loadProducts();
})();
