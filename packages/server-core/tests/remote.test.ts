import { describe, expect, it } from "vitest";
import { RemoteFetchError, validateRemoteUrl } from "../src/remote.js";

describe("remote URL validation", () => {
  it("rejects non-HTTPS URLs", async () => {
    await expect(validateRemoteUrl("http://example.com/audio.mp3")).rejects.toMatchObject({ code: "REMOTE_URL_BLOCKED" });
  });

  it("rejects loopback destinations", async () => {
    await expect(validateRemoteUrl("https://127.0.0.1/audio.mp3")).rejects.toMatchObject({ code: "REMOTE_URL_BLOCKED" });
  });

  it("rejects credentials in URLs", async () => {
    await expect(validateRemoteUrl("https://user:pass@example.com/audio.mp3")).rejects.toMatchObject({ code: "REMOTE_URL_BLOCKED" });
  });
});
