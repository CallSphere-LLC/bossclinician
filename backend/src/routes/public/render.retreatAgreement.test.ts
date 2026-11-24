import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const render = vi.hoisted(() => vi.fn(async () => ({
  status: 200,
  html: "<!doctype html><html><body><h1>Retreat agreement</h1><p>June 15–20, 2027</p></body></html>",
})));
vi.mock("../../ssr/renderer", () => ({ renderPage: render, ssrKeys: () => null }));
vi.mock("../../ssr/loaders", () => ({}));
vi.mock("../../services/loungeSeats", () => ({}));
vi.mock("./retreatsPublic", () => ({}));
import { renderRouter } from "./render";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(renderRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("public retreat agreement rendering", () => {
  it.each(["/retreatagreement", "/retreatagreement/"])("renders %s instead of the empty client shell", async (path) => {
    const response = await fetch(base + path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("June 15–20, 2027");
    expect(render).toHaveBeenCalledWith(path, {});
  });
  it("routes both public spellings through nginx to the HTML renderer", () => {
    const config = readFileSync(resolve(__dirname, "../../../../nginx/site.conf"), "utf8");
    const route = config.match(/location ~ (\^\/\([^\n]+) \{\s*proxy_pass http:\/\/backend:4000;/)?.[1];
    expect(route).toBeDefined();
    const matcher = new RegExp(route!);
    expect(matcher.test("/retreatagreement")).toBe(true);
    expect(matcher.test("/retreatagreement/")).toBe(true);
    expect(matcher.test("/retreatagreement/private")).toBe(false);
  });
});
