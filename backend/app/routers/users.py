"""
Admin-only user management.

GET   /users                 list all users with their roles
PATCH /users/{user_id}/role  change a user's role (admin | manager | viewer)

Only admins may call these. An admin cannot change their OWN role — that
prevents accidentally locking the last admin out of user management.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import require_admin
from app.schemas.chemical import ManagedUser, RoleUpdate, UsersResponse
from app.services import database

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=UsersResponse)
async def list_users(_admin_id: str = Depends(require_admin)) -> UsersResponse:
    return UsersResponse(users=database.list_users_with_roles())


@router.patch("/{user_id}/role", response_model=ManagedUser)
async def change_user_role(
    user_id: str,
    body: RoleUpdate,
    admin_id: str = Depends(require_admin),
) -> ManagedUser:
    if user_id == admin_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role.",
        )

    users = {u["id"]: u for u in database.list_users_with_roles()}
    target = users.get(user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    database.set_user_role(user_id, body.role)
    target["role"] = body.role
    return ManagedUser(**target)
