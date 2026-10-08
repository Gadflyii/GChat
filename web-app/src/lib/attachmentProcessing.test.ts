import { describe, expect, it, vi } from 'vitest'
import { seedServiceHub } from '@/test/service-hub'
import { createDocumentAttachment } from '@/types/attachment'
import { conversationDocumentAccess, processAttachmentsForSend } from './attachmentProcessing'

const document = createDocumentAttachment({ name: 'Budget.xlsx', path: '/Desktop/Budget.xlsx', fileType: 'xlsx' })
const extractor = { name: 'os_fs_read_document', server: 'gchat-native' }

describe('shared conversation document intake', () => {
  it.each([
    { reason: 'disabled tool', modelSupportsTools: true, tools: [extractor], disabled: ['gchat-native::os_fs_read_document'] },
    { reason: 'unavailable tool', modelSupportsTools: true, tools: [{ ...extractor, available: false }], disabled: [] },
    { reason: 'model without tools', modelSupportsTools: false, tools: [extractor], disabled: [] },
  ])('uses supported inline extraction for default auto with $reason', async ({ modelSupportsTools, tools, disabled }) => {
    const parseDocumentMock = vi.fn().mockResolvedValue('Revenue\t42000\nExpenses\t12000')
    const ingestFileAttachment = vi.fn().mockRejectedValue(new Error('GInfer embeddings unavailable'))
    const serviceHub = seedServiceHub({ rag: { parseDocument: parseDocumentMock } as never, uploads: { ingestFileAttachment } as never })
    const result = await processAttachmentsForSend({ attachments: [document], threadId: 'ordinary', serviceHub, parsePreference: 'auto',
      documentAccess: conversationDocumentAccess(modelSupportsTools, tools, disabled) })
    expect(result.processedAttachments[0]).toMatchObject({ name: 'Budget.xlsx', path: '/Desktop/Budget.xlsx', injectionMode: 'inline', inlineContent: 'Revenue\t42000\nExpenses\t12000' })
    expect(result.hasEmbeddedDocuments).toBe(false)
    expect(parseDocumentMock).toHaveBeenCalledWith('/Desktop/Budget.xlsx', 'xlsx')
    expect(ingestFileAttachment).not.toHaveBeenCalled()
  })

  it('honors explicit inline content even when native documents are available', async () => {
    const parseDocumentMock = vi.fn().mockResolvedValue('All represented spreadsheet cells')
    const ingestFileAttachment = vi.fn()
    const serviceHub = seedServiceHub({ rag: { parseDocument: parseDocumentMock } as never, uploads: { ingestFileAttachment } as never })
    const result = await processAttachmentsForSend({ attachments: [{ ...document, parseMode: 'inline' }], threadId: 'ordinary', serviceHub, parsePreference: 'auto', documentAccess: 'native' })
    expect(result.processedAttachments[0].inlineContent).toBe('All represented spreadsheet cells')
    expect(ingestFileAttachment).not.toHaveBeenCalled()
  })

  it('reports unavailable explicit embeddings instead of changing the selected intake policy', async () => {
    const ingestFileAttachment = vi.fn().mockRejectedValue(new Error('GInfer embeddings unavailable'))
    const parseDocumentMock = vi.fn()
    const serviceHub = seedServiceHub({ rag: { parseDocument: parseDocumentMock } as never, uploads: { ingestFileAttachment } as never })
    await expect(processAttachmentsForSend({ attachments: [{ ...document, parseMode: 'embeddings' }], threadId: 'ordinary', serviceHub, parsePreference: 'auto', documentAccess: 'native' })).rejects.toThrow('GInfer embeddings unavailable')
    expect(ingestFileAttachment).toHaveBeenCalledWith('ordinary', expect.objectContaining({ path: '/Desktop/Budget.xlsx' }))
    expect(parseDocumentMock).not.toHaveBeenCalled()
  })

  it('reports a failed explicit inline read without attempting embeddings', async () => {
    const parseDocumentMock = vi.fn().mockResolvedValue('')
    const ingestFileAttachment = vi.fn()
    const serviceHub = seedServiceHub({ rag: { parseDocument: parseDocumentMock } as never, uploads: { ingestFileAttachment } as never })
    await expect(processAttachmentsForSend({ attachments: [document], threadId: 'ordinary', serviceHub, parsePreference: 'inline', documentAccess: 'native' })).rejects.toThrow('Could not extract content from Budget.xlsx')
    expect(ingestFileAttachment).not.toHaveBeenCalled()
  })
})
