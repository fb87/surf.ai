export async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    const i = nextIndex++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i);
    await runNext();
  }

  const starters = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(starters);
  return results;
}
