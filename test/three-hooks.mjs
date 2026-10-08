// Loader-хук: подменяет 'three' на заглушку для дымового теста.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: new URL('./stub-three.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
