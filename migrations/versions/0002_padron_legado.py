"""Carátula completa y centros judiciales del legado.

Revision ID: 0002_padron_legado
Revises: 0001_init
Create Date: 2026-10-22

Motivo: el padrón real trae actor, demandado y la relación con el centro
judicial original (LegajoExpdtes guarda 17 centros con nombres repetidos).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_padron_legado"
down_revision: str | None = "0001_init"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("expedientes", sa.Column("actor", sa.Text(), nullable=True))
    op.add_column("expedientes", sa.Column("demandado", sa.Text(), nullable=True))

    op.add_column("centros_judiciales", sa.Column("legado_id", sa.Integer(), nullable=True))
    op.create_unique_constraint(
        "uq_centros_judiciales_legado_id", "centros_judiciales", ["legado_id"]
    )
    op.drop_constraint("centros_judiciales_nombre_key", "centros_judiciales", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint(
        "centros_judiciales_nombre_key", "centros_judiciales", ["nombre"]
    )
    op.drop_constraint("uq_centros_judiciales_legado_id", "centros_judiciales", type_="unique")
    op.drop_column("centros_judiciales", "legado_id")
    op.drop_column("expedientes", "demandado")
    op.drop_column("expedientes", "actor")
