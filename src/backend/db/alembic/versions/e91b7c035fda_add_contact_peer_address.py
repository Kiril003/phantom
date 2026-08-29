"""contact peer address

Revision ID: e91b7c035fda
Revises: d5a8c2f61e73
Create Date: 2026-08-22

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e91b7c035fda'
down_revision: Union[str, None] = 'd5a8c2f61e73'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('messenger_contacts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('peer_address', sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('messenger_contacts', schema=None) as batch_op:
        batch_op.drop_column('peer_address')
