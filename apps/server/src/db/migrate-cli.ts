import { migrate } from "./migrate.js";
import { pool } from "./pool.js";

migrate()
  .then(() => console.log("[db] up to date"))
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
