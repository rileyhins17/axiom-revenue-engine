/**
 * Gives up on `work` after `ms` instead of waiting forever. A screen that throws shows
 * the error screen, which tries again by itself; a screen that waits shows nothing at all.
 * The label goes to the Worker log, so a stuck step is named.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.error(JSON.stringify({ event: "step_timeout", step: label, ms }));
      reject(new Error(`${label} took longer than ${ms / 1000} seconds`));
    }, ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
