/*
4x4 column-major matrix helpers. We only need the operations used by the
footprint pipeline: applying a placement matrix to a vertex and pulling the
translation out of a matrix for storey elevation.
*/

export type Matrix4 = ArrayLike<number>;

export function applyToPoint3(matrix: Matrix4, x: number, y: number, z: number): [number, number, number] {
  // Column-major: m[0..3] is column 0, m[4..7] column 1, m[8..11] column 2, m[12..15] column 3 (translation).
  const m0 = matrix[0] ?? 1;
  const m1 = matrix[1] ?? 0;
  const m2 = matrix[2] ?? 0;
  const m4 = matrix[4] ?? 0;
  const m5 = matrix[5] ?? 1;
  const m6 = matrix[6] ?? 0;
  const m8 = matrix[8] ?? 0;
  const m9 = matrix[9] ?? 0;
  const m10 = matrix[10] ?? 1;
  const m12 = matrix[12] ?? 0;
  const m13 = matrix[13] ?? 0;
  const m14 = matrix[14] ?? 0;
  return [m0 * x + m4 * y + m8 * z + m12, m1 * x + m5 * y + m9 * z + m13, m2 * x + m6 * y + m10 * z + m14];
}

export function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
