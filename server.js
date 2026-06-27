const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 学パソのプロキシ・ファイアウォールを回避する通信設定
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['polling', 'websocket']
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// メモリ上で一時的に全体データを保持するストア（Render再起動でリセットされます）
const globalState = {
  users: {}, // socket.id -> ログイン中のユーザー情報
  posts: []  // 投稿データ配列
};

// 指定された各外部機能モジュールの読み込み
const loginRouter = require('./login');
const initChat = require('./chat');
const initLove = require('./love');
const initFavo = require('./favo');

// ログインAPIルーターの適用
app.use('/auth', loginRouter);

// Socket.ioによるリアルタイム通信のルーティング
io.on('connection', (socket) => {
  console.log(`ユーザーが接続しました: ${socket.id}`);

  // 各モジュールにコントロール権限を分散・初期化
  initChat(io, socket, globalState);
  initLove(io, socket, globalState);
  initFavo(io, socket, globalState);

  // 切断時のクリーンアップ
  socket.on('disconnect', () => {
    const user = globalState.users[socket.id];
    if (user) {
      io.emit('system-message', `${user.name}さんが退室しました。`);
      delete globalState.users[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SNS Server running on port ${PORT}`));