let sb = window.sdySupabase;

if (!sb) {
  if (window.supabase && window.SDY_CONFIG?.SUPABASE_URL && window.SDY_CONFIG?.SUPABASE_ANON_KEY) {
    sb = window.supabase.createClient(
      window.SDY_CONFIG.SUPABASE_URL,
      window.SDY_CONFIG.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );

    window.sdySupabase = sb;
  } else {
    alert("前台 Supabase 尚未連線成功，請檢查 js/config.js 與 js/supabase.js");
    throw new Error("Supabase client missing");
  }
}

const state = {
  products: [],
  filteredProducts: [],
  categories: [],
  activeCategory: "全部",
  searchText: "",
  cart: new Map(),

  vendorAccount: null,
  sessionUser: null,
  loginIntent: null,

  monthlyReward: 0,

  rewardProducts: [],
  rewardLedgerTotal: 0,
  rewardPendingPoints: 0,
  rewardBalance: 0,
  rewardRedemptions: [],
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  hideQuickSection();
  bindEvents();

  await Promise.all([
    loadProducts(),
    loadRewardProducts(),
  ]);

  await restoreSession();

  renderCart();
  renderRewardBalance();
  renderRewardProducts();
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
    state.loginIntent = null;
    hidePage("loginPage");
  });

  $("#backFromConfirmBtn")?.addEventListener("click", () => {
    hidePage("confirmPage");
  });

  $("#loginForm")?.addEventListener("submit", handleVendorLogin);
  $("#logoutStoreBtn")?.addEventListener("click", handleVendorLogout);
  $("#submitOrderBtn")?.addEventListener("click", submitOrder);

  $("#rewardLoginBtn")?.addEventListener("click", handleRewardLoginClick);
  $("#rewardBalanceLoginBtn")?.addEventListener("click", handleRewardLoginClick);

  $("#rewardRefreshBtn")?.addEventListener("click", async () => {
    await loadRewardProducts();

    if (state.vendorAccount) {
      await refreshRewardAccount();
    }

    toast("回饋資料已更新");
  });
}

/* =========================
   首頁區塊
========================= */

function hideQuickSection() {
  const quickList = $("#quickList");

  if (quickList) {
    const section = quickList.closest(".section-block");
    if (section) {
      section.remove();
    }
  }
}

/* =========================
   Supabase Session
========================= */

