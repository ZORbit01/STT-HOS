import argparse
import asyncio
import getpass
import os
import sys

from sqlalchemy import select

from app.config import settings
from app.db import AsyncSessionLocal
from app.models.orm import AdminAccount
from app.services.auth_service import hash_password


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create or update an admin account.")
    parser.add_argument("--username", default=os.getenv("ADMIN_USERNAME", settings.ADMIN_USERNAME))
    parser.add_argument("--first-name", default=os.getenv("ADMIN_FIRST_NAME", settings.ADMIN_FIRST_NAME))
    parser.add_argument("--last-name", default=os.getenv("ADMIN_LAST_NAME", settings.ADMIN_LAST_NAME))
    parser.add_argument("--password", default=os.getenv("ADMIN_PASSWORD", settings.ADMIN_PASSWORD or ""))
    parser.add_argument("--reset-password", action="store_true")
    return parser


async def _bootstrap(args: argparse.Namespace) -> None:
    if args.password:
        password = args.password
    elif sys.stdin.isatty():
        password = getpass.getpass("Admin password: ")
    else:
        raise SystemExit("ADMIN_PASSWORD is required for non-interactive admin bootstrap.")

    if len(password) < 6:
        raise SystemExit("Password must be at least 6 characters.")

    username = args.username.strip()
    first_name = args.first_name.strip()
    last_name = args.last_name.strip()
    if not username or not first_name or not last_name:
        raise SystemExit("Username, first name, and last name are required.")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AdminAccount).where(AdminAccount.username == username))
        admin = result.scalar_one_or_none()

        if admin is None:
            admin = AdminAccount(
                username=username,
                hashed_password=hash_password(password),
                first_name=first_name,
                last_name=last_name,
                is_active=True,
            )
            db.add(admin)
            action = "created"
        else:
            admin.first_name = first_name
            admin.last_name = last_name
            admin.is_active = True
            if args.reset_password:
                admin.hashed_password = hash_password(password)
                action = "updated and password reset"
            else:
                action = "already exists; names/reactivation updated"

        await db.commit()
        print(f"Admin '{username}' {action}.")


def main() -> None:
    asyncio.run(_bootstrap(_parser().parse_args()))


if __name__ == "__main__":
    main()
