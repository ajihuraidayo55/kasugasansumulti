const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Base64画像のための容量拡張

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

// 🛠️ テーブル構造を壊さず、画像列（image）がなければ追加するだけ
async function initDB() {
  try {
    await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS image TEXT;`);
  } catch (err) {
    console.log("Image column sync notice:", err.message);
  }
}
initDB().catch(console.error);

io.on('connection', (socket) => {
  let activeUser = null;

  socket.on('user-join-sns', async (user) => {
    activeUser = user;
    try {
      const res = await pool.query('SELECT * FROM posts ORDER BY timestamp ASC');
      
      // タイムライン取得（あなたの元のカラム名 username, avatar をそのまま使用）
      const posts = res.rows.map(row => ({
        id: row.id,
        user: { 
          name: row.username || 'Unknown', 
          provider: row.provider || 'web', 
          avatar: row.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=default'
        },
        text: row.text,
        image: row.image || null, // 追加した画像データ
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
      // ⚠️ 修正：あなたの元の正しいカラム名（username, avatar）でインサートする
      await pool.query(
        `INSERT INTO posts (id, username, provider, avatar, text, image, timestamp, loves, favos) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newPost.id, 
          newPost.user.name, // ログインしたユーザーの名前を username 列に保存
          newPost.user.provider, 
          newPost.user.avatar, // アバターURLを avatar 列に保存
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

  // --- リアクション処理（元のカラム構造のまま動く完全版） ---
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
            name: row.username || 'Unknown', 
            provider: row.provider || 'web', 
            avatar: row.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=default'
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
