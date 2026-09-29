// Set a player's password directly in the database, for resets.
//
//   npm run set-password -- <handle>            live database
//   npm run set-password -- <handle> --local    local dev database
//
// Asks for the new password, hashes it exactly as the game does
// (PBKDF2-SHA256, random salt), stores it, and signs the player out
// everywhere so the old password stops working at once.
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import { createInterface } from "node:readline/promises";

const HANDLE_RE = /^[a-z0-9_]{3,15}$/;
const PASSWORD_MIN = 6, PASSWORD_MAX = 64;
const ITERATIONS = 12_000;   // match iterations() in functions/api/[[route]].ts

const args = process.argv.slice(2);
const local = args.includes("--local");
const handle = (args.find((a) => !a.startsWith("--")) ?? "").trim().replace(/^@+/, "").toLowerCase();
if (!HANDLE_RE.test(handle)) {
  console.error("Usage: npm run set-password -- <handle> [--local]");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question(`New password for @${handle}: `);
rl.close();
if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
  console.error(`Passwords need ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`);
  process.exit(1);
}

const b64 = (b) => Buffer.from(b).toString("base64");
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
const pass = `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;

const d1 = (sql) => JSON.parse(execFileSync("npx", [
  "wrangler", "d1", "execute", "dili-cart", local ? "--local" : "--remote", "--json", "--command", sql,
], { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }));

// Handles and hashes only hold [a-z0-9_] and base64 characters, so they are
// safe inside SQL quotes.
const found = d1(`SELECT handle FROM players WHERE handle = '${handle}'`)[0]?.results ?? [];
if (!found.length) {
  console.error(`No player called @${handle}.`);
  process.exit(1);
}
d1(`UPDATE players SET pass = '${pass}' WHERE handle = '${handle}'; DELETE FROM sessions WHERE handle = '${handle}';`);
console.log(`Password for @${handle} changed${local ? " (local database)" : ""}. They have been signed out everywhere.`);
