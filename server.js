const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['polling', 'websocket']
});

const PORT = process.env.PORT || 10000;
let timelinePosts = [];

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

  socket.on('user-join-sns', (user) => {
    activeUser = user;
    socket.emit('load-timeline', timelinePosts);
    io.emit('system-message', `${user.name} が参加しました。`);
  });

  // 📷 プロフィール画像更新の同期
  socket.on('update-profile', (updatedUser) => {
    if (!activeUser) return;
    activeUser.avatar = updatedUser.avatar;
    
    // 過去のこのユーザーの投稿のアバターも一斉更新
    timelinePosts.forEach(post => {
      if (post.user.id === activeUser.id) {
        post.user.avatar = activeUser.avatar;
      }
    });
    io.emit('load-timeline', timelinePosts);
  });

  // 💬 新規投稿（画像・動画データ対応）
  socket.on('new-post', (postData) => {
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
      shares: [] // 誰が拡散したかを記録する配列
    };

    timelinePosts.push(newPost);
    if (timelinePosts.length > 50) timelinePosts.shift();
    io.emit('broadcast-post', newPost);
  });

  // 🔄 拡散機能（リポスト）のロジック
  socket.on('share-post', (postId) => {
    if (!activeUser) return;
    const targetPost = timelinePosts.find(p => p.id === postId);
    
    if (targetPost) {
      if (!targetPost.shares) targetPost.shares = [];
      
      // 二重拡散を防ぐ
      if (targetPost.shares.includes(activeUser.id)) return;
      targetPost.shares.push(activeUser.id);

      // 拡散された投稿をタイムラインの最新に新しく生成して流す
      const sharedPost = {
        ...targetPost,
        id: 'share_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        isShare: true,
        sharerName: activeUser.name,
        timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      };

      timelinePosts.push(sharedPost);
      if (timelinePosts.length > 50) timelinePosts.shift();
      io.emit('load-timeline', timelinePosts);
    }
  });

  // フォロー切り替え時の手動リフレッシュ要求
  socket.on('request-timeline-refresh', () => {
    socket.emit('load-timeline', timelinePosts);
  });

  socket.on('toggle-love', (postId) => {
    if (!activeUser) return;
    const post = timelinePosts.find(p => p.id === postId);
    if (post) {
      const index = post.loves.indexOf(activeUser.id);
      index === -1 ? post.loves.push(activeUser.id) : post.loves.splice(index, 1);
      io.emit('update-post-status', post);
    }
  });

  socket.on('toggle-favo', (postId) => {
    if (!activeUser) return;
    const post = timelinePosts.find(p => p.id === postId);
    if (post) {
      const index = post.favos.indexOf(activeUser.id);
      index === -1 ? post.favos.push(activeUser.id) : post.favos.splice(index, 1);
      io.emit('update-post-status', post);
    }
  });

  socket.on('disconnect', () => {
    if (activeUser) io.emit('system-message', `${activeUser.name} が退室しました。`);
  });
});

server.listen(PORT, () => console.log(`SNS Server running on port ${PORT}`));
