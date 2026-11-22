import { applyMigrations, configureTestEnv } from "./testDb";

configureTestEnv("integration");
// Integration suites talk to the same schema production uses: migrate first.
applyMigrations();
