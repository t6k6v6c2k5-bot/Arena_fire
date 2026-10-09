// Предпросмотр боя в обычном браузере: вместо сервера работает настоящий Room прямо на странице.
(function () {
  let mod = null;
  Promise.all([import('/__room.js'), import('/shared.js')]).then(([g, S]) => { mod = { Room: g.Room, S }; });
  window.io = function () {
    const h = {};
    let room = null, human = null, timer = 0;
    const serverSock = { emit: (ev, d) => setTimeout(() => h[ev] && h[ev](JSON.parse(JSON.stringify(d))), 0) };
    serverSock.volatile = serverSock;
    const sock = {
      connected: true,
      on: (ev, fn) => { h[ev] = fn; },
      emit: (ev, d, cb) => {
        if (ev === 'p') { cb && cb(); return; }
        if (ev === 'join') {
          room = new mod.Room(1, d.skill, { mode: d.gm });
          human = room.addHuman(serverSock, d.name || 'Гость', { loadout: d.loadout, tag: 'ГОСТЬ' });
          human.plat = d.touch ? 'm' : 'p';
          room.fillBots();
          for (const b of room.bots()) b.plat = Math.random() < 0.4 ? 'm' : 'p';
          serverSock.emit('welcome', room.welcome(human));
          timer = setInterval(() => room.tick(), 1000 / 30);
        } else if (ev === 'input' && human) room.queueInput(human, d);
      },
    };
    return sock;
  };
})();
