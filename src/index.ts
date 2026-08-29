import { createApp } from "./api/app.js";
import { assertConfigValid, config } from "./config.js";

assertConfigValid();

const app = createApp();

app.listen(config.port, () => {
  console.log(`VentureForge kernel listening on :${config.port}`);
});
