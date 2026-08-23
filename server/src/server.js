import { createApp } from "./app.js";
import { config } from "./config.js";

const server = createApp().listen(config.port, config.host, () => {
  console.log(`GST reconciliation API listening on http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

