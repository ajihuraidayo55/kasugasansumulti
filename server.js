const express = require('express');
const cors = require('cors'); // 👈 CORSブロックを解除するためのライブラリ
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 🌐 【超重要】GitHub Pagesからのアクセス（fetch通信）をすべて許可する設定
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// 🧠 Socket.ioの設定（ここもすべての外部ドメインからの接続を許可）
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket']
});

// ポート番号の設定（Render環境では環境変数から自動取得、ローカルでは10000番）
const PORT = process.env.PORT || 10000;

// タイムラインのデータを保存する配列（簡易データベース）
let timelinePosts = [];

// プロバイダーごとのダミーアバター画像
const AVATARS = {
  google: 'https://api.dicebear.com/7.x/bottts/svg?seed=Google',
  apple: 'https://api.dicebear.com/7.x/bottts/svg?seed=Apple',
  microsoft: 'https://api.dicebear.com/7.x/bottts/svg?seed=Microsoft',
  clever: 'https://api.dicebear.com/7.x/bottts/svg?seed=Clever',
  github: 'https://api.dicebear.com/7.x/bottts/svg?seed=GitHub',
  hotmail: 'https://api.dicebear.com/7.x/bottts/svg?seed=Hotmail'
};

// ------------------------------------------------------------
// 🔑 1. ログイン処理（APIエンドポイント）
// ------------------------------------------------------------
app.post('/auth/mock-login', (req, res) => {
  const { username, provider } = req.body;
  
  if (!username || !provider) {
    return res.status(400).json({ success: false, message: 'ユーザー名とプロバイダーが必要です' });
  }

  // ユーザーごとに固有のIDとアバターを割り当てて返す
  const user = {
    id: '_' + Math.random().toString(36).substr(2, 9),
    name: username,
    provider: provider,
    avatar: AVATARS[provider] || 'https://api.dicebear.com/7.x/bottts/svg?seed=Unknown'
  };

  res.json({ success: true, user });
});

// ------------------------------------------------------------
// 💬 2. リアルタイム通信処理（Socket.io）
// ------------------------------------------------------------
io.on('connection', (socket) => {
  let activeUser = null;

  // ユーザーがSNSに入室したとき
  socket.on('user-join-sns', (user) => {
    activeUser = user;
    
    // 最初に入室した人に、今までのタイムラインを全送信する
    socket.emit('load-timeline', timelinePosts);

    // 他のみんなに「〇〇が入室したよ」と通知する
    io.emit('system-message', `${user.name} が ${user.provider.toUpperCase()} アカウントでサインインしました。`);
  });

  // 新しい投稿が送られてきたとき
  socket.on('new-post', (text) => {
    if (!activeUser) return;

    const newPost = {
      id: 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      user: activeUser,
      text: text,
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      loves: [], // いいねしたユーザーのIDを入れる配列
      favos: []  // お気に入りしたユーザーのIDを入れる配列
    };

    timelinePosts.push(newPost);
    // 投稿件数が多くなりすぎたら古いものを消す（最大50件キープ）
    if (timelinePosts.length > 50) timelinePosts.shift();

    // 全員に新しい投稿をリアルタイム配信
    io.emit('broadcast-post', newPost);
  });

  // ❤️ いいねボタンが押されたとき
  socket.on('toggle-love', (postId) => {
    if (!activeUser) return;
    const post = timelinePosts.find(p => p.id === postId);
    if (post) {
      const index = post.loves.indexOf(activeUser.id);
      if (index === -1) {
        post.loves.push(activeUser.id); // いいね追加
      } else {
        post.loves.splice(index, 1); // すでに押してたら解除
      }
      // 全員に状態を同期
      io.emit('update-post-status', post);
    }
  });

  // ⭐ お気に入りボタンが押されたとき
  socket.on('toggle-favo', (postId) => {
    if (!activeUser) return;
    const post = timelinePosts.find(p => p.id === postId);
    if (post) {
      const index = post.favos.indexOf(activeUser.id);
      if (index === -1) {
        post.favos.push(activeUser.id); // お気に入り追加
      } else {
        post.favos.splice(index, 1); // すでに押してたら解除
      }
      // 全員に状態を同期
      io.emit('update-post-status', post);
    }
  });

  // 接続が切れたとき
  socket.on('disconnect', () => {
    if (activeUser) {
      io.emit('system-message', `${activeUser.name} が退室しました。`);
    }
  });
});

// 🚀 サーバー起動
server.listen(PORT, () => {
  console.log(`SNS Server running on port ${PORT}`);
});