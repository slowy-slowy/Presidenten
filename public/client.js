const socket = io();

function join() {
  const name = document.getElementById('name').value;
  socket.emit('join', name);
}

socket.on('players', list => {
  document.getElementById('players').innerHTML = list.map(p => p.name + (p.handCount!==undefined ? ' ('+p.handCount+')' : '')).join('<br>');
});
socket.on('table', cards => {
  document.getElementById('table').innerText = 'Op tafel: ' + cards.join(', ');
});
socket.on('errorMsg', msg => alert(msg));
