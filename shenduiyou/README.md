# 神隊友｜餐飲耗材補貨平台

## 檔案結構

- index.html
- css/style.css
- js/config.js
- js/api.js
- js/app.js
- images/hero-banner.png

## Google Apps Script API

目前 API 寫在 `js/config.js`：

```js
window.SHENDUIYOU_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbzSp5qA1pzdLO8i2Ymy72HKIDYH0Ba4ZbE9dSCaVo7fcrdbzq4YCuhcDSP5jRu4Vr935w/exec"
};
```

## 需要的 Sheet

- Products
- Stores
- Orders
