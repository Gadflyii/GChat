import { expect, it } from 'vitest'
import { diskSpaceWarning } from '../model-release'

const GiB = 1024 ** 3

it('stays quiet when models and working space fit', () => {
  expect(diskSpaceWarning(10 * GiB, 20 * GiB)).toBeUndefined()
  expect(diskSpaceWarning(10 * GiB, null)).toBeUndefined()
})
it('warns without blocking when only the working space is short', () => {
  const warning = diskSpaceWarning(10 * GiB, 11 * GiB)
  expect(warning?.block).toBe(false)
  expect(warning?.text).toMatch(/need .*10.*working space.*Only .*11.* is free/)
})
it('blocks when the download itself does not fit', () => {
  const warning = diskSpaceWarning(10 * GiB, 5 * GiB)
  expect(warning?.block).toBe(true)
  expect(warning?.text).toMatch(/Not enough free disk space/)
})
