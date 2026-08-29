"""link conversation to contact

Revision ID: d5a8c2f61e73
Revises: c7d4e1908ab2
Create Date: 2026-08-22

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5a8c2f61e73'
down_revision: Union[str, None] = 'c7d4e1908ab2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('messenger_conversations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('contact_id', sa.String(length=36), nullable=True))
        batch_op.create_index(
            'ix_messenger_conversations_contact_id', ['contact_id'], unique=False
        )
        batch_op.create_foreign_key(
            'fk_messenger_conversations_contact',
            'messenger_contacts',
            ['contact_id'],
            ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    with op.batch_alter_table('messenger_conversations', schema=None) as batch_op:
        batch_op.drop_constraint('fk_messenger_conversations_contact', type_='foreignkey')
        batch_op.drop_index('ix_messenger_conversations_contact_id')
        batch_op.drop_column('contact_id')
