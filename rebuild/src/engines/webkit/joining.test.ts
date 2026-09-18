// Joining_Type lookups against ArabicShaping.txt values (Unicode 17.0), and the edge decision of joining.ts.
import { describe, expect, test } from 'bun:test'
import { joiningType, joinsAcross } from './joining.js'

describe('Joining_Type (generated/joining.ts)', () => {
  test('letters, joiners, marks and the first and last ranges', () => {
    const types: Array<[number, string]> = [
      [0x628, 'D'], [0x627, 'R'], [0x62f, 'R'], [0x631, 'R'], [0x648, 'R'], [0x644, 'D'], [0x640, 'C'], [0x200d, 'C'], [0x200c, 'U'],
      [0x64e, 'T'], [0x651, 'T'], [0xad, 'T'], [0x61, 'U'], [0x20, 'U'], [0x621, 'U'], [0xa872, 'L'], [0x10ac0, 'D'], [0x1e94b, 'T'],
      [0x712, 'D'], [0x7ca, 'D'], [0x1807, 'D'], [0x5d0, 'U'],
    ]
    for (let i = 0; i < types.length; i++) expect([types[i]![0].toString(16), joiningType(types[i]![0])]).toEqual([types[i]![0].toString(16), types[i]![1]])
  })

  test('two texts join where the letter before the edge joins forward and the one after it joins backward, marks skipped', () => {
    expect(joinsAcross('ب', 'ب')).toBe(true)
    expect(joinsAcross('بِ', 'بِ')).toBe(true)
    expect(joinsAcross('ب', 'ا')).toBe(true)
    expect(joinsAcross('در', 'س')).toBe(false)
    expect(joinsAcross('با', 'ب')).toBe(false)
    expect(joinsAcross('ب‌', 'ب')).toBe(false)
    expect(joinsAcross('ب‍', 'ء')).toBe(false)
    expect(joinsAcross('ب', '‍ء')).toBe(true)
    expect(joinsAcross('ab', 'ب')).toBe(false)
    expect(joinsAcross('َ', 'ب')).toBe(false)
    // Manichaean aleph, Dual_Joining, outside the BMP.
    expect(joinsAcross('𐫀', '𐫀')).toBe(true)
    expect(joinsAcross('𐫀\u{1e94b}', 'a')).toBe(false)
  })
})
