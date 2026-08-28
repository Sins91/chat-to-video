export const deferred = <T>() => {
  let resolve: (value: T) => void = () => { throw new Error("Promise is not initialized"); };
  let reject: (reason?: unknown) => void = () => { throw new Error("Promise is not initialized"); };
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};
