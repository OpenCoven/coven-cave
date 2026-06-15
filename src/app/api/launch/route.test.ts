import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /function shellQuote\(input: string\): string \{[\s\S]*input\.replace\(\/'\/g, \"'\\\\''\"\)/,
  "Launch route should POSIX-quote cwd values instead of JSON stringifying them",
);

assert.doesNotMatch(
  source,
  /JSON\.stringify\(cwd\)/,
  "Launch route must not use JavaScript JSON string quoting for shell cwd arguments",
);

assert.match(
  source,
  /if \(!body\.cwd\) return "coven chat";/,
  "Launch route should still allow new chats without a cwd",
);

assert.match(
  source,
  /const cwd = resolveAllowedProjectPath\(body\.cwd\);/,
  "Launch route should restrict chat cwd to configured allowed project roots",
);

assert.match(
  source,
  /return cwd \? `cd \$\{shellQuote\(cwd\)\} && coven chat` : null;/,
  "Launch route should shell-quote allowed cwd values and reject disallowed cwd values",
);
