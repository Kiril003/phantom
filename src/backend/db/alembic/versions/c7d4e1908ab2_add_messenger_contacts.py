"""messenger contacts

Revision ID: c7d4e1908ab2
Revises: b3f21a7c40de
Create Date: 2026-08-22

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d4e1908ab2'
down_revision: Union[str, None] = 'b3f21a7c40de'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'messenger_contacts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('owner_user_id', sa.String(length=36), nullable=False),
        sa.Column('peer_node_id', sa.String(length=64), nullable=False),
        sa.Column('display_name', sa.String(length=120), nullable=False),
        sa.Column('bundle_json', sa.Text(), nullable=False),
        sa.Column('session_blob', sa.Text(), nullable=True),
        sa.Column('safety_number', sa.String(length=64), nullable=False),
        sa.Column('verified_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_user_id', 'peer_node_id', name='uq_messenger_contact_peer'),
    )
    op.create_index(
        'ix_messenger_contacts_owner_user_id', 'messenger_contacts', ['owner_user_id']
    )


def downgrade() -> None:
    op.drop_index('ix_messenger_contacts_owner_user_id', table_name='messenger_contacts')
    op.drop_table('messenger_contacts')
