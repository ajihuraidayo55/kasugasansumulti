module.exports = function initLove(io, socket, state) {
  
  socket.on('toggle-love', (postId) => {
    const user = state.users[socket.id];
    if (!user) return;

    // 対象の投稿を検索
    const post = state.posts.find(p => p.id === postId);
    if (!post) return;

    const loveIndex = post.loves.indexOf(user.id);

    if (loveIndex === -1) {
      post.loves.push(user.id); // まだ押していなければいいねリストに追加
    } else {
      post.loves.splice(loveIndex, 1); // 既に押されていれば解除
    }

    // 更新された投稿状態（カウント数・色）を全員の画面に即座に同期
    io.emit('update-post-status', post);
  });
};