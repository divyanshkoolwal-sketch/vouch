// Minimal bounded-concurrency runner (no dependency). Runs up to `limit` tasks
// at once; used for parallel chunk reviews and quorum verification calls so the
// max-accuracy default doesn't spawn an unbounded number of `claude -p`
// processes at once.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length || 1));

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
