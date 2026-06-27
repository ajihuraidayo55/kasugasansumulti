const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 学パソの厳しいネットワーク制限（WebSocket遮断など）対策として polling も有効化
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['polling', 'websocket']
});

// public フォルダ内の HTML 等を自動で配信
app.use(express.static(path.join(__dirname, 'public')));

// 部屋のデータを保持するオブジェクト
const rooms = {};

// --- 算数問題自動生成関数 ---
function generateProblem(grade) {
  let num1, num2, question, answer;

  switch(parseInt(grade)) {
    case 1: // 1年生：繰り上がりのない足し算
      num1 = Math.floor(Math.random() * 8) + 1;
      num2 = Math.floor(Math.random() * (10 - num1)) + 1;
      question = `${num1} + ${num2} = ?`;
      answer = num1 + num2;
      break;
    case 2: // 2年生：九九
      num1 = Math.floor(Math.random() * 9) + 1;
      num2 = Math.floor(Math.random() * 9) + 1;
      question = `${num1} × ${num2} = ?`;
      answer = num1 * num2;
      break;
    case 3: // 3年生：割り算（あまりなし）
      num2 = Math.floor(Math.random() * 9) + 1;
      answer = Math.floor(Math.random() * 9) + 1;
      num1 = num2 * answer;
      question = `${num1} ÷ ${num2} = ?`;
      break;
    case 4: // 4年生：3桁×2桁
      num1 = Math.floor(Math.random() * 900) + 100;
      num2 = Math.floor(Math.random() * 90) + 10;
      question = `${num1} × ${num2} = ?`;
      answer = num1 * num2;
      break;
    case 5: // 5年生：小数の割り算
      answer = Math.floor(Math.random() * 9) + 1;
      num2 = (Math.floor(Math.random() * 9) + 1) / 10;
      num1 = Math.round(num2 * answer * 10) / 10;
      question = `${num1} ÷ ${num2} = ?`;
      break;
    case 6: // 6年生：比の計算 (Xを求める)
      const baseA = 4, baseB = 3;
      const mult = Math.floor(Math.random() * 5) + 2;
      num2 = baseB * mult;
      answer = baseA * mult;
      question = `X : ${num2} = ${baseA} : ${baseB} の X は？`;
      break;
    default:
      question = "1 + 1 = ?";
      answer = 2;
  }
  return { question, answer: String(answer) };
}

// --- Socket.io リアルタイム通信処理 ---
io.on('connection', (socket) => {

  // ホストが部屋を作成
  socket.on('create-room', (grade) => {
    const pin = Math.floor(1000 + Math.random() * 9000).toString(); // 4桁のPIN
    rooms[pin] = {
      hostId: socket.id,
      grade: grade,
      players: {}, // socket.id -> { name, score, answered }
      currentProblem: null,
      state: 'waiting'
    };
    socket.join(pin);
    socket.emit('room-created', pin);
  });

  // 生徒がPINで参加
  socket.on('join-room', ({ pin, name }) => {
    const room = rooms[pin];
    if (!room) return socket.emit('error-msg', '部屋が見つかりません');
    if (room.state !== 'waiting') return socket.emit('error-msg', 'すでにゲームが始まっています');
    
    // 30人制限の厳密なチェック
    if (Object.keys(room.players).length >= 30) {
      return socket.emit('error-msg', '部屋が満員です（最大30人）');
    }

    room.players[socket.id] = { name: name, score: 0, answered: false };
    socket.join(pin);

    // 参加者一覧をその部屋の全員（ホスト含む）に送信
    io.to(pin).emit('update-players', Object.values(room.players));
  });

  // ホストが問題を配信（開始、または次の問題）
  socket.on('next-question', (pin) => {
    const room = rooms[pin];
    if (!room || room.hostId !== socket.id) return;

    room.state = 'playing';
    room.currentProblem = generateProblem(room.grade);
    
    // 全員の解答フラグをリセット
    for (let id in room.players) {
      room.players[id].answered = false;
    }

    // 問題のみを全員に配信（答えは隠す）
    io.to(pin).emit('show-question', {
      question: room.currentProblem.question
    });
  });

  // 生徒が答えを送信
  socket.on('submit-answer', ({ pin, answer }) => {
    const room = rooms[pin];
    if (!room || !room.players[socket.id] || room.players[socket.id].answered) return;

    room.players[socket.id].answered = true;
    const isCorrect = String(answer).trim() === room.currentProblem.answer;

    if (isCorrect) {
      room.players[socket.id].score += 10; // 正解なら10点
    }

    // 判定結果を本人に通知
    socket.emit('answer-result', { isCorrect, correctAnswer: room.currentProblem.answer });

    // 部屋全体の暫定ランキングを計算して全員に同期
    const ranking = Object.values(room.players).sort((a, b) => b.score - a.score);
    io.to(pin).emit('update-ranking', ranking);
  });

  // 切断時の処理
  socket.on('disconnect', () => {
    for (let pin in rooms) {
      if (rooms[pin].hostId === socket.id) {
        io.to(pin).emit('error-msg', 'ホストが切断したため部屋を解散しました');
        delete rooms[pin];
      } else if (rooms[pin].players[socket.id]) {
        delete rooms[pin].players[socket.id];
        io.to(pin).emit('update-players', Object.values(rooms[pin].players));
        const ranking = Object.values(rooms[pin].players).sort((a, b) => b.score - a.score);
        io.to(pin).emit('update-ranking', ranking);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));