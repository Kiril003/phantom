"""message reply reference

Revision ID: a4e70c1b95d2
Revises: f2c40b71d8ae
Create Date: 2026-08-22

Окрема міграція, а не дописка до попередньої: та вже застосована в робочих
базах, тож alembic її не перегляне і колонка ніде не зʼявиться.

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4e70c1b95d2'
down_revision: Union[str, None] = 'f2c40b71d8ae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('messenger_messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('reply_to_id', sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('messenger_messages', schema=None) as batch_op:
        batch_op.drop_column('reply_to_id')
