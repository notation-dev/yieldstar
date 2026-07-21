process.on("message", () => {
  process.send({ status: "completed", response: undefined });
});

process.send({ status: "ready" });
