import { defineConfig, type Plugin } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Dev only: POST a data-URL image to /__shot?name=x and it's written to
 * /tmp for inspection. Lets the WebGL view be captured without a visible
 * browser window. Never part of the production build.
 */
function shots(): Plugin {
  return {
    name: "dev-shots",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__shot", (req, res) => {
        const name = (new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "shot").replace(/[^a-z0-9_-]/gi, "");
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const b64 = body.replace(/^data:image\/\w+;base64,/, "");
          mkdirSync("/private/tmp/claude-501/shots", { recursive: true });
          writeFileSync(`/private/tmp/claude-501/shots/${name}.jpg`, Buffer.from(b64, "base64"));
          res.end("ok");
        });
      });
    },
  };
}

/**
 * Dev only: POST raw bytes to /__save?name=file.mp4 and they're written to
 * trailer/ in the project. The trailer renderer uses it for the finished video.
 */
function saves(): Plugin {
  return {
    name: "dev-saves",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save", (req, res) => {
        const name = (new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "out.bin").replace(/[^a-z0-9_.-]/gi, "");
        const parts: Buffer[] = [];
        req.on("data", (c: Buffer) => parts.push(c));
        req.on("end", () => {
          mkdirSync("trailer", { recursive: true });
          writeFileSync(`trailer/${name}`, Buffer.concat(parts));
          res.end("ok");
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [shots(), saves()],
  build: { target: "es2020", assetsInlineLimit: 8192, chunkSizeWarningLimit: 1200 },
  server: {
    // The API runs under Wrangler during development (see tools/dev.mjs).
    proxy: { "/api": { target: "http://127.0.0.1:8788", ws: true } },
  },
});
