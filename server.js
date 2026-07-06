const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  connectionStateRecovery: {
    maxDisconnectionDuration: 2100000, // 35 minutes
    skipMiddlewares: true,
  }
});

app.use(express.static('public'));

const PHRASES = [
  '"Are you kidding me?"',
  "Ask for cigarettes",
  "Asks if they're being detained",
  "Asks to speak to a supervisor",
  "Blames the victim",
  "Calling 911 on 911",
  "Calls lawyer",
  "Claims medical emergency",
  "Crocodile tears",
  "Cuffs too tight",
  "Deadweighting",
  "Denies everything on camera",
  '"Do you know who I am"',
  "Does not consent to arrest",
  "Fake faints",
  "Family member on the force",
  "Flirting",
  "Hides in bushes",
  '"I can\'t breathe" -white person',
  "Intoxicated",
  "Invokes the constitution",
  'Knows the law "better"',
  "Lady cop",
  "Misogyny card",
  "***** size speculation",
  "Pink guy from Law&Crime appears",
  "Pretending not to speak English",
  "Racism",
  "Removes handcuffs themselves",
  "Resist arrest",
  "Runs on foot",
  "Screams for bystanders to help",
  "Sly forgets to put video on screen",
  "Sovereign citizen",
  "Spits at officer",
  "This is abuse",
  "This is r*pe/SA",
  "Threatening to sue",
  "Threatens to call the news",
  "Tries to bribe officer",
];

let gameState = {
  calledPhrases: [],
  players: {}
};

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateCard() {
  const picked = shuffle(PHRASES).slice(0, 24);
  const card = [];
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    const r = [];
    for (let col = 0; col < 5; col++) {
      if (row === 2 && col === 2) {
        r.push({ phrase: '⭐ FREE', free: true, marked: true });
      } else {
        r.push({ phrase: picked[idx], free: false, marked: false });
        idx++;
      }
    }
    card.push(r);
  }
  return card;
}

function checkBingo(card) {
  for (let r = 0; r < 5; r++) {
    if (card[r].every(cell => cell.marked)) return true;
  }
  for (let c = 0; c < 5; c++) {
    if (card.every(row => row[c].marked)) return true;
  }
  if ([0,1,2,3,4].every(i => card[i][i].marked)) return true;
  if ([0,1,2,3,4].every(i => card[i][4-i].marked)) return true;
  return false;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.emit('gameState', {
    calledPhrases: gameState.calledPhrases,
    allPhrases: PHRASES
  });

  socket.on('joinGame', (name) => {
    const card = generateCard();
    gameState.players[socket.id] = { name, card, hasBingo: false };
    socket.emit('cardDealt', { card, calledPhrases: gameState.calledPhrases });
    io.emit('playerUpdate', buildPlayerList());
  });

  socket.on('requestHostData', () => {
    socket.emit('hostData', {
      calledPhrases: gameState.calledPhrases,
      players: buildPlayerList(),
      allPhrases: PHRASES
    });
  });

  socket.on('callPhrase', (phrase) => {
    if (!gameState.calledPhrases.includes(phrase)) {
      gameState.calledPhrases.push(phrase);
      io.emit('phraseCalled', {
        phrase,
        calledPhrases: gameState.calledPhrases
      });
      io.emit('playerUpdate', buildPlayerList());
    }
  });

  socket.on('markCell', (phrase) => {
    const player = gameState.players[socket.id];
    if (!player) return;
    if (!gameState.calledPhrases.includes(phrase)) return;

    for (const row of player.card) {
      for (const cell of row) {
        if (cell.phrase === phrase) {
          cell.marked = !cell.marked;
        }
      }
    }

    if (!player.hasBingo && checkBingo(player.card)) {
      player.hasBingo = true;
      io.emit('bingoAnnounce', { name: player.name });
    }

    io.emit('playerUpdate', buildPlayerList());
  });

  socket.on('resetGame', () => {
    gameState = { calledPhrases: [], players: {} };
    io.emit('gameReset');
    io.emit('playerUpdate', []);
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
    io.emit('playerUpdate', buildPlayerList());
    console.log('User disconnected:', socket.id);
  });
});

function buildPlayerList() {
  return Object.entries(gameState.players).map(([id, p]) => ({
    id,
    name: p.name,
    card: p.card,
    hasBingo: p.hasBingo
  }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bodycam Bingo server running on port ${PORT}`);
});
