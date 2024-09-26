export async function timeoutScheduler(ts: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ts));
}
