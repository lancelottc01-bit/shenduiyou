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
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function toast(message) {
  const el = $('toast');
  if (!el) return;

  el.textContent = message;
  el.classList.remove('hidden');

  setTimeout(() => {
    el.classList.add('hidden');
  }, 1800);
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
  renderCartBadge();
}

function logoutStore() {
  state.store = null;
  localStorage.removeItem('sdy_store');

  if ($('confirmPage')) $('confirmPage').classList.add('hidden');
  if ($('loginPage')) $('loginPage').classList.remove('hidden');

  renderCartBadge();
  toast('已切換店家，請重新登入');
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
    $('quickList').innerHTML = `
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    `;
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

    state.products = rows
      .map(normalizeProduct)
      .filter(p => p.id && p.name && p.isVisible);

    state.productMap = new Map(state.products.map(p => [p.id, p]));

    applyFilter();
    renderFeaturedList();
    renderCategories();
    renderCartBadge();
  } catch (err) {
    console.error(err);

    if ($('productGrid')) {
      $('productGrid').innerHTML = `
        <div class="empty">商品讀取失敗：${escapeHtml(err.message || '請重新整理一次')}</div>
      `;
    }

    if ($('quickList')) {
      $('quickList').innerHTML = '<div class="empty">熱門商品讀取失敗</div>';
    }

    if ($('categoryList')) {
      $('categoryList').innerHTML = '<button class="category-chip active">讀取失敗</button>';
    }
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
    const searchText = `${p.name} ${p.category} ${p.brand} ${p.supplier} ${p.spec} ${p.tags}`.toLowerCase();

    return matchCategory && (!kw || searchText.includes(kw));
  });

  results.sort((a, b) => a.sort - b.sort);

  state.filtered = results;
  resetProductRender();
}

function resetProductRender() {
  state.renderIndex = 0;
  state.isRendering = false;

  if (state.observer) {
    state.observer.disconnect();
  }

  if ($('productTotal')) {
    $('productTotal').textContent = `${state.filtered.length} 件`;
  }

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

  state.filtered.slice(start, end).forEach(product => {
    const template = document.createElement('template');
    template.innerHTML = productCard(product).trim();
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

  if (state.observer) {
    state.observer.observe(trigger);
  }
}

function setupInfiniteScroll() {
  if (state.observer) {
    state.observer.disconnect();
  }

  state.observer = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;

    const trigger = $('loadMoreTrigger');
    if (trigger) trigger.remove();

    requestAnimationFrame(renderNextProducts);
  }, {
    root: null,
    rootMargin: '700px',
    threshold: 0
  });
}

function renderFeaturedList() {
  const featured = state.products
    .filter(p => p.isFeatured)
    .slice(0, 10);

  $('quickList').innerHTML = featured.length
    ? featured.map(productCardSmall).join('')
    : '<div class="empty">近期熱門商品整理中</div>';
}

function renderCategories() {
  const categories = [
    '全部',
    ...new Set(state.products.map(p => p.category).filter(Boolean))
  ];

  $('categoryList').innerHTML = categories.map(category => `
    <button
      class="category-chip ${category === state.category ? 'active' : ''}"
      data-category="${escapeHtml(category)}"
      type="button"
    >
      ${escapeHtml(category)}
    </button>
  `).join('');
}

function productLabels(product) {
  const labels = [];

  if (product.isFeatured) labels.push('<span>🔥 熱銷</span>');
  if (product.isRecommended) labels.push('<span>⭐ 推薦</span>');

  return labels.length
    ? `<div class="product-labels">${labels.join('')}</div>`
    : '';
}

function rewardAmount(price, percent) {
  return Math.round(Number(price || 0) * Number(percent || 0) / 100);
}

function rewardText(percent, price) {
  const amount = rewardAmount(price, percent);
  return `${Number(percent || 0)}%｜約 ${money(amount)}`;
}

