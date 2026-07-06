(function () {
  if (!window.supabase) {
    alert("Supabase SDK 載入失敗，請檢查網路或 CDN。");
    throw new Error("Supabase SDK missing");
  }

  if (!window.SDY_CONFIG) {
    alert("找不到前台設定檔，請確認 js/config.js 有正確載入。");
    throw new Error("SDY_CONFIG missing");
  }

  if (!window.SDY_CONFIG.SUPABASE_URL || !window.SDY_CONFIG.SUPABASE_ANON_KEY) {
    alert("Supabase URL 或 anon key 尚未設定，請檢查 js/config.js。");
    throw new Error("Supabase config incomplete");
  }

  window.sdySupabase = window.supabase.createClient(
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
})();
