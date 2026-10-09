// Заглушка socket.io для проверки обвязки server.js.
export const state = { onConnection: null, engine: { clientsCount: 0 }, rooms: {} };
export class Server {
  constructor() { this.engine = state.engine; }
  on(ev, fn) { if (ev === 'connection') state.onConnection = fn; }
  to(room) { return { emit: (ev, d) => { for (const s of state.rooms[room] || []) s.emit(ev, d); } }; }
  close() {}
}
