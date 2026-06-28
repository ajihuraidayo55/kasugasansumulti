const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

const io = new Server(server, {
  maxHttpBufferSize: 5e7, 
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['polling', 'websocket']
});

const PORT = process.env.PORT || 10000;

// ------------------------------------------------------------
// 🛠️ PostgreSQL データベース接続設定
// ------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 🔄 エラーの元になるコメント文を完全に排除したテーブル作成処理
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50),
        user_name VARCHAR(50),
        user_provider VARCHAR(30),
        user_avatar TEXT,
        text TEXT,
        media_url TEXT,
        media_type VARCHAR(20),
        timestamp VARCHAR(20),
        loves TEXT DEFAULT '[]',
        favos TEXT DEFAULT '[]',
        shares TEXT DEFAULT '[]',
        is_share BOOLEAN DEFAULT FALSE,
        sharer_name VARCHAR(50) DEFAULT ''
      );
    `);
    console.log("SQL Database Tables initialized successfully!");
  } catch (err) {
    console.error("Error initializing database tables:", err);
  }
}
initDB();

const AVATARS = {
  google: 'https://api.dicebear.com/7.x/bottts/svg?seed=Google',
  apple: 'https://api.dicebear.com/7.x/bottts/svg?seed=Apple',
  microsoft: 'https://api.dicebear.com/7.x/bottts/svg?seed=Microsoft',
  clever: 'https://api.dicebear.com/7.x/bottts/svg?seed=Clever',
  github: 'https://api.dicebear.com/7.x/bottts/svg?seed=GitHub',
  hotmail: 'https://api.dicebear.com/7.x/bottts/svg?seed=Hotmail'
};

app.post('/auth/mock-login', (req, res) => {
  const { username, provider } = req.body;
  if (!username || !provider) return res.status(400).json({ success: false });

  const user = {
    id: 'user_' + Math.random().toString(36).substr(2, 9),
    name: username,
    provider: provider,
    avatar: AVATARS[provider] || 'https://api.dicebear.com/7.x/bottts/svg?seed=Unknown'
  };
  res.json({ success: true, user });
});

io.on('connection', (socket) => {
  let activeUser = null;

  socket.on('user-join-sns', async (user) => {
    activeUser = user;
    try {
      const result = await pool.query('SELECT * FROM posts');
      const formattedPosts = result.rows.map(row => ({
        id: row.id,
        user: { id: row.user_id, name: row.user_name, provider: row.user_provider, avatar: row.user_avatar },
        text: row.text,
        mediaUrl: row.media_url,
        mediaType: row.media_type,
        timestamp: row.timestamp,
        loves: JSON.parse(row.loves || '[]'),
        favos: JSON.parse(row.favos || '[]'),
        shares: JSON.parse(row.shares || '[]'),
        isShare: row.is_share,
        sharerName: row.sharer_name
      }));
      socket.emit('load-timeline', formattedPosts);
    } catch (err) {
      console.error(err);
    }
    io.emit('system-message', `${user.name} が参加しました。`);
  });

  socket.on('update-profile', async (updatedUser) => {
    if (!activeUser) return;
    activeUser.avatar = updatedUser.avatar;
    try {
      await pool.query('UPDATE posts SET user_avatar = $1 WHERE user_id = $2', [activeUser.avatar, activeUser.id]);
      const result = await pool.query('SELECT * FROM posts');
      const formattedPosts = result.rows.map(row => ({
        id: row.id, text: row.text, mediaUrl: row.media_url, mediaType: row.media_type, timestamp: row.timestamp,
        user: { id: row.user_id, name: row.user_name, provider: row.user_provider, avatar: row.user_avatar },
        loves: JSON.parse(row.loves || '[]'), favos: JSON.parse(row.favos || '[]'), shares: JSON.parse(row.shares || '[]'), isShare: row.is_share, sharerName: row.sharer_name
      }));
      io.emit('load-timeline', formattedPosts);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('new-post', async (postData) => {
    if (!activeUser) return;
    const newPost = {
      id: 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      user: { ...activeUser },
      text: postData.text,
      mediaUrl: postData.mediaUrl,
      mediaType: postData.mediaType,
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      loves: [],
      favos: [],
      shares: []
    };
    try {
      await pool.query(
        `INSERT INTO posts (id, user_id, user_name, user_provider, user_avatar, text, media_url, media_type, timestamp, loves, favos, shares) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newPost.id, newPost.user.id, newPost.user.name, newPost.user.provider, newPost.user.avatar,
          newPost.text, newPost.mediaUrl, newPost.mediaType, newPost.timestamp,
          JSON.stringify(newPost.loves), JSON.stringify(newPost.favos), JSON.stringify(newPost.shares)
        ]
      );
      io.emit('broadcast-post', newPost);
    } catch (err) {
      console.error("SQL Insert Error:", err);
    }
  });

  socket.on('share-post', async (postId) => {
    if (!activeUser) return;
    try {
      const selectResult = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
      if (selectResult.rows.length === 0) return;
      const row = selectResult.rows[0];
      let shares = JSON.parse(row.shares || '[]');
      if (shares.includes(activeUser.id)) return;
      shares.push(activeUser.id);
      await pool.query('UPDATE posts SET shares = $1 WHERE id = $2', [JSON.stringify(shares), postId]);

      const shareId = 'share_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const timestamp = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      await pool.query(
        `INSERT INTO posts (id, user_id, user_name, user_provider, user_avatar, text, media_url, media_type, timestamp, loves, favos, shares, is_share, sharer_name) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          shareId, row.user_id, row.user_name, row.user_provider, row.user_avatar,
          row.text, row.media_url, row.media_type, timestamp,
          row.loves, row.favos, JSON.stringify([]), true, activeUser.name
        ]
      );

      const refreshResult = await pool.query('SELECT * FROM posts');
      const formattedPosts = refreshResult.rows.map(r => ({
        id: r.id, text: r.text, mediaUrl: r.media_url, mediaType: r.media_type, timestamp: r.timestamp,
        user: { id: r.user_id, name: r.user_name, provider: r.user_provider, avatar: r.user_avatar },
        loves: JSON.parse(r.loves || '[]'), favos: JSON.parse(r.favos || '[]'), shares: JSON.parse(r.shares || '[]'), isShare: r.is_share, sharerName: r.sharer_name
      }));
      io.emit('load-timeline', formattedPosts);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('toggle-love', async (postId) => {
    if (!activeUser) return;
    try {
      const res = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        let loves = JSON.parse(row.loves || '[]');
        const index = loves.indexOf(activeUser.id);
        index === -1 ? loves.push(activeUser.id) : loves.splice(index, 1);
        await pool.query('UPDATE posts SET loves = $1 WHERE id = $2', [JSON.stringify(loves), postId]);
        const updatedPost = {
          id: row.id, text: row.text, mediaUrl: row.media_url, mediaType: row.media_type, timestamp: row.timestamp,
          user: { id: row.user_id, name: row.user_name, provider: row.user_provider, avatar: row.user_avatar },
          loves: loves, favos: JSON.parse(row.favos || '[]'), shares: JSON.parse(row.shares || '[]'), isShare: row.is_share, sharerName: row.sharer_name
        };
        io.emit('update-post-status', updatedPost);
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('toggle-favo', async (postId) => {
    if (!activeUser) return;
    try {
      const res = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        let favos = JSON.parse(row.favos || '[]');
        const index = favos.indexOf(activeUser.id);
        index === -1 ? favos.push(activeUser.id) : favos.splice(index, 1);
        await pool.query('UPDATE posts SET favos = $1 WHERE id = $2', [JSON.stringify(favos), postId]);
        const updatedPost = {
          id: row.id, text: row.text, mediaUrl: row.media_url, mediaType: row.media_type, timestamp: row.timestamp,
          user: { id: row.user_id, name: row.user_name, provider: row.user_provider, avatar: row.user_avatar },
          loves: JSON.parse(row.loves || '[]'), favos: favos, shares: JSON.parse(row.shares || '[]'), isShare: row.is_share, sharerName: row.sharer_name
        };
        io.emit('update-post-status', updatedPost);
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('request-timeline-refresh', async () => {
    const result = await pool.query('SELECT * FROM posts');
    const formattedPosts = result.rows.map(row => ({
      id: row.id, text: row.text, mediaUrl: row.media_url, mediaType: row.media_type, timestamp: row.timestamp,
      user: { id: row.user_id, name: row.user_name, provider: row.user_provider, avatar: row.user_avatar },
      loves: JSON.parse(row.loves || '[]'), favos: JSON.parse(row.favos || '[]'), shares: JSON.parse(row.shares || '[]'), isShare: row.is_share, sharerName: row.sharer_name
    }));
    socket.emit('load-timeline', formattedPosts);
  });

  socket.on('disconnect', () => {
    if (activeUser) io.emit('system-message', `${activeUser.name} が退室しました。`);
  });
});

server.listen(PORT, () => console.log(`SNS Server running on port ${PORT}`));
