import { describe, expect, it } from "vitest";
import { PAPER_SIZES } from "../../../src/pdf/exportPdf";

describe("PAPER_SIZES", () => {
  it("ships the canonical ISO + ANSI sizes", () => {
    expect(PAPER_SIZES.A4).toEqual({ widthMm: 210, heightMm: 297 });
    expect(PAPER_SIZES.A3).toEqual({ widthMm: 297, heightMm: 420 });
    expect(PAPER_SIZES.A0).toEqual({ widthMm: 841, heightMm: 1189 });
    expect(PAPER_SIZES.Letter.widthMm).toBeCloseTo(215.9);
    expect(PAPER_SIZES.Tabloid.heightMm).toBeCloseTo(431.8);
  });
});
