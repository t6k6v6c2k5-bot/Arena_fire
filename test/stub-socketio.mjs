// Заглушка socket.io для проверки обвязки server.js.
export const state = { onConnection: null };
export class Server {
  constructor() {}
  on(ev, fn) { if (ev === 'connection') state.onConnection = fn; }
  close() {}
}
