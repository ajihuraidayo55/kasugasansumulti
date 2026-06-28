const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Base64画像を受け取れるように拡張

app.head('/', (req, res) => res.status(200).end());
app.get('/', (req, res) => res.send('SNS Server is running!'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🔎 データベースの実際の列名を自動で突き止めるための変数
let detectedColumns = {
  username: 'username',
  avatar: 'avatar',
  provider: 'provider'
};

async function initDB() {
  // 1. 画像用の image カラムがなければ安全に追加
  try {
    await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS image TEXT;`);
  } catch (err) {
    console.log("Image column notice:", err.message);
  }

  // 2. 既存のテーブルの実際の列名を自動解析する
  try {
    const res = await pool.query('SELECT * FROM posts LIMIT 1');
    if (res.rows.length > 0) {
      const row = res.rows[0];
      const keys = Object.keys(row);
      
      // ユーザー名カラムの自動判別
      if (keys.includes('user_name')) detectedColumns.username = 'user_name';
      else if (keys.includes('username')) detectedColumns.username = 'username';
      else if (keys.includes('name')) detectedColumns.username = 'name';

      // アバターカラムの自動判別
      if (keys.includes('user_avatar')) detectedColumns.avatar = 'user_avatar';
      else if (keys.includes('avatar_url')) detectedColumns.avatar = 'avatar_url';
      else if (keys.includes('avatar')) detectedColumns.avatar = 'avatar';

      // プロバイダー（ログイン方法）カラムの自動判別
      if (keys.includes('provider')) detectedColumns.provider = 'provider';
      else if (keys.includes('user_provider')) detectedColumns.provider = 'user_provider';
      else if (keys.includes('login_method')) detectedColumns.provider = 'login_method';
      
      console.log("元の正しい列名を自動検出しました:", detectedColumns);
    }
  } catch (err) {
    console.error("列名の解析に失敗しました。デフォルトを使用します:", err.message);
  }
}
initDB().catch(console.error);

io.on('connection', (socket) => {
  let activeUser = null;

  socket.on('user-join-sns', async (user) => {
    activeUser = user;
    try {
      const res = await pool.query('SELECT * FROM posts ORDER BY timestamp ASC');
      
      // 自動検出した元の列名を使って、世界中のみんなのデータを100%正確に復元
      const posts = res.rows.map(row => ({
        id: row.id,
        user: { 
          name: row[detectedColumns.username] || 'Unknown', 
          provider: row[detectedColumns.provider] || 'Google', // 元の正しいログイン方法
          avatar: row[detectedColumns.avatar] || 'https://api.dicebear.com/7.x/bottts/svg?seed=default'
        },
        text: row.text,
        image: row.image || null,
        timestamp: row.timestamp,
        loves: row.loves || [],
        favos: row.favos || []
      }));
      socket.emit('load-timeline', posts);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('new-post', async (data) => {
    if (!activeUser) return;

    const postText = typeof data === 'string' ? data : (data.text || '');
    const postImage = typeof data === 'object' ? (data.image || null) : null;

    const newPost = {
      id: 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      user: activeUser,
      text: postText,
      image: postImage,
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      loves: [],
      favos: []
    };

    try {
      // ⚠️ 自動検出された正しい列名に合わせて、動的にSQL文を組み立てて確実に保存（エラー回避）
      const queryText = `
        INSERT INTO posts (id, ${detectedColumns.username}, ${detectedColumns.provider}, ${detectedColumns.avatar}, text, image, timestamp, loves, favos) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      
      await pool.query(queryText, [
        newPost.id, 
        newPost.user.name, 
        newPost.user.provider, 
        newPost.user.avatar, 
        newPost.text, 
        newPost.image, 
        newPost.timestamp, 
        [], 
        []
      ]);
      
      io.emit('broadcast-post', newPost);
    } catch (err) {
      console.error("投稿エラーが発生しました:", err);
    }
  });

  // --- リアクション処理（自動判別の列名に対応） ---
  socket.on('toggle-love', async (postId) => {
    if (!activeUser) return;
    try {
      const res = await pool.query('SELECT loves FROM posts WHERE id = $1', [postId]);
      if (res.rows.length === 0) return;
      let loves = res.rows[0].loves || [];
      if (loves.includes(activeUser.id)) { loves = loves.filter(id => id !== activeUser.id); } else { loves.push(activeUser.id); }
      await pool.query('UPDATE posts SET loves = $1 WHERE id = $2', [loves, postId]);
      updatePostStatus(postId);
    } catch (err) { console.error(err); }
  });

  socket.on('toggle-favo', async (postId) => {
    if (!activeUser) return;
    try {
      const res = await pool.query('SELECT favos FROM posts WHERE id = $1', [postId]);
      if (res.rows.length === 0) return;
      let favos = res.rows[0].favos || [];
      if (favos.includes(activeUser.id)) { favos = favos.filter(id => id !== activeUser.id); } else { favos.push(activeUser.id); }
      await pool.query('UPDATE posts SET favos = $1 WHERE id = $2', [favos, postId]);
      updatePostStatus(postId);
    } catch (err) { console.error(err); }
  });

  async function updatePostStatus(postId) {
    try {
      const res = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        const updatedPost = {
          id: row.id,
          user: { 
            name: row[detectedColumns.username] || 'Unknown', 
            provider: row[detectedColumns.provider] || 'Google', 
            avatar: row[detectedColumns.avatar] || 'https://api.dicebear.com/7.x/bottts/svg?seed=default'
          },
          text: row.text,
          image: row.image,
          timestamp: row.timestamp,
          loves: row.loves || [],
          favos: row.favos || []
        };
        io.emit('update-post-status', updatedPost);
      }
    } catch (err) { console.error(err); }
  }

  socket.on('disconnect', () => {
    if (activeUser) io.emit('system-message', `${activeUser.name} が切断しました`);
  });
});

app.post('/auth/mock-login', (req, res) => {
  const { username, provider } = req.body;
  if (!username || !provider) return res.status(400).json({ success: false });
  const userId = 'user_' + Math.random().toString(36).substr(2, 9);
  res.json({
    success: true,
    user: { id: userId, name: username, provider: provider, avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}` }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running with auto-detection on port ${PORT}`));
