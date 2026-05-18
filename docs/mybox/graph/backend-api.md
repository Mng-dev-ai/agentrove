# Backend API Endpoints

| Endpoint file | Routes |
| --- | --- |
| backend/app/api/endpoints/__init__.py | no router markers found by v0 scanner |
| backend/app/api/endpoints/ai_model.py | GET / |
| backend/app/api/endpoints/attachments.py | GET /attachments/temp/preview; GET /attachments/{attachment_id}/preview; GET /attachments/{attachment_id}/download |
| backend/app/api/endpoints/auth.py | POST /jwt/login; POST /register; GET /me; POST /jwt/refresh; POST /jwt/logout |
| backend/app/api/endpoints/chat.py | POST /chats; POST /chat; POST /enhance-prompt; GET /chats; GET /chats/search; GET /chats/{chat_id}/sub-threads; GET /chats/{chat_id}; GET /chats/{chat_id}/context-usage; PATCH /chats/{chat_id}; DELETE /chats/all; DELETE /chats/{chat_id}; GET /chats/{chat_id}/messages; GET /chats/{chat_id}/stream; GET /chats/{chat_id}/status; GET /messages/{message_id}/events; POST /messages/{message_id}/checkpoint/restore-all; GET /messages/{message_id}/changes; GET /messages/{message_id}/changes/diff; DELETE /chats/{chat_id}/stream; POST /chats/{chat_id}/permissions/{request_id}/respond; POST /chats/{chat_id}/queue; GET /chats/{chat_id}/queue; PATCH /chats/{chat_id}/queue/{message_id}; DELETE /chats/{chat_id}/queue/{message_id}; POST /chats/{chat_id}/queue/{message_id}/send-now; DELETE /chats/{chat_id}/queue |
| backend/app/api/endpoints/github.py | GET /repositories; GET /pulls; GET /pulls/{owner}/{repo}/{number}/comments; POST /pulls; POST /generate-pr-description; POST /generate-commit-message; GET /collaborators |
| backend/app/api/endpoints/sandbox.py | GET /{sandbox_id}/files/metadata; GET /{sandbox_id}/files/content/{file_path:path}; PUT /{sandbox_id}/files; GET /{sandbox_id}/secrets; POST /{sandbox_id}/secrets; PUT /{sandbox_id}/secrets/{key}; DELETE /{sandbox_id}/secrets/{key}; GET /{sandbox_id}/download-zip; GET /{sandbox_id}/git/diff; GET /{sandbox_id}/git/branches; POST /{sandbox_id}/git/checkout; POST /{sandbox_id}/git/push; POST /{sandbox_id}/git/pull; POST /{sandbox_id}/git/commit; POST /{sandbox_id}/git/restore-file; POST /{sandbox_id}/git/restore-all; POST /{sandbox_id}/git/create-branch; GET /{sandbox_id}/git/remote-url; GET /{sandbox_id}/search |
| backend/app/api/endpoints/settings.py | GET /; PATCH / |
| backend/app/api/endpoints/skills.py | GET ; GET /{source}/{skill_name}/files; PUT /{source}/{skill_name} |
| backend/app/api/endpoints/websocket.py | WEBSOCKET /{sandbox_id}/terminal |
| backend/app/api/endpoints/workspace.py | POST ; GET ; GET /{workspace_id}; PATCH /{workspace_id}; GET /{workspace_id}/resources; DELETE /{workspace_id} |
