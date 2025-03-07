import { workflow } from "yieldstar";

export const loopWorkflow = workflow(async function* (step, event, logger) {
  let numbers: number[] = [];

  let i = 0;
  while (i < 10) {
    const num = yield* step.run(`step:${i}`, async () => {
      logger.info(`In step iteration ${i}`);
      return i * 2;
    });
    yield* step.delay(10);
    numbers.push(num);
    i++;
  }

  return numbers;
});
