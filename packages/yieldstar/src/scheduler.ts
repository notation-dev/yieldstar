export abstract class Scheduler {
  abstract resumeAt(ts: number): Promise<void> | void;
}
