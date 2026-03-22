/**
 * Typing 指示器控制器
 *
 * 学习 OpenClaw 框架的 3 层架构：
 *   1. StartGuard  — 熔断器，连续失败 N 次停止重试
 *   2. KeepaliveLoop — 定时续发 typing（微信 ~10s 自动取消）
 *   3. TypingController — 组合上述两层 + TTL 安全阀
 *
 * 参考:
 *   OpenClaw/src/channels/typing-start-guard.ts
 *   OpenClaw/src/channels/typing-lifecycle.ts
 *   OpenClaw/src/channels/typing.ts
 *
 * 用法:
 *   const ctrl = createTypingController({ start, stop, onError });
 *   await ctrl.onReplyStart();  // 收到消息，准备调 Agent 前
 *   const reply = await callAgent();
 *   ctrl.onIdle();              // Agent 完成，发消息前
 */

// ═══════════════════════════════════════════════════════════
// 层 1: StartGuard — 熔断器
// 参考: OpenClaw/src/channels/typing-start-guard.ts
// ═══════════════════════════════════════════════════════════

/**
 * 连续失败 maxFailures 次后熔断（tripped），停止重试。
 * 错误不对外 throw，只回调 onError → 不影响主流程。
 */
function createStartGuard({ onError, maxFailures = 2 } = {}) {
  let consecutiveFailures = 0;
  let tripped = false;

  return {
    async run(fn) {
      if (tripped) return "skipped";
      try {
        await fn();
        consecutiveFailures = 0;
        return "started";
      } catch (err) {
        consecutiveFailures += 1;
        onError?.(err);
        if (consecutiveFailures >= maxFailures) {
          tripped = true;
          return "tripped";
        }
        return "failed";
      }
    },
    reset() {
      consecutiveFailures = 0;
      tripped = false;
    },
    isTripped() {
      return tripped;
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 层 2: KeepaliveLoop — 心跳循环
// 参考: OpenClaw/src/channels/typing-lifecycle.ts
// ═══════════════════════════════════════════════════════════

/**
 * 每 intervalMs 毫秒执行一次 onTick。
 * tickInFlight 锁防止重入（上一次未完成不发新请求）。
 */
function createKeepaliveLoop({ intervalMs, onTick }) {
  let timer = undefined;
  let tickInFlight = false;

  const tick = async () => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      await onTick();
    } finally {
      tickInFlight = false;
    }
  };

  return {
    start() {
      if (intervalMs <= 0 || timer) return;
      timer = setInterval(() => { void tick(); }, intervalMs);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
      tickInFlight = false;
    },
    isRunning() {
      return timer !== undefined;
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 层 3: TypingController — 对外接口
// 参考: OpenClaw/src/channels/typing.ts
// ═══════════════════════════════════════════════════════════

/**
 * 创建 typing 控制器。
 *
 * @param {Object} params
 * @param {() => Promise<void>} params.start   — 发 sendTyping(TYPING)
 * @param {() => Promise<void>} [params.stop]  — 发 sendTyping(CANCEL)
 * @param {(err: Error) => void} params.onError — 错误回调（不影响主流程）
 * @param {number} [params.keepaliveMs=5000]   — 心跳间隔
 * @param {number} [params.maxDurationMs=60000] — TTL 安全阀
 * @param {number} [params.maxFailures=2]       — 熔断阈值
 * @returns {{ onReplyStart: () => Promise<void>, onIdle: () => void, onCleanup: () => void }}
 */
export function createTypingController({
  start,
  stop,
  onError,
  keepaliveMs = 5000,
  maxDurationMs = 60_000,
  maxFailures = 2,
} = {}) {
  let stopSent = false;
  let closed = false;
  let ttlTimer = undefined;

  const guard = createStartGuard({ onError, maxFailures });

  const fireStart = async () => {
    const result = await guard.run(() => start());
    if (result === "tripped") {
      keepalive.stop();
    }
    return result;
  };

  const keepalive = createKeepaliveLoop({
    intervalMs: keepaliveMs,
    onTick: fireStart,
  });

  // TTL 安全阀：超过 maxDurationMs 自动停止
  const startTtlTimer = () => {
    if (maxDurationMs <= 0) return;
    clearTtlTimer();
    ttlTimer = setTimeout(() => {
      if (!closed) fireStop();
    }, maxDurationMs);
  };

  const clearTtlTimer = () => {
    if (ttlTimer) {
      clearTimeout(ttlTimer);
      ttlTimer = undefined;
    }
  };

  // 开始 typing（调 Agent 前调用）
  const onReplyStart = async () => {
    if (closed) return;
    stopSent = false;
    guard.reset();
    keepalive.stop();
    clearTtlTimer();
    await fireStart();
    if (guard.isTripped()) return;
    keepalive.start();
    startTtlTimer();
  };

  // 停止 typing（Agent 完成后调用）
  const fireStop = () => {
    closed = true;
    keepalive.stop();
    clearTtlTimer();
    if (!stop || stopSent) return;
    stopSent = true;
    void stop().catch((err) => onError?.(err));
  };

  return {
    onReplyStart,
    onIdle: fireStop,
    onCleanup: fireStop,
  };
}
