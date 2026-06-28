const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 👈 重要なポイント：Base64の重い画像データを受け取れるように制限を拡張！

// UptimeRobotのHEADリクエストを正常（200 OK）として受け取る設定（これで404対策もバッチリ！）
app.head('/', (req, res) => res.status(200).end());
app.get('/', (req, res) => res.send('SNS Server is running!'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 🐘 データベース接続設定 (Render Postgres)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🛠️ データベースの初期化（画像用のカラム "image" がなければ自動追加する）
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      username TEXT,
      provider TEXT,
      avatar TEXT,
      text TEXT,
      image TEXT, -- 👈 ここにBase64の画像文字列がそのまま保存されます
      timestamp TEXT,
      loves TEXT[] DEFAULT '{}',
      favos TEXT[] DEFAULT '{}'
    )
  `);
}
initDB().catch(console.error);

// 🔌 Socket.io リアルタイム通信の処理
io.on('connection', (socket) => {
  let activeUser = null;

  // 1. ユーザーがSNSに参加した時（過去のタイムラインを全送信）
  socket.on('user-join-sns', async (user) => {
    activeUser = user;
    try {
      const res = await pool.query('SELECT * FROM posts ORDER BY timestamp ASC');
      // データベースから取得したデータをフロントエンドが読める形に整形
      const posts = res.rows.map(row => ({
        id: row.id,
        user: { name: row.username, provider: row.provider, avatar: row.avatar },
        text: row.text,
        image: row.image, // 👈 画像データもタイムラインに載せる
        timestamp: row.timestamp,
        loves: row.loves || [],
        favos: row.favos || []
      }));
      socket.emit('load-timeline', posts);
    } catch (err) {
      console.error(err);
    }
  });

  // 2. 新しい投稿（文字＋画像）が送られてきた時の処理
  socket.on('new-post', async (data) => {
    if (!activeUser) return;

    // 文字列単体で送られてきた場合と、オブジェクト{text, image}で送られてきた場合の両方に対応
    const postText = typeof data === 'string' ? data : (data.text || '');
    const postImage = typeof data === 'object' ? (data.image || null) : null;

    const newPost = {
      id: 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      user: activeUser,
      text: postText,
      image: postImage, // 👈 これで画像データが入る
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      loves: [],
      favos: []
    };

    try {
      // データベースに保存
      await pool.query(
        `INSERT INTO posts (id, username, provider, avatar, text, image, timestamp, loves, favos) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newPost.id, 
          newPost.user.name, 
          newPost.user.provider, 
          newPost.user.avatar, 
          newPost.text, 
          newPost.image, // $6 
          newPost.timestamp, 
          [], 
          []
        ]
      );
      // 全員にリアルタイムで拡散！
      io.emit('broadcast-post', newPost);
    } catch (err) {
      console.error(err);
    }
  });

  // 3. ❤️ ボタンの処理
  socket.on('toggle-love', async (postId) => {
    if (!activeUser) return;
    try {
      const res = await pool.query('SELECT loves FROM posts WHERE id = $1', [postId]);
      if (res.rows.length === 0) return;
      let loves = res.rows[0].loves || [];

      if (loves.includes(activeUser.id)) {
        loves = loves.filter(id => id !== activeUser.id);
      } else {
        loves.push(activeUser.id);
      }

      await pool.query('UPDATE posts SET loves = $1 WHERE id = $2', [loves, postId]);
      updatePostStatus(postId);
    } catch (err) {
      console.error(err);
    }
  });

  // 4. ⭐ ボタンの処理
  socket.on('toggle-favo', async (postId) => {
    if (!activeUser) return;
    try {
      const res = await pool.query('SELECT favos FROM posts WHERE id = $1', [postId]);
      if (res.rows.length === 0) return;
      let favos = res.rows[0].favos || [];

      if (favos.includes(activeUser.id)) {
        favos = favos.filter(id => id !== activeUser.id);
      } else {
        favos.push(activeUser.id);
      }

      await pool.query('UPDATE posts SET favos = $1 WHERE id = $2', [favos, postId]);
      updatePostStatus(postId);
    } catch (err) {
      console.error(err);
    }
  });

  // 状態更新を全員に通知するヘルパー関数
  async function updatePostStatus(postId) {
    try {
      const res = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        const updatedPost = {
          id: row.id,
          user: { name: row.username, provider: row.provider, avatar: row.avatar },
          text: row.text,
          image: row.image,
          timestamp: row.timestamp,
          loves: row.loves || [],
          favos: row.favos || []
        };
        io.emit('update-post-status', updatedPost);
      }
    } catch (err) {
      console.error(err);
    }
  }

  socket.on('disconnect', () => {
    if (activeUser) {
      io.emit('system-message', `${activeUser.name} が切断しました`);
    }
  });
});

// 🔑 ログイン用モックAPI
app.post('/auth/mock-login', (req, res) => {
  const { username, provider } = req.body;
  if (!username || !provider) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }
  const userId = 'user_' + Math.random().toString(36).substr(2, 9);
  res.json({
    success: true,
    user: {
      id: userId,
      name: username,
      provider: provider,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server executing tightly on port ${PORT}`);
});