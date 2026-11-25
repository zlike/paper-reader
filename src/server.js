import { config } from './config.js';
import { Storage } from './storage.js';
import { createApp } from './app.js';

const storage = new Storage(config);
await storage.init();
createApp(storage).listen(config.port, config.host, () => {
  console.log(`Paper Reader listening on http://${config.host}:${config.port}`);
});
