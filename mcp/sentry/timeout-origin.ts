/**
 * An `AbortSignal.timeout` abort reason is created in a Node timer, so its
 * stack names no caller, and an unhandled one says nothing about who set the
 * timer. After this runs, each timeout signal records where it was created and
 * attaches that as the reason's `cause`, which Sentry reports as a linked error
 * with its own stack.
 */
export const recordTimeoutOrigins = (): void => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);

  AbortSignal.timeout = (ms: number): AbortSignal => {
    const signal = timeout(ms);
    const origin = new Error(`AbortSignal.timeout(${ms}) was created here`);

    signal.addEventListener(
      'abort',
      () => {
        if (signal.reason instanceof DOMException) {
          Object.defineProperty(signal.reason, 'cause', {
            value: origin,
            configurable: true,
          });
        }
      },
      { once: true },
    );

    return signal;
  };
};
