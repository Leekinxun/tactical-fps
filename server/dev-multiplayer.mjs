import { spawn } from "node:child_process";

const processes = [
  spawn(process.execPath, ["server/multiplayer-server.mjs"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"], { stdio: "inherit" }),
];
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of processes) child.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
const exits = processes.map((child) => new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal }))));
const firstExit = await Promise.race(exits);
if (!shuttingDown) {
  process.exitCode = firstExit.code ?? (firstExit.signal ? 1 : 0);
  shutdown();
}
await Promise.all(exits);
