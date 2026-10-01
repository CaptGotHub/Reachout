import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/core.js": ["core.js", "text/javascript"],
  "/style.css": ["style.css", "text/css"]
};

createServer(async (request, response) => {
  const file = files[new URL(request.url, "http://localhost").pathname];
  if (!file || request.method !== "GET") {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { "Content-Type": `${file[1]}; charset=utf-8`, "X-Content-Type-Options": "nosniff" }).end(body);
  } catch {
    response.writeHead(500).end("Could not load page");
  }
}).listen(3000, "127.0.0.1", () => console.log("Reachout is available at http://127.0.0.1:3000"));
