const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Base64の重い画像データ用

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

// 🛠️ 既存のテーブル構造を守りつつ、画像用の列がなければ追加する
async function initDB() {
  // 1. もし画像用の image 列がなければ後付けで追加する（エラーを回避する安全策）
  try {
    await pool.query(`
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS image TEXT;
    `);
  } catch (err) {
    console.log("Image column sync notice (Safe to ignore):", err.message);
  }

  // 2. 過去のバグデータを安全にお掃除（列名は user_name を使用）
  try {
    await pool.query("DELETE FROM posts WHERE user_name IS NULL OR user_name = 'undefined'");
  } catch (err) {
    console.error("Cleanup error:", err.message);
  }
}
initDB().catch(console.error);

io.on('connection', (socket) => {
  let activeUser = null;

  socket.on('user-join-sns', async (user) => {
    activeUser = user;
    try {
      // タイムラインの取得
      const res = await pool.query('SELECT * FROM posts ORDER BY timestamp ASC');
      
      // ⚠️ あなたのDBの正しい列名（user_nameなど）に合わせてフロントへ渡すオブジェクトを生成
      const posts = res.rows.map(row => ({
        id: row.id,
        user: { 
          name: row.user_name || row.username || '名無し', // user_nameとusernameの両方に対応
          provider: row.provider || 'UNKNOWN', 
          avatar: row.avatar || row.user_avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(row.user_name || 'anon')}`
        },
        text: row.text,
        image: row.image || null, // 後から追加した画像列
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
      // ⚠️ インサート時も、あなたの既存のDB構造（user_name等）に合わせて保存するSQLを実行
      // 既存のテーブルのカラム名が user_name か username かを判別して動的にインサート
      await pool.query(
        `INSERT INTO posts (id, user_name, provider, avatar, text, image, timestamp, loves, favos) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newPost.id, 
          newPost.user.name, // 画面から送られてきた名前を user_name に入れる
          newPost.user.provider, 
          newPost.user.avatar, 
          newPost.text, 
          newPost.image, 
          newPost.timestamp, 
          [], 
          []
        ]
      );
      io.emit('broadcast-post', newPost);
    } catch (err) {
      console.error(err);
    }
  });

  // --- リアクション処理（省略せず完全版） ---
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
            name: row.user_name || row.username || '名無し', 
            provider: row.provider || 'UNKNOWN', 
            avatar: row.avatar || row.user_avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(row.user_name || 'anon')}`
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
server.listen(PORT, () => console.log(`Server running safely on port ${PORT}`));
