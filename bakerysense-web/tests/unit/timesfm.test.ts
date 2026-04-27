import { afterEach, describe, expect, it, vi } from "vitest";
import {
  predictTimesFM,
  isTimesFmConfigured,
  TimesFmUnavailableError,
} from "../../src/lib/forecasters/timesfm";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("isTimesFmConfigured", () => {
  it("false when env has no TIMESFM_ENDPOINT", () => {
    expect(isTimesFmConfigured({} as unknown as CloudflareEnv)).toBe(false);
  });
  it("true when TIMESFM_ENDPOINT is set", () => {
    expect(isTimesFmConfigured({ TIMESFM_ENDPOINT: "http://x" } as unknown as CloudflareEnv)).toBe(true);
  });
});

describe("predictTimesFM live path", () => {
  const env = { TIMESFM_ENDPOINT: "https://timesfm.example.com" } as unknown as CloudflareEnv;

  it("throws TimesFmUnavailableError when endpoint is missing", async () => {
    await expect(predictTimesFM({} as unknown as CloudflareEnv, {
      history: [1, 2, 3], horizon: 1, quantiles: [0.9],
    })).rejects.toBeInstanceOf(TimesFmUnavailableError);
  });

  it("POSTs to TIMESFM_ENDPOINT/infer with the input body and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.history).toEqual([10, 11, 12]);
      expect(body.horizon).toBe(1);
      return new Response(JSON.stringify({
        quantiles: { "q0.9": [42.5] },
        model: "timesfm-2.0-500m",
        lora_applied: false,
        latency_ms: 87,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await predictTimesFM(env, { history: [10, 11, 12], horizon: 1, quantiles: [0.9] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("https://timesfm.example.com/infer");
    expect(out.quantiles["q0.9"]).toEqual([42.5]);
    expect(out.model).toBe("timesfm-2.0-500m");
    expect(out.latency_ms).toBe(87);
  });

  it("throws TimesFmUnavailableError on HTTP 500", async () => {
    globalThis.fetch = (async () =>
      new Response("upstream blew up", { status: 503 })
    ) as unknown as typeof fetch;
    await expect(predictTimesFM(env, { history: [1, 2, 3], horizon: 1, quantiles: [0.9] }))
      .rejects.toBeInstanceOf(TimesFmUnavailableError);
  });

  it("strips trailing slash in TIMESFM_ENDPOINT before joining /infer", async () => {
    const calledUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calledUrls.push(url);
      return new Response(JSON.stringify({
        quantiles: {}, model: "x", lora_applied: false, latency_ms: 0,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    await predictTimesFM(
      { TIMESFM_ENDPOINT: "https://timesfm.example.com/" } as unknown as CloudflareEnv,
      { history: [1, 2, 3], horizon: 1, quantiles: [0.9] },
    );
    expect(calledUrls[0]).toBe("https://timesfm.example.com/infer");
  });

  it("wraps generic fetch errors in TimesFmUnavailableError", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    await expect(predictTimesFM(env, { history: [1, 2, 3], horizon: 1, quantiles: [0.9] }))
      .rejects.toBeInstanceOf(TimesFmUnavailableError);
  });
});
