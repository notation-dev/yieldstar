import { createSdk } from "./sdk";

const sdk = createSdk({ host: "localhost", port: 8080 });

const result = await sdk.triggerAndWait("simple-workflow");

console.log(result);
