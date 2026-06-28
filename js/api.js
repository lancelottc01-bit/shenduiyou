const API = (() => {
  const config = window.SHENDUIYOU_CONFIG || {};

  async function request(action, payload = {}) {
    const url = config.API_URL;

    if (!url || url.includes('請填入')) {
      throw new Error('尚未設定 Apps Script Web App URL');
    }

    try {
      if (action === 'products') {
        const res = await fetch(`${url}?action=products`, {
          method: 'GET'
        });

        if (!res.ok) {
          throw new Error('讀取商品失敗');
        }

        const data = await res.json();

        if (data && data.ok === false) {
          throw new Error(data.message || '商品資料讀取失敗');
        }

        return data;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify({
          action,
          ...payload
        })
      });

      if (!res.ok) {
        throw new Error('系統連線失敗');
      }

      const data = await res.json();

      if (data && data.ok === false) {
        throw new Error(data.message || '系統處理失敗');
      }

      return data;

    } catch (err) {
      console.error(`API ${action} error:`, err);
      throw new Error(err.message || '系統連線異常，請稍後再試');
    }
  }

  return {
    getProducts() {
      return request('products');
    },

    storeLogin(account, password) {
      return request('storeLogin', {
        account,
        password
      });
    },

    createOrder(payload) {
      return request('createOrder', payload);
    }
  };
})();
