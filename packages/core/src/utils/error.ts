export function errorWithOriginalStack(error: Error, fn: Function) {
  const err = new Error(error.message);
  Error.captureStackTrace(err, fn);
  err.stack = error.stack;
  throw err;
}
