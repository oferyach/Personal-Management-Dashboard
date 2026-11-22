import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databasePath = process.env.DATABASE_PATH ?? "./data/app.db";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databasePath,
  },
  strict: true,
  verbose: true,
});