function averageCasePrice(product) {
  const caseText = String(product.caseQty || '');
  const match = caseText.match(/(\d+)/);

  if (!match) return '';

  const qty = Number(match[1]);

  if (!qty || !product.casePrice) return '';

  return money(product.casePrice / qty);
}

function caseSavingText(product) {
  const caseText = String(product.caseQty || '');
  const match = caseText.match(/(\d+)/);

  if (!match) return '';

  const casePackCount = Number(match[1]);

  if (!casePackCount || !product.packPrice || !product.casePrice) return '';

  const original = product.packPrice * casePackCount;
  const saving = original - product.casePrice;

  if (saving <= 0) return '';

  return `箱購約省 ${money(saving)}`;
}

function productCardSmall(product) {
  return `
    <article class="quick-card">
      <img
        src="${escapeHtml(safeImage(product.image))}"
        alt="${escapeHtml(product.name)}"
        loading="lazy"
        decoding="async"
        onerror="this.src='${placeholder}'"
      />

      <h3>${escapeHtml(product.name)}</h3>

      <div class="quick-brand">
        ${escapeHtml(product.brand || product.category)}
      </div>

      <button
        class="add-btn"
        data-add-id="${escapeHtml(product.id)}"
        data-add-type="case"
        type="button"
      >
        ＋箱購
      </button>
    </article>
  `;
}

