import { describe, expect, it } from "vitest";
import {
  findCatalogEntry,
  getPointSymbolMarkup,
  SITE_ELEMENT_CATALOG,
} from "../../../src/annotator/siteElementCatalog";

describe("siteElementCatalog", () => {
  it("contains every required construction site category", () => {
    const categories = SITE_ELEMENT_CATALOG.map((entry) => entry.category);
    for (const required of [
      "driving-route",
      "fence",
      "gate",
      "crane",
      "site-cabin",
      "waste-container",
      "elevator",
      "entrance",
      "electrical-cabinet",
      "demolition-area",
    ]) {
      expect(categories).toContain(required);
    }
  });

  it("pairs every point category with a unique symbol id", () => {
    const seenSymbols = new Set<string>();
    for (const entry of SITE_ELEMENT_CATALOG) {
      if (entry.geometryKind !== "point") continue;
      expect(entry.symbolId).toBeDefined();
      expect(entry.symbolId && seenSymbols.has(entry.symbolId)).toBe(false);
      if (entry.symbolId) {
        seenSymbols.add(entry.symbolId);
        expect(getPointSymbolMarkup(entry.symbolId)).toContain("<symbol");
      }
    }
  });

  it("findCatalogEntry returns null for unknown categories", () => {
    expect(findCatalogEntry("crane")).not.toBeNull();
    expect(findCatalogEntry("unknown" as never)).toBeNull();
  });
});
