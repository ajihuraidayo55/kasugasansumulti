const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
// Base64の重い画像データを受け取れるように制限を拡張
app.use(express.json({ limit: '10mb' })); 

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

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      username TEXT,
      provider TEXT,
      avatar TEXT,
      text TEXT,
      image TEXT, 
      timestamp TEXT,
      loves TEXT[] DEFAULT '{}',
      favos TEXT[] DEFAULT '{}'
    )
  `);
}
initDB().catch(console.error);

io.on('connection', (socket) => {
  let activeUser = null;

  socket.on('user-join-sns', async (user) => {
    activeUser = user;
    try {
      const res = await pool.query('SELECT * FROM posts ORDER BY timestamp ASC');
      // ⚠️ 修正ポイント: row.username や row.avatar を正しくオブジェクトにマッピング
      const posts = res.rows.map(row => ({
        id: row.id,
        user: { name: row.username, provider: row.provider, avatar: row.avatar },
        text: row.text,
        image: row.image, 
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
      await pool.query(
        `INSERT INTO posts (id, username, provider, avatar, text, image, timestamp, loves, favos) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [newPost.id, newPost.user.name, newPost.user.provider, newPost.user.avatar, newPost.text, newPost.image, newPost.timestamp, [], []]
      );
      io.emit('broadcast-post', newPost);
    } catch (err) {
      console.error(err);
    }
  });

  // --- いいね等の処理（ここは変更なし） ---
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
          user: { name: row.username, provider: row.provider, avatar: row.avatar },
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
