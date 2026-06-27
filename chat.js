module.exports = function initChat(io, socket, state) {
  
  // ユーザーが認証をパスしてSNS画面に入室した時
  socket.on('user-join-sns', (user) => {
    state.users[socket.id] = user;
    
    // ログインした本人に、これまでの全タイムライン過去ログを即座に送信
    socket.emit('load-timeline', state.posts);
    
    // ログインしたことを全員にシステム通知
    io.emit('system-message', `✨ ${user.name} さんがオンラインになりました (${user.provider.toUpperCase()}ログイン)`);
  });

  // 新しいメッセージがタイムラインに投稿された時
  socket.on('new-post', (text) => {
    const user = state.users[socket.id];
    if (!user || !text.trim()) return;

    const newPost = {
      id: `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      user: user,
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      loves: [], // いいねしたユーザーIDのリスト
      favos: []  // お気に入りしたユーザーIDのリスト
    };

    state.posts.push(newPost);
    
    // メモリ保護のため最新最大100件まで保持
    if (state.posts.length > 100) state.posts.shift();

    // 接続している全員の画面に、新しい投稿をリアルタイムで強制プッシュ
    io.emit('broadcast-post', newPost);
  });
};