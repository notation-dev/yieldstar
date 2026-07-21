process.on("message", (event) => {
  process.send({
    status: "completed",
    response: {
      result:
        event.context instanceof Map &&
        event.context.get("requestId") === "request",
    },
  });
});
