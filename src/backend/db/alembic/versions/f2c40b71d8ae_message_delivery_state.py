"""message delivery state

Revision ID: f2c40b71d8ae
Revises: e91b7c035fda
Create Date: 2026-08-22

Стан доставки має лежати в базі: після рестарту вузол мусить памʼятати,
що комусь щось не доїхало.

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2c40b71d8ae'
down_revision: Union[str, None] = 'e91b7c035fda'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('messenger_messages', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('delivery_state', sa.String(length=12), nullable=False, server_default='local')
        )
        batch_op.add_column(
            sa.Column('delivery_attempts', sa.Integer(), nullable=False, server_default='0')
        )
        batch_op.add_column(sa.Column('last_attempt_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('outbound_frame', sa.Text(), nullable=True))
        batch_op.create_index(
            'ix_messenger_messages_delivery_state', ['delivery_state'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('messenger_messages', schema=None) as batch_op:
        batch_op.drop_index('ix_messenger_messages_delivery_state')
        batch_op.drop_column('outbound_frame')
        batch_op.drop_column('last_attempt_at')
        batch_op.drop_column('delivery_attempts')
        batch_op.drop_column('delivery_state')
