export function NotImplemented(wave) {
  const err = new Error(`NotImplemented('${wave}')`);
  err.name = 'NotImplemented';
  err.wave = wave;
  return err;
}

export function pushBatch(_records) {
  throw NotImplemented('wave-2');
}
