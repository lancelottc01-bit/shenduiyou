const supabaseClient = window.supabase.createClient(
  window.SHENDUIYOU_CONFIG.SUPABASE_URL,
  window.SHENDUIYOU_CONFIG.SUPABASE_KEY
);

const API = {
  async getProducts() {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .eq("is_visible", true)
      .order("sort_order", { ascending: true });

    if (error) {
      throw new Error(error.message || "商品讀取失敗");
    }

    return data || [];
  },

  async storeLogin(account, password) {
    const { data, error } = await supabaseClient
      .from("stores")
      .select("*")
      .eq("account", account)
      .eq("password", password)
      .eq("enabled", true)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || "登入失敗");
    }

    if (!data) {
      return {
        ok: false,
        message: "店家帳號或密碼錯誤，或尚未啟用"
      };
    }

    return {
      ok: true,
      store: {
        storeId: data.id,
        account: data.account,
        storeName: data.store_name,
        bossName: data.boss_name,
        phone: data.phone,
        address: data.address,
        level: data.level,
        monthlyReward: Number(data.monthly_reward || 0),
        totalReward: Number(data.total_reward || 0),
        salesName: data.sales_name
      }
    };
  },

  async createOrder(payload) {
    const storeId = payload.storeId;
    const account = payload.account;
    const items = payload.items || [];
    const note = payload.note || "";

    if (!storeId && !account) {
      throw new Error("尚未登入店家帳號");
    }

    if (!items.length) {
      throw new Error("補貨車是空的");
    }

    const { data: store, error: storeError } = await supabaseClient
      .from("stores")
      .select("*")
      .or(`id.eq.${storeId},account.eq.${account}`)
      .eq("enabled", true)
      .maybeSingle();

    if (storeError) {
      throw new Error(storeError.message || "店家資料讀取失敗");
    }

    if (!store) {
      throw new Error("找不到店家資料");
    }

    const cleanItems = items.map((item) => {
      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      const rewardPercent = Number(item.rewardPercent || 0);
      const subtotal = Math.round(qty * price);
      const rewardAmount = Math.round((subtotal * rewardPercent) / 100);

      return {
        product_id: item.id,
        type: item.type,
        type_name: item.typeName,
        name: item.name,
        brand: item.brand,
        qty,
        unit_text: item.unitText,
        price,
        reward_percent: rewardPercent,
        subtotal,
        reward_amount: rewardAmount
      };
    }).filter(item => item.product_id && item.qty > 0);

    const subtotal = cleanItems.reduce((sum, item) => sum + item.subtotal, 0);
    const rewardAmount = cleanItems.reduce((sum, item) => sum + item.reward_amount, 0);

    const monthlyRewardBefore = Number(store.monthly_reward || 0);
    const monthlyRewardAfter = monthlyRewardBefore + rewardAmount;
    const totalRewardAfter = Number(store.total_reward || 0) + rewardAmount;

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const orderNo = `SDY${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .insert({
        order_no: orderNo,
        store_id: store.id,
        account: store.account,
        store_name: store.store_name,
        boss_name: store.boss_name,
        phone: store.phone,
        address: store.address,
        subtotal,
        reward_amount: rewardAmount,
        monthly_reward_before: monthlyRewardBefore,
        monthly_reward_after: monthlyRewardAfter,
        status: "已送出",
        ym,
        note
      })
      .select()
      .single();

    if (orderError) {
      throw new Error(orderError.message || "採購單建立失敗");
    }

    const orderItems = cleanItems.map(item => ({
      ...item,
      order_id: order.id
    }));

    const { error: itemError } = await supabaseClient
      .from("order_items")
      .insert(orderItems);

    if (itemError) {
      throw new Error(itemError.message || "採購明細建立失敗");
    }

    const { error: updateError } = await supabaseClient
      .from("stores")
      .update({
        monthly_reward: monthlyRewardAfter,
        total_reward: totalRewardAfter,
        updated_at: new Date().toISOString()
      })
      .eq("id", store.id);

    if (updateError) {
      throw new Error(updateError.message || "回饋更新失敗");
    }

    return {
      ok: true,
      orderId: orderNo,
      subtotal,
      rewardAmount,
      monthlyRewardBefore,
      monthlyRewardAfter,
      store: {
        storeId: store.id,
        account: store.account,
        storeName: store.store_name,
        bossName: store.boss_name,
        phone: store.phone,
        address: store.address,
        level: store.level,
        monthlyReward: monthlyRewardAfter,
        totalReward: totalRewardAfter,
        salesName: store.sales_name
      },
      message: "採購單已送出"
    };
  }
};
