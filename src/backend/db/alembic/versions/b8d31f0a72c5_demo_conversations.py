"""demo conversations

Revision ID: b8d31f0a72c5
Revises: a4e70c1b95d2
Create Date: 2026-08-22
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8d31f0a72c5'
down_revision: Union[str, None] = 'a4e70c1b95d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('messenger_conversations', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('is_demo', sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table('messenger_conversations', schema=None) as batch_op:
        batch_op.drop_column('is_demo')