async function restoreSession() {
  const { data } = await sb.auth.getSession();

  if (!data.session?.user) {
    state.sessionUser = null;
    state.vendorAccount = null;
    renderRewardBalance();
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

  if (state.loginIntent === "checkout" || state.cart.size > 0) {
    state.loginIntent = null;
    await openConfirmPage();
    return;
  }

  state.loginIntent = null;
  scrollToRewardSection();
  toast(`目前可用回饋：${Math.floor(state.rewardBalance)} 點`);
}

async function loadVendorAccount() {
  if (!state.sessionUser?.id) {
    state.vendorAccount = null;
    renderRewardBalance();
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
    renderRewardBalance();
    return false;
  }

  state.vendorAccount = data;

  await Promise.all([
    loadMonthlyReward(),
    refreshRewardAccount(),
  ]);

  renderRewardProducts();
  return true;
}

async function handleVendorLogout() {
  await sb.auth.signOut();

  state.sessionUser = null;
  state.vendorAccount = null;
  state.monthlyReward = 0;
  state.rewardLedgerTotal = 0;
  state.rewardPendingPoints = 0;
  state.rewardBalance = 0;
  state.rewardRedemptions = [];
  state.loginIntent = null;

  hidePage("confirmPage");
  showPage("loginPage");
  renderRewardBalance();
  renderRewardProducts();
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
      productGrid.innerHTML = `<div class="empty-box">商品讀取失敗：${escapeHtml(error.message)}</div>`;
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
    const singleRewardRate = getSingleRewardRate(product);
    const boxRewardRate = getBoxRewardRate(product);
    const hasBox = hasBoxPurchase(product);
    const singleSpec = formatSingleSpec(product);
    const boxSpec = formatBoxSpec(product);

    return `
      <article class="product-card">
        <div class="product-image-wrap">
          ${product.image_url
            ? `<img class="product-image" src="${escapeAttr(product.image_url)}" alt="${escapeAttr(product.name)}" loading="lazy" />`
            : `<div class="product-image-placeholder">無圖片</div>`
          }
        </div>

        <div class="product-content">
          <h3>${escapeHtml(product.name)}</h3>

          ${product.brand_supplier ? `
            <div class="brand-supplier-line">
              ${escapeHtml(product.brand_supplier)}
            </div>
          ` : ""}

          <div class="purchase-options clean-purchase-options">
            <div class="purchase-option clean-purchase-option">
              <div>
                <p class="product-spec">每包：${escapeHtml(singleSpec)}</p>
                <strong class="product-price">${money(product.price)}</strong>
                ${singleRewardRate > 0 ? `
                  <span class="purchase-reward-label">單包回饋 ${singleRewardRate}%</span>
                ` : ""}
              </div>

              <button
                class="add-btn"
                type="button"
                data-add-product="${product.id}"
                data-purchase-type="single"
              >
                加一包
              </button>
            </div>

            ${hasBox ? `
              <div class="purchase-option clean-purchase-option">
                <div>
                  <p class="product-spec">每箱：${escapeHtml(boxSpec)}</p>
                  <strong class="product-price box-price">${money(product.box_price)}</strong>
                  ${boxRewardRate > 0 ? `
                    <span class="purchase-reward-label box-reward">箱購回饋 ${boxRewardRate}%</span>
                  ` : ""}
                </div>

                <button
                  class="add-btn box-add-btn"
                  type="button"
                  data-add-product="${product.id}"
                  data-purchase-type="box"
                >
                  加一箱
                </button>
              </div>
            ` : ""}
          </div>

          ${product.description ? `
            <p class="product-desc product-desc-soft">
              ${escapeHtml(product.description)}
            </p>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");

  $$("[data-add-product]", productGrid).forEach((btn) => {
    btn.addEventListener("click", () => {
      addToCart(btn.dataset.addProduct, btn.dataset.purchaseType || "single");
    });
  });
}

/* =========================
   回饋兌換商品
========================= */

async function loadRewardProducts() {
  const rewardProductList = $("#rewardProductList");

  if (rewardProductList) {
    rewardProductList.innerHTML = `<div class="empty-box">回饋商品載入中...</div>`;
  }

  const { data, error } = await sb
    .from("reward_products")
    .select("*")
    .eq("is_visible", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);

    if (rewardProductList) {
      rewardProductList.innerHTML = `<div class="empty-box">回饋商品讀取失敗：${escapeHtml(error.message)}</div>`;
    }

    return;
  }

  state.rewardProducts = data || [];
  renderRewardProducts();
}

function renderRewardProducts() {
  const rewardProductList = $("#rewardProductList");
  if (!rewardProductList) return;

  const list = state.rewardProducts.slice(0, 8);

  if (list.length === 0) {
    rewardProductList.innerHTML = `<div class="empty-box">目前尚無可兌換商品。</div>`;
    return;
  }

  rewardProductList.innerHTML = list.map((item) => {
    const points = Number(item.points_required || 0);
    const stock = Number(item.stock || 0);
    const disabled = stock <= 0;

    return `
      <article class="reward-product-card">
        <div class="reward-product-image-wrap">
          ${item.image_url
            ? `<img src="${escapeAttr(item.image_url)}" alt="${escapeAttr(item.name)}" loading="lazy" />`
            : `<div class="reward-product-placeholder">無圖片</div>`
          }
        </div>

        <div class="reward-product-info">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.spec || "依商品標示")}</span>
          <b>${points} 點兌換</b>
          ${stock > 0 ? `<small>剩餘 ${stock}</small>` : `<small class="sold-out-text">暫無庫存</small>`}
        </div>

        <button
          class="reward-redeem-btn"
          type="button"
          data-redeem-product="${item.id}"
          ${disabled ? "disabled" : ""}
        >
          ${disabled ? "暫無庫存" : state.vendorAccount ? "申請兌換" : "登入兌換"}
        </button>
      </article>
    `;
  }).join("");

  $$("[data-redeem-product]", rewardProductList).forEach((btn) => {
    btn.addEventListener("click", () => {
      handleRedeemClick(btn.dataset.redeemProduct);
    });
  });
}

function handleRewardLoginClick() {
  if (state.vendorAccount) {
    scrollToRewardSection();
    toast(`目前可用回饋：${Math.floor(state.rewardBalance)} 點`);
    return;
  }

  state.loginIntent = "reward";
  showPage("loginPage");
}

async function refreshRewardAccount() {
  await Promise.all([
    loadRewardLedgerTotal(),
    loadRewardRedemptions(),
  ]);

  applyRewardBalance();
  renderRewardBalance();
}

