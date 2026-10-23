import { describe, expect, it } from 'vitest'
import { SIZE_OF, spiceTypesOf } from './spice'

// поля меланжу в даних мапи: TH.GL — spice_field_*, файли гри — типи міток гри SpiceField* (величина — у самому типі)
describe('типи полів меланжу', () => {
  it('файли гри — їхні типи; TH.GL — свої', () => {
    expect(spiceTypesOf(['Cave', 'SpiceFieldSmall', 'SpiceFieldLarge'])).toEqual({ small: 'SpiceFieldSmall', medium: 'SpiceFieldMedium', large: 'SpiceFieldLarge' })
    expect(spiceTypesOf(['cave', 'spice_field_small'])).toEqual({ small: 'spice_field_small', medium: 'spice_field_medium', large: 'spice_field_large' })
  })
  it('величина — для обох', () => {
    expect([SIZE_OF.SpiceFieldMedium, SIZE_OF.spice_field_medium]).toEqual(['medium', 'medium'])
  })
})
