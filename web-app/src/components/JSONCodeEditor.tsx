import Editor, { type TextareaCodeEditorProps } from '@uiw/react-textarea-code-editor/nohighlight'
import rehypePrismGenerator from 'rehype-prism-plus/generator'
import { refractor } from 'refractor/lib/core.js'
import json from 'refractor/lang/json.js'

// The metadata and MCP editors represent JSON, so register its exact existing
// Prism grammar rather than importing every unrelated editor language.
refractor.register(json)
const plugins: TextareaCodeEditorProps['rehypePlugins'] = [[rehypePrismGenerator(refractor), { ignoreMissing: true }]]

export default function JSONCodeEditor(props: TextareaCodeEditorProps) {
  return <Editor {...props} language="json" rehypePlugins={plugins} />
}
