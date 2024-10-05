import { sqliteEventLoop } from "./runtime";
import { sdk } from "./sdk";
import { manager } from "./manager";

sqliteEventLoop.start({ onNewTask: manager.execute });

try {
  const result = await sdk.triggerAndWait("simple-workflow");
  console.log(result);
} finally {
  sqliteEventLoop.stop();
}
