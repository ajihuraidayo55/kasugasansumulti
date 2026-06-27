const express = require('express');
const router = express.Router();

// 1. テスト用模擬ログインAPI（鍵の登録なしで即座にSNSを試せる機能）
router.post('/mock-login', (req, res) => {
  const { username, provider } = req.body;
  if (!username) return res.status(400).json({ error: 'ユーザー名が必要です' });

  res.json({
    success: true,
    user: {
      id: `${provider}_${Date.now()}`,
      name: username,
      avatar: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(username)}`, // 自動ドット絵アイコン
      provider: provider
    }
  });
});

// 2. 本番用OAuth2リダイレクトルーティングの骨組み
const providers = ['google', 'apple', 'microsoft', 'clever', 'github', 'hotmail'];

providers.forEach(provider => {
  // 各ボタンが押された時の公式認証画面への転送エンドポイント
  router.get(`/${provider}`, (req, res) => {
    // 【本番実装時の例】
    // res.redirect(`https://github.com/login/oauth/authorize?client_id=${process.env.GH_CLIENT_ID}...`);
    res.send(`${provider}の公式認証画面へリダイレクトします（環境変数のAPIキー設定が必要です）`);
  });

  // 認証成功後に公式から返ってくるコールバック受け皿
  router.get(`/${provider}/callback`, (req, res) => {
    res.redirect('/');
  });
});

module.exports = router;