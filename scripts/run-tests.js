import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testDirectory = join(projectRoot, "dist", "test");
const testFiles = readdirSync(testDirectory)
  .filter(file => file.endsWith(".test.js"))
  .sort()
  .map(file => join(testDirectory, file));

if (testFiles.length === 0) {
  process.stderr.write(`No compiled tests found in ${testDirectory}\n`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
