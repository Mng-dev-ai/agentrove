# Stream Events

| File | Exports |
| --- | --- |
| backend/app/services/streaming/__init__.py | stream module |
| backend/app/services/streaming/runtime.py | ChatStreamRuntime |
| backend/app/services/streaming/types.py | ChatStreamRequest, ToolPayload, StreamEvent, StreamSnapshotAccumulator, StreamEnvelope |

Known frontend consumers:

| Consumer | Purpose |
| --- | --- |
| frontend/src/contexts/ChatContext.tsx | chat stream context and event application |
| frontend/src/components/chat/message-bubble/segmentBuilder.ts | message segment construction |
| frontend/src/components/chat/message-bubble/ThinkingBlock.tsx | thinking summary rendering |
| frontend/src/components/chat/tools/registry.tsx | tool-card renderer selection |
