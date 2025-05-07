#!/usr/bin/env -S deno run -A --unstable
/**
 * Run your Deno app with --inspect on port 9229,
 * wait until the list of CDP targets is stable,
 * merge fresh “attach” configs into .vscode/launch.json.
 *
 * Extra keys it adds:
 *   - each generated config:   { "generatedBy": "deno-worker-gen" }
 *   - the compound:            { "generatedBy": "deno-worker-gen" }
 *
 * Usage:  deno run -A scripts/gen_denops_launch.ts examples/main.ts
 */

import { resolve } from "jsr:@std/path";

const INSPECT_PORT = 9229;
const POLL_INTERVAL = 300;   // ms
const STABLE_ROUNDS = 4;
const MARKER = "deno-worker-gen";

const program = Deno.args[0] ?? "main.ts";

// 1 ▸ spawn the target program
new Deno.Command("deno", {
  args: ["run", `--inspect=127.0.0.1:${INSPECT_PORT}`, "-A", program],
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

// 2 ▸ poll inspector targets
async function fetchTargets() {
  const res = await fetch(`http://127.0.0.1:${INSPECT_PORT}/json`);
  return await res.json() as { webSocketDebuggerUrl?: string }[];
}

let last = new Set<string>(), stable = 0;
for (; ;) {
  try {
    const urls = new Set(
      (await fetchTargets())
        .map(t => t.webSocketDebuggerUrl)
        .filter(Boolean) as string[],
    );
    if (urls.size && urls.size === last.size && [...urls].every(x => last.has(x))) ++stable;
    else { stable = 0; last = urls; }
    if (stable >= STABLE_ROUNDS) break;
  } catch { /* inspector not ready yet */ }
  await new Promise(r => setTimeout(r, POLL_INTERVAL));
}

// 3 ▸ build new configs
const attaches = [...last].map((ws, i) => ({
  name: `Attach worker #${i + 1}`,
  type: "node",
  request: "attach",
  websocketAddress: ws,
  generatedBy: MARKER,
}));
const compound = {
  name: "Deno - Attach (ALL)",
  configurations: attaches.map(c => c.name),
  preLaunchTask: "genlaunch",      // ← whatever your task label is
  generatedBy: MARKER,
};

// 4 ▸ merge into launch.json
const launchPath = resolve("../.vscode/launch.json");
let launch: any = { version: "0.2.0", configurations: [], compounds: [] };

try {
  launch = JSON.parse(await Deno.readTextFile(launchPath));
} catch { /* first run or invalid JSON—start fresh */ }

// strip previous auto-generated entries
launch.configurations = (launch.configurations ?? []).filter((c: any) => c.generatedBy !== MARKER);
launch.compounds = (launch.compounds ?? []).filter((c: any) => c.generatedBy !== MARKER);

// append fresh ones
launch.configurations.push(...attaches);
launch.compounds.push(compound);


await Deno.writeTextFile(launchPath, JSON.stringify(launch, null, 2));
console.log(`✨  Updated ${launchPath} with ${attaches.length} workers.`);
await new Promise(resolve => setTimeout(resolve, 1000));
console.log("READY-FOR-DEBUG");  