async function loadRewardLedgerTotal() {
  if (!state.vendorAccount?.vendor_code) {
    state.rewardLedgerTotal = 0;
    return;
  }

  const { data, error } = await sb
    .from("reward_ledger")
    .select("points")
    .eq("vendor_code", state.vendorAccount.vendor_code);

  if (error) {
    console.error(error);
    state.rewardLedgerTotal = 0;
    return;
  }

  state.rewardLedgerTotal = (data || []).reduce((sum, row) => {
    return sum + Number(row.points || 0);
  }, 0);
}

async function loadRewardRedemptions() {
  if (!state.vendorAccount?.vendor_code) {
    state.rewardRedemptions = [];
    state.rewardPendingPoints = 0;
    return;
  }

  const { data, error } = await sb
    .from("reward_redemptions")
    .select("id, status, total_points")
    .eq("vendor_code", state.vendorAccount.vendor_code)
    .in("status", ["待確認", "已確認"]);

  if (error) {
    console.error(error);
    state.rewardRedemptions = [];
    state.rewardPendingPoints = 0;
    return;
  }

  state.rewardRedemptions = data || [];
  state.rewardPendingPoints = state.rewardRedemptions.reduce((sum, item) => {
    return sum + Number(item.total_points || 0);
  }, 0);
}

function applyRewardBalance() {
  const available = Number(state.rewardLedgerTotal || 0) - Number(state.rewardPendingPoints || 0);
  state.rewardBalance = Math.max(0, available);
}

function renderRewardBalance() {
  const rewardBalanceText = $("#rewardBalanceText");
  const rewardBalanceLoginBtn = $("#rewardBalanceLoginBtn");

  if (rewardBalanceText) {
    rewardBalanceText.textContent = state.vendorAccount
      ? `${Math.floor(state.rewardBalance)} 點`
      : "登入後查看";
  }

  if (rewardBalanceLoginBtn) {
    rewardBalanceLoginBtn.textContent = state.vendorAccount
      ? "已登入"
      : "登入查看";
  }
}

async function handleRedeemClick(productId) {
  const item = state.rewardProducts.find((product) => product.id === productId);

  if (!item) {
    toast("找不到回饋商品");
    return;
  }

  if (!state.vendorAccount) {
    state.loginIntent = "reward";
    showPage("loginPage");
    return;
  }

  await refreshRewardAccount();

  const pointsRequired = Number(item.points_required || 0);
  const stock = Number(item.stock || 0);

  if (stock <= 0) {
    toast("此回饋商品目前暫無庫存");
    return;
  }

  if (pointsRequired <= 0) {
    toast("此商品尚未設定兌換點數");
    return;
  }

  if (state.rewardBalance < pointsRequired) {
    toast(`目前可用 ${Math.floor(state.rewardBalance)} 點，點數不足`);
    return;
  }

  const ok = confirm(`確定要使用 ${pointsRequired} 點申請兌換「${item.name}」嗎？`);

  if (!ok) return;

  try {
    const { error } = await sb
      .from("reward_redemptions")
      .insert({
        vendor_code: state.vendorAccount.vendor_code,
        reward_product_id: item.id,
        product_name: item.name,
        product_spec: item.spec || "",
        points_required: pointsRequired,
        quantity: 1,
        total_points: pointsRequired,
        status: "待確認",
      });

    if (error) {
      throw error;
    }

    await refreshRewardAccount();
    renderRewardProducts();

    toast("兌換申請已送出，等待後台確認");
  } catch (error) {
    console.error(error);
    toast(`兌換失敗：${error.message || "請稍後再試"}`);
  }
}

