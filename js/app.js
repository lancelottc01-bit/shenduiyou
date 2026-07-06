const sb = window.sdySupabase;

const state = {
  products: [],
  filteredProducts: [],
  categories: [],
  activeCategory: "全部",
  searchText: "",
  cart: new Map(),
  vendorAccount: null,
  sessionUser: null,
  monthlyReward: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await restoreSession();
  await loadProducts();
  renderCart();
}

function bindEvents() {
  $("#searchInput")?.addEventListener("input", (event) => {
    state.searchText = event.target.value.trim().toLowerCase();
    applyProductFilters();
  });

  $("#reloadBtn")?.addEventListener("click", () => {
    state.activeCategory = "全部";
    state.searchText = "";

    if ($("#searchInput")) {
      $("#searchInput").value = "";
    }

    applyProductFilters();
  });

  $("#cartBtn")?.addEventListener("click", openCart);

  $$("[data-close='cart']").forEach((el) => {
    el.addEventListener("click", closeCart);
  });

  $("#checkoutBtn")?.addEventListener("click", handleCheckoutClick);

  $("#backFromLoginBtn")?.addEventListener("click", () => {
    hidePage("loginPage");
  });

  $("#backFromConfirmBtn")?.addEventListener("click", () => {
    hidePage("confirmPage");
  });

  $("#loginForm")?.addEventListener("submit", handleVendorLogin);
  $("#logoutStoreBtn")?.addEventListener("click", handleVendorLogout);
  $("#submitOrderBtn")?.addEventListener("click", submitOrder);
}

/* =========================
   Supabase Session
========================= */

async function restoreSession() {
  const { data } = await sb.auth.getSession();

  if (!data.session?.user) {
    state.sessionUser = null;
    state.vendorAccount = null;
    return;
  }

  state.sessionUser = data.session.user;
  await loadVendorAccount();
}

function vendorEmailFromCode(vendorCode) {
  return `${String(vendorCode || "").trim().toLowerCase()}@stall.shenduiyou.local`;
}

async function handleVendorLogin(event) {
  event.preventDefault();

  const vendorCode = $("#storeAccount").value.trim().toUpperCase();
  const password = $("#storePassword").value.trim();

  if (!vendorCode || !password) {
    toast("請輸入帳號與密碼");
    return;
  }

  const email = vendorEmailFromCode(vendorCode);

  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    toast("帳號或密碼錯誤");
    return;
  }

  state.sessionUser = data.user;

  const ok = await loadVendorAccount();

  if (!ok) {
    await sb.auth.signOut();
    state.sessionUser = null;
    state.vendorAccount = null;
    toast("此攤商帳號尚未啟用");
    return;
  }

  hidePage("loginPage");
  await openConfirmPage();
}

async function loadVendorAccount() {
  if (!state.sessionUser?.id) {
    state.vendorAccount = null;
    return false;
  }

  const { data, error } = await sb
    .from("vendor_accounts")
    .select("*")
    .eq("auth_user_id", state.sessionUser.id)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    state.vendorAccount = null;
    return false;
  }

  state.vendorAccount = data;
  await loadMonthlyReward();
  return true;
}

async function handleVendorLogout() {
  await sb.auth.signOut();

  state.sessionUser = null;
  state.vendorAccount = null;
  state.monthlyReward = 0;

  hidePage("confirmPage");
  showPage("loginPage");
  toast("已切換店家");
}

/* =========================
   商品
========================= */

async function loadProducts() {
  const productGrid = $("#productGrid");
  const productTotal = $("#productTotal");

  if (productGrid) {
    productGrid.innerHTML = `
      <div class="loading-box">
        <div class="loading-title">📦 耗材整理中</div>
        <div class="loading-desc">正在讀取後台商品資料</div>
        <div class="loading-tip">請稍候一下 🚚</div>
      </div>
    `;
  }

  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("is_visible", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);

    if (productGrid) {
      productGrid.innerHTML = `<div class="empty-box">商品讀取失敗，請稍後再試。</div>`;
    }

    if (productTotal) {
      productTotal.textContent = "商品讀取失敗";
    }

    toast("商品讀取失敗");
    return;
  }

  state.products = data || [];
  state.categories = buildCategories(state.products);

  applyProductFilters();
}

function buildCategories(products) {
  const set = new Set();

  products.forEach((product) => {
    if (product.category) {
      set.add(product.category);
    }
  });

  return ["全部", ...Array.from(set)];
}

