import { describe, expect, it } from "vitest";

import { rewriteManifest } from "../../../dev-server/server";

const PROD = "https://markus-t-mattila.github.io/trimble-sitePlan2D/";
const LOCAL = "https://localhost:5173/";

describe("rewriteManifest", () => {
  it("replaces every occurrence of the production base URL with the local base URL", () => {
    const manifest = JSON.stringify(
      {
        icon: `${PROD}assets/icon.svg`,
        title: "sitePlan2D",
        url: `${PROD}index.html`,
        description: "Convert IFC files to per-storey SVG/JSON floorplans.",
        enabled: true,
      },
      null,
      2,
    );

    const rewritten = rewriteManifest(manifest, PROD, LOCAL);
    const parsed = JSON.parse(rewritten) as Record<string, unknown>;

    expect(parsed["icon"]).toBe(`${LOCAL}assets/icon.svg`);
    expect(parsed["url"]).toBe(`${LOCAL}index.html`);
    expect(parsed["title"]).toBe("sitePlan2D");
    expect(parsed["enabled"]).toBe(true);
    expect(rewritten.includes(PROD)).toBe(false);
  });

  it("is a no-op when the production base URL is absent", () => {
    const manifest = JSON.stringify({
      title: "sitePlan2D",
      description: "An extension that converts IFC to SVG.",
      enabled: true,
    });

    expect(rewriteManifest(manifest, PROD, LOCAL)).toBe(manifest);
  });

  it("does not touch unrelated strings that merely share a prefix", () => {
    const sibling = "https://markus-t-mattila.github.io/some-other-repo/index.html";
    const manifest = JSON.stringify({
      url: `${PROD}index.html`,
      docs: sibling,
      blurb: "Project markus-t-mattila ships at /trimble-sitePlan2D/.",
    });

    const rewritten = rewriteManifest(manifest, PROD, LOCAL);
    const parsed = JSON.parse(rewritten) as Record<string, unknown>;

    expect(parsed["url"]).toBe(`${LOCAL}index.html`);
    expect(parsed["docs"]).toBe(sibling);
    expect(parsed["blurb"]).toBe("Project markus-t-mattila ships at /trimble-sitePlan2D/.");
  });

  it("replaces multiple occurrences within the same string", () => {
    const raw = `before ${PROD} middle ${PROD}assets/icon.svg end`;
    const rewritten = rewriteManifest(raw, PROD, LOCAL);
    expect(rewritten).toBe(`before ${LOCAL} middle ${LOCAL}assets/icon.svg end`);
  });

  it("returns the input unchanged when the search string equals the replacement", () => {
    const manifest = JSON.stringify({ url: `${PROD}index.html` });
    expect(rewriteManifest(manifest, PROD, PROD)).toBe(manifest);
  });
});
