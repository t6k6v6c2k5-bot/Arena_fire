export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'express') return { url: new URL('./stub-express.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier === 'socket.io') return { url: new URL('./stub-socketio.mjs', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
