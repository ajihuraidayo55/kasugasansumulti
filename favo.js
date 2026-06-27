module.exports = function initFavo(io, socket, state) {
  
  socket.on('toggle-favo', (postId) => {
    const user = state.users[socket.id];
    if (!user) return;

    const post = state.posts.find(p => p.id === postId);
    if (!post) return;

    const favoIndex = post.favos.indexOf(user.id);

    if (favoIndex === -1) {
      post.favos.push(user.id); // お気に入り登録
    } else {
      post.favos.splice(favoIndex, 1); // お気に入り解除
    }

    // 更新された投稿状態を全員の画面に即座に同期
    io.emit('update-post-status', post);
  });
};