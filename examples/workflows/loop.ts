import { createWorkflow } from "yieldstar";

export const loopWorkflow = createWorkflow(async function* (step) {
  let numbers: number[] = [];

  let i = 0;
  while (i < 10) {
    const num = yield* step.run(`step:${i}`, async () => {
      console.log(`In step iteration ${i}`);
      return i * 2;
    });
    yield* step.delay(10);
    numbers.push(num);
    i++;
  }

  return numbers;
});
