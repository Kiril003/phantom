"""read cursor

Revision ID: d7f3a9c215e4
Revises: b8d31f0a72c5
Create Date: 2026-08-22
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7f3a9c215e4'
down_revision: Union[str, None] = 'b8d31f0a72c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('messenger_conversations', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('last_read_seq', sa.Integer(), nullable=False, server_default='0')
        )


def downgrade() -> None:
    with op.batch_alter_table('messenger_conversations', schema=None) as batch_op:
        batch_op.drop_column('last_read_seq')
