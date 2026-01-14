#!/usr/bin/env python3
"""
CLI command to sync AI models from provider APIs.

This addresses the architectural issue where new models (e.g., glm-4.7)
are unavailable until manually added to seed_data.py. This script fetches
available models from provider APIs and syncs them to the database.

Usage:
    python sync_models.py           # Sync all providers
    python sync_models.py --dry-run # Show what would change without doing it
"""
import asyncio
import sys

import argparse

from app.core.config import get_settings
from app.services.model_sync_service import ModelSyncService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync AI models from provider APIs to the database."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without making modifications",
    )
    parser.add_argument(
        "--provider",
        choices=["zai", "anthropic", "all"],
        default="all",
        help="Provider to sync (default: all)",
    )
    return parser.parse_args()


async def sync_models(dry_run: bool = False, provider: str = "all") -> None:
    """Main sync function."""
    settings = get_settings()

    if dry_run:
        print("DRY RUN MODE - No changes will be made\n")

    print(f"Connecting to database: {settings.DATABASE_URL.split('@')[-1]}")

    async with ModelSyncService() as sync_service:
        if provider == "all":
            print("Fetching models from all providers...")
            provider_models = await sync_service.sync_all_providers()
        else:
            provider_models = {}
            if provider == "zai":
                print("Fetching models from ZAI...")
                from app.models.db_models.enums import ModelProvider

                provider_models[ModelProvider.ZAI] = await sync_service.sync_zai_models()
            elif provider == "anthropic":
                print("Fetching models from Anthropic...")
                from app.models.db_models.enums import ModelProvider

                provider_models[ModelProvider.ANTHROPIC] = (
                    await sync_service.sync_anthropic_models()
                )

        print("\n=== Models to Sync ===")
        for prov, models in provider_models.items():
            print(f"\n{prov.value.upper()}:")
            for model in models:
                print(f"  - {model.name} ({model.model_id})")

        if dry_run:
            print("\n" + "=" * 50)
            print("DRY RUN COMPLETE - No changes were made")
            print("Run without --dry-run to apply these changes")
            return

        print("\n=== Syncing to Database ===")
        result = await sync_service.sync_to_database(provider_models)

        print("\n" + "=" * 50)
        print("SYNC COMPLETE")
        print("=" * 50)

        if result.get("added"):
            print(f"\nAdded {len(result['added'])} model(s):")
            for model_id in result["added"]:
                print(f"  + {model_id}")

        if result.get("updated"):
            print(f"\nUpdated {len(result['updated'])} model(s):")
            for model_id in result["updated"]:
                print(f"  ~ {model_id}")

        if result.get("unchanged"):
            print(f"\n{len(result['unchanged'])} model(s) unchanged")

        if result.get("error"):
            print(f"\nError: {result['error']}")
            sys.exit(1)


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(sync_models(dry_run=args.dry_run, provider=args.provider))
    except KeyboardInterrupt:
        print("\nSync cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\nError during sync: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
