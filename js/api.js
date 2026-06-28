const API = (() => {
  const config = window.SHENDUIYOU_CONFIG || {};

  async function request(action, payload = {}) {
    const url = config.API_URL;
    if (!url || url.includes('請填入')) {
      throw new Error('尚未設定 Apps Script Web App URL');
    }

    if (action === 'products') {
      const res = await fetch(`${url}?action=products`, { method: 'GET' });
      if (!res.ok) throw new Error('讀取商品失敗');
      return res.json();
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload })
    });

    if (!res.ok) throw new Error('系統連線失敗');
    return res.json();
  }

  return {
    getProducts: () => request('products'),
    storeLogin: (account, password) => request('storeLogin', { account, password }),
    createOrder: (payload) => request('createOrder', payload)
  };
})();
