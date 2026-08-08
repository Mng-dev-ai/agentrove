from typing import Any

import httpx

DEFAULT_API_URL = "http://localhost:8080/api/v1"


class AgentroveError(Exception):
    pass


class AgentroveClient:
    def __init__(self, base_url: str, access_token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._http = httpx.AsyncClient(base_url=self._base_url, timeout=60.0)
        self._access_token = access_token
        self._models_cache: list[dict[str, Any]] | None = None

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self._access_token}"}
        headers.update(kwargs.pop("headers", {}))
        return await self._http.request(method, path, headers=headers, **kwargs)

    async def request(
        self, method: str, path: str, *, expected: tuple[int, ...] = (200,), **kwargs: Any
    ) -> httpx.Response:
        try:
            resp = await self._send(method, path, **kwargs)
            if resp.status_code == 401:
                raise AgentroveError(
                    "AgentRove access token was rejected (expired or revoked) "
                    "— start a new session to get a fresh token."
                )
        except httpx.HTTPError as e:
            # Transport errors (e.g. ConnectTimeout) often str() to "" — name the
            # exception class and target URL so tool errors stay diagnosable.
            raise AgentroveError(
                f"Cannot reach the AgentRove API at {self._base_url}: "
                f"{type(e).__name__}: {e}"
            ) from e
        if resp.status_code not in expected:
            raise AgentroveError(f"{method} {path} -> {resp.status_code}: {resp.text}")
        return resp

    async def list_workspaces(self) -> list[dict[str, Any]]:
        resp = await self.request("GET", "/workspaces", params={"per_page": 100})
        return resp.json()["items"]

    async def resolve_workspace_id(self, workspace_id: str | None) -> str:
        if workspace_id:
            return workspace_id
        resp = await self.request("GET", "/workspaces", params={"per_page": 1})
        items = resp.json()["items"]
        if not items:
            raise AgentroveError("No workspaces found — create one in AgentRove first.")
        return items[0]["id"]

    async def list_chats(
        self, workspace_id: str | None, page: int, per_page: int
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "per_page": per_page}
        if workspace_id:
            params["workspace_id"] = workspace_id
        resp = await self.request("GET", "/chat/chats", params=params)
        return resp.json()

    async def get_chat(self, chat_id: str) -> dict[str, Any]:
        resp = await self.request("GET", f"/chat/chats/{chat_id}")
        return resp.json()

    async def list_personas(self) -> list[dict[str, Any]]:
        resp = await self.request("GET", "/settings/")
        return resp.json().get("personas") or []

    async def get_persona(self, name: str) -> dict[str, Any]:
        personas = await self.list_personas()
        persona = next((p for p in personas if p["name"] == name), None)
        if persona is None:
            raise AgentroveError(f"No persona named {name!r} exists.")
        return persona

    async def create_persona(self, name: str, content: str) -> dict[str, Any]:
        # No per-persona API — personas are a settings list; read-modify-PATCH.
        resp = await self.request("GET", "/settings/")
        personas = resp.json().get("personas") or []
        if any(p["name"] == name for p in personas):
            raise AgentroveError(f"A persona named {name!r} already exists.")
        persona = {"name": name, "content": content}
        await self.request("PATCH", "/settings/", json={"personas": [*personas, persona]})
        return persona

    async def update_persona(self, name: str, content: str) -> dict[str, Any]:
        resp = await self.request("GET", "/settings/")
        personas = resp.json().get("personas") or []
        persona = next((p for p in personas if p["name"] == name), None)
        if persona is None:
            raise AgentroveError(f"No persona named {name!r} exists.")
        persona["content"] = content
        await self.request("PATCH", "/settings/", json={"personas": personas})
        return persona

    async def delete_persona(self, name: str) -> None:
        resp = await self.request("GET", "/settings/")
        personas = resp.json().get("personas") or []
        remaining = [p for p in personas if p["name"] != name]
        if len(remaining) == len(personas):
            raise AgentroveError(f"No persona named {name!r} exists.")
        await self.request("PATCH", "/settings/", json={"personas": remaining})

    async def list_models(self, agent_kind: str | None) -> list[dict[str, Any]]:
        params = {"agent_kind": agent_kind} if agent_kind else None
        resp = await self.request("GET", "/models/", params=params)
        return resp.json()

    async def resolve_model(self, model_id: str | None) -> tuple[str, str]:
        # agent_kind must come from the registry (drives permission mode).
        if self._models_cache is None:
            resp = await self.request("GET", "/models/")
            self._models_cache = resp.json()
        models = self._models_cache
        if not models:
            raise AgentroveError("No models available.")
        if model_id is None:
            chosen = next((m for m in models if m["agent_kind"] == "claude"), models[0])
        else:
            chosen = next((m for m in models if m["model_id"] == model_id), None)
            if chosen is None:
                raise AgentroveError(f"Unknown model_id: {model_id}")
        return chosen["model_id"], chosen["agent_kind"]

    async def create_chat(
        self,
        title: str,
        workspace_id: str,
        model_id: str,
        parent_chat_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "title": title,
            "model_id": model_id,
            "workspace_id": workspace_id,
        }
        # Backend overrides workspace_id with the parent's for sub-threads.
        if parent_chat_id:
            body["parent_chat_id"] = parent_chat_id
        resp = await self.request("POST", "/chat/chats", json=body, expected=(201,))
        return resp.json()

    async def send_message(
        self,
        chat_id: str,
        prompt: str,
        model_id: str,
        permission_mode: str,
        thinking_mode: str | None = None,
        worktree: bool = False,
        base_branch: str | None = None,
        fast_mode: bool = False,
        persona: str | None = None,
    ) -> dict[str, Any]:
        # Form endpoint (no files); httpx bools "true"/"false" parse in FastAPI.
        data: dict[str, Any] = {
            "prompt": prompt,
            "chat_id": chat_id,
            "model_id": model_id,
            "permission_mode": permission_mode,
            "worktree": worktree,
            "fast_mode": fast_mode,
        }
        if thinking_mode:
            data["thinking_mode"] = thinking_mode
        if base_branch:
            data["base_branch"] = base_branch
        if persona:
            data["selected_persona_name"] = persona
        resp = await self.request("POST", "/chat/chat", data=data)
        return resp.json()

    async def get_messages(
        self, chat_id: str, limit: int, cursor: str | None
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        resp = await self.request("GET", f"/chat/chats/{chat_id}/messages", params=params)
        return resp.json()

    async def get_context_usage(self, chat_id: str) -> dict[str, Any] | None:
        try:
            resp = await self.request("GET", f"/chat/chats/{chat_id}/context-usage")
        except AgentroveError:
            # No usage yet (fresh chat) or transient failure — not worth failing
            # the read that asked for messages.
            return None
        return resp.json()

    async def list_automations(self) -> list[dict[str, Any]]:
        resp = await self.request("GET", "/automations")
        return resp.json()

    async def create_automation(self, body: dict[str, Any]) -> dict[str, Any]:
        resp = await self.request("POST", "/automations", json=body, expected=(201,))
        return resp.json()

    async def update_automation(
        self, automation_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        resp = await self.request("PATCH", f"/automations/{automation_id}", json=body)
        return resp.json()

    async def delete_automation(self, automation_id: str) -> None:
        await self.request("DELETE", f"/automations/{automation_id}", expected=(204,))

    async def run_automation(self, automation_id: str) -> dict[str, Any]:
        resp = await self.request("POST", f"/automations/{automation_id}/run")
        return resp.json()
