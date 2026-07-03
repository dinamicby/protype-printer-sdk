/** Interval poller that never re-enters fn while a previous call is in flight. */
export function createPoller(fn: () => Promise<void>, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let interval = intervalMs;

  const tick = async () => {
    if (running) return; // предыдущий запрос ещё жив — пропускаем тик
    running = true;
    try {
      await fn();
    } finally {
      running = false;
    }
  };

  const arm = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, interval);
  };

  return {
    start() {
      void tick(); // немедленный первый тик
      arm();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    setInterval(ms: number) {
      interval = ms;
      if (timer) arm();
    },
  };
}
