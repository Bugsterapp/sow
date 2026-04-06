import { randomSample, stratifiedSample } from "./selector.js";

describe("randomSample", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);

  it("returns the correct number of items", () => {
    const result = randomSample(items, 10, 42);
    expect(result).toHaveLength(10);
  });

  it("same seed produces same results", () => {
    const a = randomSample(items, 10, 42);
    const b = randomSample(items, 10, 42);
    expect(a).toEqual(b);
  });

  it("different seeds produce different results", () => {
    const a = randomSample(items, 10, 42);
    const b = randomSample(items, 10, 99);
    expect(a).not.toEqual(b);
  });

  it("returns all items when limit >= array length", () => {
    const small = [1, 2, 3];
    const result = randomSample(small, 10, 42);
    expect(result).toEqual([1, 2, 3]);
  });

  it("handles empty arrays", () => {
    expect(randomSample([], 10, 42)).toEqual([]);
  });

  it("returns items sorted by original index", () => {
    const result = randomSample(items, 20, 1);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  it("all returned items exist in original array", () => {
    const result = randomSample(items, 15, 7);
    for (const item of result) {
      expect(items).toContain(item);
    }
  });
});

describe("stratifiedSample", () => {
  const rows = [
    { id: 1, category: "a" },
    { id: 2, category: "a" },
    { id: 3, category: "a" },
    { id: 4, category: "b" },
    { id: 5, category: "b" },
    { id: 6, category: "c" },
  ];

  it("falls back to randomSample without groupByColumn", () => {
    const result = stratifiedSample(rows, 3, 42);
    expect(result).toHaveLength(3);
  });

  it("returns all items when limit >= array length", () => {
    const result = stratifiedSample(rows, 100, 42, "category");
    expect(result).toHaveLength(rows.length);
  });

  it("maintains representation from each group", () => {
    const bigRows = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      category: i < 70 ? "a" : "b",
    }));
    const result = stratifiedSample(bigRows, 20, 42, "category");
    const aCount = result.filter((r) => r.category === "a").length;
    const bCount = result.filter((r) => r.category === "b").length;
    expect(aCount).toBeGreaterThan(0);
    expect(bCount).toBeGreaterThan(0);
    expect(aCount).toBeGreaterThan(bCount);
  });

  it("is deterministic with same seed", () => {
    const a = stratifiedSample(rows, 3, 42, "category");
    const b = stratifiedSample(rows, 3, 42, "category");
    expect(a).toEqual(b);
  });
});