function applyProductFilters() {
  const keyword = state.searchText;
  const category = state.activeCategory;

  state.filteredProducts = state.products.filter((product) => {
    const matchesCategory = category === "全部" || product.category === category;

    const text = [
      product.name,
      product.sku,
      product.brand_supplier,
      product.category,
      product.package_qty,
      product.unit,
      product.box_spec,
      product.box_price,
      product.description,
      Array.isArray(product.tags) ? product.tags.join(" ") : "",
    ].join(" ").toLowerCase();

    const matchesSearch = !keyword || text.includes(keyword);

    return matchesCategory && matchesSearch;
  });

  renderCategories();
  renderQuickList();
  renderProducts();
}

function renderCategories() {
  const categoryList = $("#categoryList");
  if (!categoryList) return;

  categoryList.innerHTML = state.categories
    .map((category) => {
      return `
        <button
          class="category-chip ${category === state.activeCategory ? "active" : ""}"
          type="button"
          data-category="${escapeAttr(category)}"
        >
          ${escapeHtml(category)}
        </button>
      `;
    })
    .join("");

  $$(".category-chip", categoryList).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeCategory = btn.dataset.category;
      applyProductFilters();
    });
  });
}

function renderQuickList() {
  const quickList = $("#quickList");
  if (!quickList) return;

  const featured = state.products
    .filter((product) => product.is_featured)
    .slice(0, 8);

  const list = featured.length ? featured : state.products.slice(0, 8);

  if (list.length === 0) {
    quickList.innerHTML = `<div class="empty-box">目前尚無熱門商品</div>`;
    return;
  }

  quickList.classList.remove("skeleton-row");

  quickList.innerHTML = list.map((product) => {
    const rewardRate = Number(product.reward_rate || 0);
    const hasBox = product.box_enabled && Number(product.box_price || 0) > 0;

    return `
      <article class="quick-card" data-product-id="${product.id}">
        ${product.image_url
          ? `<img src="${escapeAttr(product.image_url)}" alt="${escapeAttr(product.name)}" />`
          : `<div class="product-image-placeholder">無圖片</div>`
        }

        <strong>${escapeHtml(product.name)}</strong>
        <span>${money(product.price)}</span>

        ${hasBox ? `<small class="box-price-text">箱購 ${money(product.box_price)}</small>` : ""}
        ${rewardRate > 0 ? `<small class="reward-label">回饋 ${rewardRate}%</small>` : ""}

        <button class="small-add-btn" type="button" data-add-product="${product.id}">
          加入
        </button>
      </article>
    `;
  }).join("");

  $$("[data-add-product]", quickList).forEach((btn) => {
    btn.addEventListener("click", () => {
      addToCart(btn.dataset.addProduct);
    });
  });
}

