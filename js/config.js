// ===== アプリ設定 =====
// GAS_URL を空のままにすると「お試しモード」で動きます（写真は端末内だけに一時保存）。
window.APP_CONFIG = {
  // Google Apps Script をウェブアプリとしてデプロイしたURL（.../exec）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyJvhCml7BZ9ShVoVY21JVdjNwJKETZIqubq4lV-tuqLfUdhxoSRy96p96okORj6ntK/exec',
  // 手順2-6のURL
  EVENT_DATE: '2026-10-12',  
  // 挙式日（写真の日付スタンプにも使います）
  VENUE: 'Karuizawa',

  // ギャラリーの自動更新間隔（秒）
  REFRESH_SEC: 20
};
