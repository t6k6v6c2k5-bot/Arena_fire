// Заглушка express для проверки обвязки server.js.
export const routes = {};
function express() {
  return {
    disable() {},
    get(path, fn) { routes[path] = fn; },
    use() {},
  };
}
express.static = () => () => {};
export default express;
