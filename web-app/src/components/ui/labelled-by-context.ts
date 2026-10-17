import { createContext } from 'react'

/**
 * Ids of the visible title and description of the settings row that owns a
 * control, so a bare switch can be named by the text beside it.
 */
export const LabelledByContext = createContext<{
  labelId?: string
  descriptionId?: string
}>({})
