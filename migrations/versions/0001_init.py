"""Esquema inicial.

Revision ID: 0001_init
Revises:
Create Date: 2026-10-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

import expedientes.models  # noqa: F401  (registra las tablas)
from expedientes.db import Base

revision: str = "0001_init"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # El esquema vive en los modelos (una sola fuente de verdad).
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
