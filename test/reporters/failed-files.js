// A node:test reporter that lists every failing test, one line each:
// file, line, test name and its error on one line, separated by tabs.
// CI reruns the files in it once and reports the tests that then pass as
// flaky (.github/workflows/test.yml).
//
//   node --test --test-reporter=spec --test-reporter-destination=stdout \
//     --test-reporter=./test/reporters/failed-files.js --test-reporter-destination=failed.txt test/browser/*.test.js
import path from "node:path";
import { pathToFileURL } from "node:url";

export default async function* failedFiles(source) {
  for await (const { type, data } of source) {
    // A todo test may fail; a suite fails only through a test already listed.
    if (type !== "test:fail" || data.todo || !data.file) continue;
    if (data.details.error?.failureType === "subtestsFailed") continue;
    const error = data.details.error?.cause ?? data.details.error;
    // The line of the failing assert when the stack shows it, else the test's own.
    const href = `${pathToFileURL(data.file).href}:`;
    const frame = String(error?.stack ?? "").split("\n").find((l) => l.includes(href));
    const line = frame?.match(/:(\d+):\d+\)?$/)?.[1] ?? data.line;
    const message = String(error?.message ?? error ?? "failed").replace(/\s+/g, " ").trim().slice(0, 300);
    yield `${path.relative(process.cwd(), data.file)}\t${line}\t${data.name}\t${message}\n`;
  }
}