function renderProducts() {
  const productGrid = $("#productGrid");
  const productTotal = $("#productTotal");

  if (!productGrid) return;

  if (productTotal) {
    productTotal.textContent = `${state.filteredProducts.length} 項商品`;
  }

  if (state.filteredProducts.length === 0) {
    productGrid.innerHTML = `<div class="empty-box">找不到符合條件的商品。</div>`;
    return;
  }

  productGrid.innerHTML = state.filteredProducts.map((product) => {
    const rewardRate = Number(product.reward_rate || 0);
    const hasBox = product.box_enabled && Number(product.box_price || 0) > 0;

    return `
      <article class="product-card">
        <div class="product-image-wrap">
          ${product.image_url
            ? `<img class="product-image" src="${escapeAttr(product.image_url)}" alt="${escapeAttr(product.name)}" loading="lazy" />`
            : `<div class="product-image-placeholder">無圖片</div>`
          }
        </div>

        <div class="product-content">
          <div class="product-category">${escapeHtml(product.category || "未分類")}</div>
          <h3>${escapeHtml(product.name)}</h3>

          <p class="product-spec">
            單包：${escapeHtml(product.package_qty || "")}
            ${escapeHtml(product.unit || "")}
          </p>

          ${hasBox ? `
            <p class="product-spec">
              單箱：${escapeHtml(product.box_spec || "")}｜${money(product.box_price)}
            </p>
          ` : ""}

          ${product.description ? `<p class="product-desc">${escapeHtml(product.description)}</p>` : ""}

          <div class="product-footer">
            <div>
              <strong class="product-price">${money(product.price)}</strong>
              ${rewardRate > 0 ? `<span class="reward-label">回饋 ${rewardRate}%</span>` : ""}
            </div>

            <button class="add-btn" type="button" data-add-product="${product.id}">
              加入補貨車
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  $$("[data-add-product]", productGrid).forEach((btn) => {
    btn.addEventListener("click", () => {
      addToCart(btn.dataset.addProduct);
    });
  });
}

/* =========================
   補貨車
========================= */

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);

  if (!product) {
    toast("找不到商品");
    return;
  }

  const current = state.cart.get(productId);

  if (current) {
    current.quantity += 1;
  } else {
    state.cart.set(productId, {
      id: product.id,
      name: product.name,
      price: Number(product.price || 0),
      reward_rate: Number(product.reward_rate || 0),
      image_url: product.image_url || "",
      package_qty: product.package_qty || "",
      unit: product.unit || "",
      box_spec: product.box_spec || "",
      box_price: Number(product.box_price || 0),
      box_enabled: Boolean(product.box_enabled),
      quantity: 1,
    });
  }

  renderCart();
  toast("已加入補貨車");
}

function changeCartQty(productId, diff) {
  const item = state.cart.get(productId);

  if (!item) return;

  item.quantity += diff;

  if (item.quantity <= 0) {
    state.cart.delete(productId);
  }

  renderCart();
}

function renderCart() {
  const items = Array.from(state.cart.values());
  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = getCartSubtotal();
  const reward = getCartReward();

  if ($("#cartCount")) $("#cartCount").textContent = totalQty;
  if ($("#bottomCartTotal")) $("#bottomCartTotal").textContent = money(subtotal);
  if ($("#cartTotal")) $("#cartTotal").textContent = money(subtotal);
  if ($("#cartRewardTotal")) $("#cartRewardTotal").textContent = money(reward);

  if ($("#cartRewardRow")) {
    $("#cartRewardRow").classList.toggle("hidden", reward <= 0);
  }

  if ($("#cartSummaryText")) {
    $("#cartSummaryText").textContent = totalQty > 0
      ? `${totalQty} 件商品`
      : "尚未加入商品";
  }

  renderCartItems();
}

function renderCartItems() {
  const cartItems = $("#cartItems");
  if (!cartItems) return;

  const items = Array.from(state.cart.values());

  if (items.length === 0) {
    cartItems.innerHTML = `<div class="empty-box">補貨車是空的。</div>`;
    return;
  }

  cartItems.innerHTML = items.map((item) => {
    const hasBox = item.box_enabled && Number(item.box_price || 0) > 0;
    const rewardRate = Number(item.reward_rate || 0);

    return `
      <div class="cart-item">
        <div class="cart-item-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>單包：${escapeHtml(item.package_qty || "")} ${escapeHtml(item.unit || "")}</span>

          ${hasBox ? `
            <span>單箱：${escapeHtml(item.box_spec || "")}｜${money(item.box_price)}</span>
          ` : ""}

          ${rewardRate > 0 ? `
            <span class="reward-label">回饋 ${rewardRate}%</span>
          ` : ""}

          <small>${money(item.price)} / 小計 ${money(item.price * item.quantity)}</small>
        </div>

        <div class="qty-control">
          <button type="button" data-cart-minus="${item.id}">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-plus="${item.id}">＋</button>
        </div>
      </div>
    `;
  }).join("");

  $$("[data-cart-minus]", cartItems).forEach((btn) => {
    btn.addEventListener("click", () => changeCartQty(btn.dataset.cartMinus, -1));
  });

  $$("[data-cart-plus]", cartItems).forEach((btn) => {
    btn.addEventListener("click", () => changeCartQty(btn.dataset.cartPlus, 1));
  });
}

function getCartSubtotal() {
  return Array.from(state.cart.values()).reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.quantity || 0);
  }, 0);
}

function getCartReward() {
  return Array.from(state.cart.values()).reduce((sum, item) => {
    const subtotal = Number(item.price || 0) * Number(item.quantity || 0);
    const rate = Number(item.reward_rate || 0);

    if (rate <= 0) {
      return sum;
    }

    return sum + subtotal * (rate / 100);
  }, 0);
}

function openCart() {
  $("#cartDrawer")?.classList.remove("hidden");
  renderCart();
}

function closeCart() {
  $("#cartDrawer")?.classList.add("hidden");
}

/* =========================
   確認與送單
========================= */

async function handleCheckoutClick() {
  if (state.cart.size === 0) {
    toast("請先加入商品");
    return;
  }

  closeCart();

  if (!state.vendorAccount) {
    showPage("loginPage");
    return;
  }

  await openConfirmPage();
}

async function openConfirmPage() {
  if (!state.vendorAccount) {
    showPage("loginPage");
    return;
  }

  await loadMonthlyReward();

  const vendorCode = state.vendorAccount.vendor_code;

  if ($("#bossGreeting")) {
    $("#bossGreeting").textContent = `${vendorCode} 老闆您好`;
  }

  if ($("#monthlyRewardText")) {
    $("#monthlyRewardText").textContent = money(state.monthlyReward);
  }

  if ($("#monthlyRewardRow")) {
    $("#monthlyRewardRow").classList.toggle("hidden", state.monthlyReward <= 0);
  }

  if ($("#storeInfoText")) {
    $("#storeInfoText").textContent = `目前登入攤商編號：${vendorCode}。完整店家資料由公司內部主機管理，本系統不顯示地址與店名。`;
  }

  renderConfirmItems();
  showPage("confirmPage");
}

function renderConfirmItems() {
  const items = Array.from(state.cart.values());
  const confirmItems = $("#confirmItems");

  if (!confirmItems) return;

  confirmItems.innerHTML = items.map((item) => {
    const hasBox = item.box_enabled && Number(item.box_price || 0) > 0;
    const rewardRate = Number(item.reward_rate || 0);

    return `
      <div class="confirm-item">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span>× ${item.quantity}</span>
          <small>單包：${escapeHtml(item.package_qty || "")} ${escapeHtml(item.unit || "")}</small>

          ${hasBox ? `
            <small>單箱：${escapeHtml(item.box_spec || "")}｜${money(item.box_price)}</small>
          ` : ""}

          ${rewardRate > 0 ? `
            <small class="reward-label">回饋 ${rewardRate}%</small>
          ` : ""}
        </div>

        <span>${money(item.price * item.quantity)}</span>
      </div>
    `;
  }).join("");

  const subtotal = getCartSubtotal();
  const reward = getCartReward();

  if ($("#confirmSubtotal")) {
    $("#confirmSubtotal").textContent = money(subtotal);
  }

  if ($("#confirmReward")) {
    $("#confirmReward").textContent = money(reward);
  }

  if ($("#confirmMonthlyAfter")) {
    $("#confirmMonthlyAfter").textContent = money(state.monthlyReward + reward);
  }

  if ($("#confirmRewardRow")) {
    $("#confirmRewardRow").classList.toggle("hidden", reward <= 0);
  }

  if ($("#confirmMonthlyAfterRow")) {
    $("#confirmMonthlyAfterRow").classList.toggle("hidden", reward <= 0 && state.monthlyReward <= 0);
  }
}

async function submitOrder() {
  if (!state.vendorAccount) {
    toast("請先登入");
    showPage("loginPage");
    return;
  }

  if (state.cart.size === 0) {
    toast("補貨車是空的");
    return;
  }

  const btn = $("#submitOrderBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "送出中...";
  }

  try {
    const cartItems = Array.from(state.cart.values());
    const totalAmount = getCartSubtotal();
    const note = $("#orderNote")?.value.trim() || "";

    const { data: order, error: orderError } = await sb
      .from("orders")
      .insert({
        vendor_auth_user_id: state.sessionUser.id,
        vendor_code: state.vendorAccount.vendor_code,
        total_amount: totalAmount,
        customer_note: note || null,
      })
      .select()
      .single();

    if (orderError) {
      throw orderError;
    }

    const orderItems = cartItems.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.price,
      subtotal: Number(item.price || 0) * Number(item.quantity || 0),
    }));

    const { error: itemsError } = await sb
      .from("order_items")
      .insert(orderItems);

    if (itemsError) {
      throw itemsError;
    }

    state.cart.clear();

    if ($("#orderNote")) {
      $("#orderNote").value = "";
    }

    renderCart();
    hidePage("confirmPage");

    toast("採購單已送出");
  } catch (error) {
    console.error(error);
    toast(`送出失敗：${error.message || "請稍後再試"}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "送出採購單";
    }
  }
}

