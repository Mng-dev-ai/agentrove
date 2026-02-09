from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.marketplace import (
    GetCatalogAction,
    GetInstalledPluginsAction,
    GetPluginDetailsAction,
    InstallPluginComponentsAction,
    UninstallPluginComponentsAction,
)
from app.core.deps import (
    get_db,
    get_get_catalog_action,
    get_get_installed_plugins_action,
    get_get_plugin_details_action,
    get_install_plugin_components_action,
    get_uninstall_plugin_components_action,
)
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas.marketplace import (
    InstallComponentRequest,
    InstallResponse,
    InstalledPlugin,
    MarketplacePlugin,
    PluginDetails,
    UninstallComponentsRequest,
    UninstallResponse,
)

router = APIRouter()


@router.get("/catalog", response_model=list[MarketplacePlugin])
async def get_catalog(
    force_refresh: bool = Query(False, description="Force refresh catalog cache"),
    get_catalog_action: GetCatalogAction = Depends(get_get_catalog_action),
) -> list[MarketplacePlugin]:
    return await get_catalog_action.execute(force_refresh)


@router.get("/catalog/{plugin_name}", response_model=PluginDetails)
async def get_plugin_details(
    plugin_name: str,
    get_plugin_details_action: GetPluginDetailsAction = Depends(get_get_plugin_details_action),
) -> PluginDetails:
    return await get_plugin_details_action.execute(plugin_name)


@router.post("/install", response_model=InstallResponse)
async def install_plugin_components(
    request: InstallComponentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    install_plugin_components_action: InstallPluginComponentsAction = Depends(
        get_install_plugin_components_action
    ),
) -> InstallResponse:
    return await install_plugin_components_action.execute(request, current_user, db)


@router.get("/installed", response_model=list[InstalledPlugin])
async def get_installed_plugins(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    get_installed_plugins_action: GetInstalledPluginsAction = Depends(
        get_get_installed_plugins_action
    ),
) -> list[InstalledPlugin]:
    return await get_installed_plugins_action.execute(current_user, db)


@router.post("/uninstall", response_model=UninstallResponse)
async def uninstall_plugin_components(
    request: UninstallComponentsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    uninstall_plugin_components_action: UninstallPluginComponentsAction = Depends(
        get_uninstall_plugin_components_action
    ),
) -> UninstallResponse:
    return await uninstall_plugin_components_action.execute(request, current_user, db)