function scrollToRewardSection() {
  const section = $(".reward-exchange-section");

  if (section) {
    section.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

/* =========================
   補貨車
========================= */

function addToCart(productId, purchaseType = "single") {
  const product = state.products.find((item) => item.id === productId);

  if (!product) {
    toast("找不到商品");
    return;
  }

  const isBox = purchaseType === "box";
  const hasBox = hasBoxPurchase(product);

  if (isBox && !hasBox) {
    toast("此商品尚未設定完整箱購規格");
    return;
  }

  const cartKey = `${productId}:${purchaseType}`;
  const price = isBox ? Number(product.box_price || 0) : Number(product.price || 0);
  const rewardRate = isBox ? getBoxRewardRate(product) : getSingleRewardRate(product);

  const current = state.cart.get(cartKey);

  if (current) {
    current.quantity += 1;
  } else {
    state.cart.set(cartKey, {
      cart_key: cartKey,
      id: product.id,
      name: product.name,
      price,
      purchase_type: purchaseType,
      reward_rate: rewardRate,
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
  toast(isBox ? "已加入一箱" : "已加入一包");
}

function changeCartQty(cartKey, diff) {
  const item = state.cart.get(cartKey);

  if (!item) return;

  item.quantity += diff;

  if (item.quantity <= 0) {
    state.cart.delete(cartKey);
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
    const rewardRate = Number(item.reward_rate || 0);
    const isBox = item.purchase_type === "box";
    const typeLabel = isBox ? "箱購" : "單包";
    const specText = isBox ? formatBoxSpec(item) : formatSingleSpec(item);

    return `
      <div class="cart-item">
        <div class="cart-item-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${typeLabel}：${escapeHtml(specText)}</span>

          ${rewardRate > 0 ? `
            <span class="reward-label">${isBox ? "箱購回饋" : "單包回饋"} ${rewardRate}%</span>
          ` : ""}

          <small>${money(item.price)} / 小計 ${money(item.price * item.quantity)}</small>
        </div>

        <div class="qty-control">
          <button type="button" data-cart-minus="${item.cart_key}">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-plus="${item.cart_key}">＋</button>
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
    state.loginIntent = "checkout";
    showPage("loginPage");
    return;
  }

  await openConfirmPage();
}

async function openConfirmPage() {
  if (!state.vendorAccount) {
    state.loginIntent = "checkout";
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
    const rewardRate = Number(item.reward_rate || 0);
    const isBox = item.purchase_type === "box";
    const typeLabel = isBox ? "箱購" : "單包";
    const specText = isBox ? formatBoxSpec(item) : formatSingleSpec(item);

    return `
      <div class="confirm-item">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span>${typeLabel} × ${item.quantity}</span>
          <small>${escapeHtml(specText)}</small>

          ${rewardRate > 0 ? `
            <small class="reward-label">${isBox ? "箱購回饋" : "單包回饋"} ${rewardRate}%</small>
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
    state.loginIntent = "checkout";
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

    const orderItems = cartItems.map((item) => {
      const subtotal = Number(item.price || 0) * Number(item.quantity || 0);
      const rewardRate = Number(item.reward_rate || 0);
      const rewardAmount = Math.round(subtotal * (rewardRate / 100));

      return {
        order_id: order.id,
        product_id: item.id,
        product_name: item.name,
        purchase_type: item.purchase_type,
        quantity: item.quantity,
        unit_price: item.price,
        subtotal,
        reward_rate_snapshot: rewardRate,
        reward_amount_snapshot: rewardAmount,
        package_qty_snapshot: item.package_qty || null,
        unit_snapshot: item.unit || null,
        box_spec_snapshot: item.box_spec || null,
        single_price_snapshot: item.purchase_type === "single" ? item.price : null,
        box_price_snapshot: item.purchase_type === "box" ? item.price : null,
      };
    });

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
    .select("product_id, subtotal, reward_amount_snapshot, reward_rate_snapshot")
    .in("order_id", orderIds);

  if (itemError || !items?.length) {
    state.monthlyReward = 0;
    return;
  }

  const productMap = new Map(state.products.map((product) => [product.id, product]));

  state.monthlyReward = items.reduce((sum, item) => {
    const snapshotAmount = Number(item.reward_amount_snapshot || 0);

    if (snapshotAmount > 0) {
      return sum + snapshotAmount;
    }

    const product = productMap.get(item.product_id);
    const rate = Number(item.reward_rate_snapshot || product?.reward_rate || 0);

    if (rate <= 0) {
      return sum;
    }

    return sum + Number(item.subtotal || 0) * (rate / 100);
  }, 0);
}

/* =========================
   格式工具
========================= */

function hasBoxPurchase(product) {
  return Boolean(product.box_enabled)
    && Number(product.box_price || 0) > 0
    && String(product.box_spec || "").trim().length > 0;
}

function getSingleRewardRate(product) {
  return Number(product?.single_reward_rate ?? product?.reward_rate ?? 0);
}

function getBoxRewardRate(product) {
  return Number(product?.box_reward_rate ?? product?.reward_rate ?? 0);
}

function formatSingleSpec(product) {
  const spec = String(product.package_qty || "").trim();
  const unit = String(product.unit || "").trim();

  if (spec && unit) return `${spec}/${unit}`;
  if (spec) return spec;
  if (unit) return unit;

  return "未設定規格";
}

function formatBoxSpec(product) {
  return String(product.box_spec || "").trim();
}

/* =========================
   頁面與共用工具
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
