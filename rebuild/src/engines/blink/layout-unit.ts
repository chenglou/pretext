// Blink FixedPoint<6, int32_t> (layout_unit.h:98-141, 638-710). Raw units are 1/64px.
export const LU_MIN = -2147483648
export const LU_MAX = 2147483647

// base::saturated_cast<int32_t>: truncate toward zero, saturate, NaN -> zero.
export function clampLU(raw: number): number {
  if (raw >= LU_MAX) return LU_MAX
  if (raw <= LU_MIN) return LU_MIN
  const integer = Math.trunc(raw)
  return Number.isNaN(integer) || integer === 0 ? 0 : integer
}

export function addLU(a: number, b: number): number {
  return Math.min(LU_MAX, Math.max(LU_MIN, a + b))
}

export function subLU(a: number, b: number): number {
  return Math.min(LU_MAX, Math.max(LU_MIN, a - b))
}

// Unary minus on LayoutUnit also saturates, unlike number negation.
export function negLU(value: number): number {
  return value === 0 ? 0 : value === LU_MIN ? LU_MAX : -value
}
