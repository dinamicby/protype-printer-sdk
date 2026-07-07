import { describe, test, expect, vi, afterEach } from "vitest";
import { MoonrakerClient } from "./moonraker-client";

afterEach(() => vi.unstubAllGlobals());

function stubFetchOk() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ result: "ok" }), { status: 200 })));
}
function stubFetchFail() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
}
const mk = () => new MoonrakerClient({ baseUrl: "http://x", mode: "local", timeout: 1000, maxRetries: 1 });

describe("onGcodeSent observer", () => {
  test("notifies with script and a completion promise that resolves with the send result", async () => {
    stubFetchOk();
    const client = mk();
    const seen: { script: string }[] = [];
    let completion: Promise<unknown> | null = null;
    client.onGcodeSent((ev) => { seen.push({ script: ev.script }); completion = ev.completion; });
    const res = await client.sendGcode("G28");
    expect(seen).toEqual([{ script: "G28" }]);
    await expect(completion!).resolves.toEqual(res);
  });

  test("unsubscribe stops notifications; multiple observers all fire", async () => {
    stubFetchOk();
    const client = mk();
    const a = vi.fn(); const b = vi.fn();
    const offA = client.onGcodeSent(a);
    client.onGcodeSent(b);
    await client.sendGcode("M114");
    offA();
    await client.sendGcode("M115");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  test("an observer that throws does not break the send", async () => {
    stubFetchOk();
    const client = mk();
    client.onGcodeSent(() => { throw new Error("observer bug"); });
    await expect(client.sendGcode("G1 X0")).resolves.toBeDefined();
  });

  test("completion settles (resolves, per pinned semantics) even when the request fails", async () => {
    // Pinned factual semantics (verified against moonraker-client.ts `request<T>`):
    // on HTTP failure the private request() never throws/rejects — it always
    // resolves with { success: false, error }. A 500 is a 5xx, so it is retried
    // up to maxRetries times and then falls through to the final
    // `return { success: false, error: lastError }`. So `post`/`sendGcode`
    // RESOLVE (never reject) on HTTP failure; there is no reject path to guard
    // here, but the completion promise must still settle with a false result.
    stubFetchFail();
    const client = mk();
    let completion: Promise<unknown> | null = null;
    client.onGcodeSent((ev) => { completion = ev.completion; });
    const res = await client.sendGcode("G28");
    expect(res.success).toBe(false);
    await expect(completion!).resolves.toEqual(res);
  });
});