function productCard(product) {
  const avgPrice = averageCasePrice(product);
  const savingText = caseSavingText(product);

  return `
    <article class="product-card">
      <div class="brand-row">
        <strong>${escapeHtml(product.brand || '神隊友')}</strong>
        <span>${escapeHtml(product.category)}</span>
      </div>

      <img
        src="${escapeHtml(safeImage(product.image))}"
        alt="${escapeHtml(product.name)}"
        loading="lazy"
        decoding="async"
        onerror="this.src='${placeholder}'"
      />

      ${productLabels(product)}

      <div class="product-meta">
        <h3>${escapeHtml(product.name)}</h3>
        <div class="muted">廠商｜${escapeHtml(product.supplier || '未標示')}</div>
        <div class="muted">規格｜${escapeHtml(product.spec || '-')}</div>
      </div>

      <div class="buy-options">
        <div class="buy-box pack-box">
          <div class="buy-title">單包</div>
          <div class="buy-unit">${escapeHtml(product.packQty || '-')}</div>
          <div class="buy-price">${money(product.packPrice)}</div>
          <div class="reward-mini">🎁 回饋 ${rewardText(product.packRewardPercent, product.packPrice)}</div>

          <button
            class="option-btn"
            data-add-id="${escapeHtml(product.id)}"
            data-add-type="pack"
            type="button"
          >
            ＋單包
          </button>
        </div>

        <div class="buy-box case-box">
          <div class="case-ribbon">🏆 箱購優惠</div>
          <div class="buy-title">箱購</div>
          <div class="buy-unit">${escapeHtml(product.caseQty || '-')}</div>
          <div class="buy-price">${money(product.casePrice)}</div>

          ${avgPrice ? `<div class="case-average">平均每包 ${avgPrice}</div>` : ''}
          ${savingText ? `<div class="case-saving">${savingText}</div>` : ''}

          <div class="reward-strong">🏆 箱購回饋 ${rewardText(product.caseRewardPercent, product.casePrice)}</div>

          <button
            class="option-btn case-btn"
            data-add-id="${escapeHtml(product.id)}"
            data-add-type="case"
            type="button"
          >
            ＋箱購
          </button>
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

  if (!product) {
    return toast('找不到商品');
  }

  if (type === 'pack' && !product.packPrice) {
    return toast('此商品尚未設定單包價格');
  }

  if (type === 'case' && !product.casePrice) {
    return toast('此商品尚未設定箱購價格');
  }

  const key = makeCartKey(productId, type);

  state.cart[key] = (state.cart[key] || 0) + 1;

  saveCart();

  toast(`已加入${type === 'case' ? '箱購' : '單包'}到補貨車`);
}

function changeQty(key, delta) {
  const next = (state.cart[key] || 0) + delta;

  if (next <= 0) {
    delete state.cart[key];
  } else {
    state.cart[key] = next;
  }

  saveCart();
  renderCart();
  renderConfirm();
}

function getCartItems() {
  return Object.entries(state.cart)
    .map(([key, qty]) => {
      const { id, type } = parseCartKey(key);
      const product = state.productMap.get(id);

      if (!product) return null;

      const isCase = type === 'case';
      const price = isCase ? product.casePrice : product.packPrice;
      const rewardPercent = isCase ? product.caseRewardPercent : product.packRewardPercent;
      const unitText = isCase ? product.caseQty : product.packQty;
      const subtotal = Math.round(price * qty);
      const reward = Math.round(subtotal * rewardPercent / 100);

      return {
        key,
        id,
        type,
        typeName: isCase ? '箱購' : '單包',
        name: product.name,
        brand: product.brand,
        supplier: product.supplier,
        image: product.image,
        qty,
        unitText,
        price,
        rewardPercent,
        subtotal,
        rewardAmount: reward
      };
    })
    .filter(Boolean);
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

  if ($('cartCount')) {
    $('cartCount').textContent = totals.count;
  }

  if ($('bottomCartTotal')) {
    $('bottomCartTotal').textContent = money(totals.subtotal);
  }

  if ($('cartSummaryText')) {
    if (!totals.count) {
      $('cartSummaryText').textContent = '尚未加入商品';
      return;
    }

    const rewardInfo = `已選 ${totals.count} 件｜本次回饋約 ${money(totals.reward)}`;

    if (state.store) {
      $('cartSummaryText').textContent = `${rewardInfo}｜本月 ${money(state.store.monthlyReward || 0)}`;
    } else {
      $('cartSummaryText').textContent = `${rewardInfo}｜登入看累積`;
    }
  }
}

function renderCart() {
  const { items, subtotal, reward } = getCartTotals();

  if ($('cartItems')) {
    $('cartItems').innerHTML = items.length
      ? items.map(cartItemHtml).join('')
      : '<div class="empty">補貨車目前是空的</div>';
  }

  if ($('cartTotal')) {
    $('cartTotal').textContent = money(subtotal);
  }

  if ($('cartRewardTotal')) {
    $('cartRewardTotal').textContent = money(reward);
  }
}

function cartItemHtml(item) {
  return `
    <div class="cart-item">
      <img
        src="${escapeHtml(safeImage(item.image))}"
        alt="${escapeHtml(item.name)}"
        loading="lazy"
        decoding="async"
        onerror="this.src='${placeholder}'"
      />

      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="muted">${escapeHtml(item.typeName)}｜${escapeHtml(item.unitText)}</div>
        <div class="muted">
          ${money(item.price)} / 小計 ${money(item.subtotal)} / 回饋 ${money(item.rewardAmount)}
        </div>

        <div class="qty-row">
          <button
            class="qty-btn"
            data-qty-key="${escapeHtml(item.key)}"
            data-delta="-1"
            type="button"
          >
            −
          </button>

          <strong>${item.qty}</strong>

          <button
            class="qty-btn"
            data-qty-key="${escapeHtml(item.key)}"
            data-delta="1"
            type="button"
          >
            ＋
          </button>
        </div>
      </div>
    </div>
  `;
}

async function handleLogin(event) {
  event.preventDefault();

  const account = $('storeAccount').value.trim();
  const password = $('storePassword').value.trim();

  if (!account || !password) {
    return toast('請輸入帳號密碼');
  }

  const btn = $('loginBtn');

  btn.disabled = true;
  btn.textContent = '登入中...';

  try {
    const result = await API.storeLogin(account, password);

    if (!result.ok) {
      throw new Error(result.message || '登入失敗');
    }

    saveStore(result.store);

    $('loginPage').classList.add('hidden');

    renderConfirm();
    $('confirmPage').classList.remove('hidden');

    toast('登入成功');
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

  if (!store) return;

  const { items, subtotal, reward } = getCartTotals();
  const boss = store.bossName || store.storeName || '老闆';

  if ($('bossGreeting')) {
    $('bossGreeting').textContent = `${boss}您好`;
  }

  if ($('monthlyRewardText')) {
    $('monthlyRewardText').textContent = money(store.monthlyReward || 0);
  }

  if ($('storeInfoText')) {
    $('storeInfoText').textContent = `${store.storeName || ''}｜${store.level || '一般店'}｜業務 ${store.salesName || '-'}`;
  }

  if ($('confirmItems')) {
    $('confirmItems').innerHTML = items.length
      ? items.map(item => `
        <div class="summary-line">
          <span>${escapeHtml(item.name)}｜${escapeHtml(item.typeName)} × ${item.qty}</span>
          <span>${money(item.subtotal)}｜回饋 ${money(item.rewardAmount)}</span>
        </div>
      `).join('')
      : '<div class="empty">採購車目前是空的</div>';
  }

  if ($('confirmSubtotal')) {
    $('confirmSubtotal').textContent = money(subtotal);
  }

  if ($('confirmReward')) {
    $('confirmReward').textContent = money(reward);
  }

  if ($('confirmMonthlyAfter')) {
    $('confirmMonthlyAfter').textContent = money(Number(store.monthlyReward || 0) + reward);
  }
}

async function submitOrder() {
  const store = state.store;
  const { items, subtotal } = getCartTotals();

  if (!store) {
    return toast('請先登入店家帳號');
  }

  if (!items.length) {
    return toast('補貨車是空的');
  }

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

    if (!result.ok) {
      throw new Error(result.message || '採購單送出失敗');
    }

    state.cart = {};
    saveCart();

    if (result.store) {
      saveStore(result.store);
    }

    $('confirmPage').innerHTML = `
      <div class="success-page">
        <div class="success-icon">✅</div>
        <h2>神隊友已收到您的採購單</h2>
        <p>我們會依序為您整理補貨需求，並由業務或配送人員確認。</p>

        <div class="success-card">
          <div>採購單號</div>
          <strong>${escapeHtml(result.orderId)}</strong>

          <div>本次採購金額</div>
          <strong>${money(result.subtotal || subtotal)}</strong>

          <div>本次回饋</div>
          <strong>${money(result.rewardAmount || 0)}</strong>

          <div>本月累積回饋</div>
          <strong>${money(result.monthlyRewardAfter || 0)}</strong>
        </div>

        <button class="primary-btn" type="button" onclick="location.reload()">
          回到補貨首頁
        </button>
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
    if (!getCartItems().length) {
      return toast('請先加入商品');
    }

    $('cartDrawer').classList.add('hidden');

    if (state.store) {
      renderConfirm();
      $('confirmPage').classList.remove('hidden');
    } else {
      $('loginPage').classList.remove('hidden');
    }
  });

  $('backFromLoginBtn').addEventListener('click', () => {
    $('loginPage').classList.add('hidden');
  });

  $('backFromConfirmBtn').addEventListener('click', () => {
    $('confirmPage').classList.add('hidden');
  });

  $('loginForm').addEventListener('submit', handleLogin);

  $('submitOrderBtn').addEventListener('click', submitOrder);

  if ($('logoutStoreBtn')) {
    $('logoutStoreBtn').addEventListener('click', logoutStore);
  }

  document.body.addEventListener('click', event => {
    const addId = event.target.dataset.addId;
    const addType = event.target.dataset.addType;

    if (addId && addType) {
      addToCart(addId, addType);
    }

    const category = event.target.dataset.category;

    if (category) {
      state.category = category;
      renderCategories();
      applyFilter();
    }

    if (event.target.dataset.close === 'cart') {
      $('cartDrawer').classList.add('hidden');
    }

    const qtyKey = event.target.dataset.qtyKey;

    if (qtyKey) {
      changeQty(qtyKey, Number(event.target.dataset.delta));
    }
  });
}

(function boot() {
  bindEvents();
  renderCartBadge();
  loadProducts();
})();
