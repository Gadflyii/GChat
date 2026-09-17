# Accept display-only clarification reply objects

GInfer can return a reply's argument object (`{"text":"..."}`) without the
tool-call array wrapper, including during Agent Builder clarification. Normalize
that complete, text-only object into the existing `reply` action at the shared
completion boundary, before requesting repair. The repair response uses the same
parser. Preserve the question and reasoning; no file or Studio action is inferred.

Require exactly one field with a nonempty string. Objects with action fields,
non-string or empty text, and truncated JSON still fail validation. Existing tool
arrays and ATEM calls retain their validation and approval requirements.

Regression checks cover parser rejection cases and runner publication of a
clarification from both an initial completion and a repair completion.
