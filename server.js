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
  players: {},
  currentWinCondition: 'singleLine',
  winHistory: [] 
};

const disconnectTimers = {}; // playerId -> setTimeout reference
const GRACE_PERIOD = 2100000; // 35 minutes

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

function hasAnyLine(card) {
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

function hasXPattern(card) {
  const diag1 = [0,1,2,3,4].every(i => card[i][i].marked);
  const diag2 = [0,1,2,3,4].every(i => card[i][4-i].marked);
  return diag1 && diag2;
}

function hasFourCorners(card) {
  return card[0][0].marked && card[0][4].marked &&
         card[4][0].marked && card[4][4].marked;
}

function hasBlackout(card) {
  return card.every(row => row.every(cell => cell.marked));
}

function checkBingo(card) {
  switch (gameState.currentWinCondition) {
    case 'xPattern':    return hasXPattern(card);
    case 'fourCorners': return hasFourCorners(card);
    case 'blackout':    return hasBlackout(card);
    case 'singleLine':
    default:             return hasAnyLine(card);
  }
}

function registerWinConditionHandler(socket) {
  socket.on('setWinCondition', (condition) => {
    gameState.currentWinCondition = condition;

    // Reset everyone's bingo flag so they can win again under the new pattern
    Object.values(gameState.players).forEach(player => {
      player.hasBingo = false;
    });

    io.emit('winConditionChanged', condition);
    io.emit('playerUpdate', buildPlayerList()); // clears old trophy icons on host view
    console.log('Host changed win condition to:', condition);
  });
}

io.on('connection', (socket) => {
  registerWinConditionHandler(socket);

  console.log('User connected:', socket.id);

 socket.emit('gameState', {
  calledPhrases: gameState.calledPhrases,
  allPhrases: PHRASES,
  currentWinCondition: gameState.currentWinCondition // 
});

socket.on('requestHostData', () => {
  socket.emit('hostData', {
    calledPhrases: gameState.calledPhrases,
    allPhrases: PHRASES,
    players: buildPlayerList(),
    currentWinCondition: 
gameState.currentWinCondition,
    winHistory: gameState.winHistory
  });
});

socket.on('joinGame', ({ playerId, name }) => {
    // Cancel pending removal if this player is reconnecting
    if (disconnectTimers[playerId]) {
      clearTimeout(disconnectTimers[playerId]);
      delete disconnectTimers[playerId];
    }

    socket.playerId = playerId;

    if (gameState.players[playerId]) {
      // Returning player — restore their existing card/progress
      gameState.players[playerId].socketId = socket.id;
      gameState.players[playerId].connected = true;
      socket.emit('cardDealt', {
        card: gameState.players[playerId].card,
        calledPhrases: gameState.calledPhrases
      });
    } else {
      // Brand new player
      const card = generateCard();
      gameState.players[playerId] = {
        name,
        card,
        hasBingo: false,
        socketId: socket.id,
        connected: true
      };
      socket.emit('cardDealt', { card, calledPhrases: gameState.calledPhrases });
    }

    io.emit('playerUpdate', buildPlayerList());
  });

  socket.on('playerReaction', (data) => {
    io.emit('reactionBroadcast', data);
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
    const player = gameState.players[socket.playerId];
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

  const winEntry = {
    name: player.name,
    pattern: gameState.currentWinCondition,
    timestamp: Date.now()
  };
  gameState.winHistory.push(winEntry);

  io.emit('bingoAnnounce', {
    name: player.name,
    pattern: gameState.currentWinCondition 
  });
  io.emit('winHistoryUpdate', gameState.winHistory); 
}


    io.emit('playerUpdate', buildPlayerList());
  });

socket.on('resetGame', () => {
  Object.values(disconnectTimers).forEach(clearTimeout);
  for (const key in disconnectTimers) delete disconnectTimers[key];

  gameState = {
    calledPhrases: [],
    players: {},
    currentWinCondition: 'singleLine',
    winHistory: [] // 
  };
  io.emit('gameReset');
  io.emit('playerUpdate', []);
});

socket.on('resetGame', () => {
  if (!socket.isHost) return;
  Object.values(disconnectTimers).forEach(clearTimeout);
  for (const key in disconnectTimers) delete disconnectTimers[key];

  gameState = {
    calledPhrases: [],
    players: Object.create(null),
    currentWinCondition: 'singleLine',
    winHistory: []
  };
  io.emit('gameReset');
  io.emit('playerUpdate', []);
});

socket.on('removePlayer', (playerId) => {
  if (!socket.isHost) return;
  if (!isValidPlayerId(playerId)) return;

  const player = gameState.players[playerId];
  if (!player) return;

  // Cancel any pending grace-period timer for this player
  if (disconnectTimers[playerId]) {
    clearTimeout(disconnectTimers[playerId]);
    delete disconnectTimers[playerId];
  }

  // Notify that specific player's browser (if still connected) so they see feedback
  if (player.socketId) {
    io.to(player.socketId).emit('youWereRemoved');
  }

  delete gameState.players[playerId];
  io.emit('playerUpdate', buildPlayerList());
  console.log('Host removed player:', playerId);
});

  socket.on('disconnect', () => {
    const playerId = socket.playerId;
    if (!playerId || !gameState.players[playerId]) return;

    gameState.players[playerId].connected = false;

    // Grace period before actually removing the player
    disconnectTimers[playerId] = setTimeout(() => {
      delete gameState.players[playerId];
      delete disconnectTimers[playerId];
      io.emit('playerUpdate', buildPlayerList());
    }, GRACE_PERIOD);

    io.emit('playerUpdate', buildPlayerList());
    console.log('User disconnected:', socket.id, '- grace period started for', playerId);
  });
});

function buildPlayerList() {
  return Object.entries(gameState.players).map(([id, p]) => ({
    id,
    name: p.name,
    card: p.card,
    hasBingo: p.hasBingo,
    connected: p.connected
  }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bodycam Bingo server running on port ${PORT}`);
});