/* =========================
   本月回饋
========================= */

async function loadMonthlyReward() {
  if (!state.vendorAccount) {
    state.monthlyReward = 0;
    return;
  }

  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const { data: orders, error: orderError } = await sb
    .from("orders")
    .select("id, created_at, order_status")
    .eq("vendor_code", state.vendorAccount.vendor_code)
    .gte("created_at", start.toISOString())
    .neq("order_status", "已取消");

  if (orderError || !orders?.length) {
    state.monthlyReward = 0;
    return;
  }

  const orderIds = orders.map((order) => order.id);

  const { data: items, error: itemError } = await sb
    .from("order_items")
    .select("product_id, subtotal")
    .in("order_id", orderIds);

  if (itemError || !items?.length) {
    state.monthlyReward = 0;
    return;
  }

  const productMap = new Map(state.products.map((product) => [product.id, product]));

  state.monthlyReward = items.reduce((sum, item) => {
    const product = productMap.get(item.product_id);
    const rate = Number(product?.reward_rate || 0);

    if (rate <= 0) {
      return sum;
    }

    return sum + Number(item.subtotal || 0) * (rate / 100);
  }, 0);
}

/* =========================
   頁面與工具
========================= */

function showPage(id) {
  $("#loginPage")?.classList.add("hidden");
  $("#confirmPage")?.classList.add("hidden");
  $(`#${id}`)?.classList.remove("hidden");
}

function hidePage(id) {
  $(`#${id}`)?.classList.add("hidden");
}

function toast(message) {
  const el = $("#toast");

  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.classList.remove("hidden");

  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.classList.add("hidden");
  }, 2200);
}

function money(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(number);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
