const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let players = [];
let currentTurn = 0;
let table = [];
let lastPlay = null;

io.on('connection', socket => {
  socket.on('join', name => {
    players.push({ id: socket.id, name, hand: [] });
    io.emit('players', players.map(p => ({ name: p.name })));
  });

  socket.on('play', cards => {
    const player = players.find(p => p.id === socket.id);
    if (!player) return;
    // Basic set validation with 2 as joker
    if (!validSet(cards)) {
      socket.emit('errorMsg', 'Ongeldige set.');
      return;
    }
    const rVal = setEffectiveRankVal(cards);
    if (lastPlay && (cards.length !== lastPlay.length || rVal <= lastPlay.rank)) {
      socket.emit('errorMsg', 'Moet zelfde aantal en hoger zijn.');
      return;
    }
    player.hand = player.hand.filter(c => !cards.includes(c));
    lastPlay = { rank: rVal, length: cards.length };
    table = cards;
    io.emit('table', table);
    io.emit('players', players.map(p => ({ name: p.name, handCount: p.hand.length })));
  });
});

function isTwo(card) { return card.slice(0, -1) === '2'; }
function validSet(cards) {
  if (cards.length === 0) return false;
  const others = cards.filter(c => !isTwo(c)).map(c => c.slice(0, -1));
  if (others.length === 0) return true;
  return others.every(r => r === others[0]);
}
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const RANK_VAL = Object.fromEntries(RANKS.map((r,i) => [r,i]));
function setEffectiveRankVal(cards) {
  const others = cards.filter(c => !isTwo(c)).map(c => c.slice(0, -1));
  if (others.length === 0) return RANK_VAL['2'];
  return RANK_VAL[others[0]];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));

