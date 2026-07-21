process.on("message", () => {
  process.send({ status: "completed", response: undefined });
});
