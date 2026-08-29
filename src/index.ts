import { createApp } from "./api/app.js";
import { assertConfigValid, config } from "./config.js";
import { registerDefaultTools } from "./tools/register-tools.js";

assertConfigValid();
registerDefaultTools();

const app = createApp();

app.listen(config.port, () => {
  console.log(`VentureForge kernel listening on :${config.port}`);
});
