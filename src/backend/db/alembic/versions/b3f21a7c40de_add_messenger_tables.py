"""messenger conversations and messages

Revision ID: b3f21a7c40de
Revises: 2126616c8ce4
Create Date: 2026-08-22

Стрічка месенджера переїжджає на вузол. До цього вона жила лише в памʼяті
браузера, тож будь-який рестарт стирав листування начисто.

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3f21a7c40de'
down_revision: Union[str, None] = '2126616c8ce4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'messenger_conversations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('owner_user_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False, server_default='dm'),
        sa.Column('circle', sa.String(length=32), nullable=False, server_default='all'),
        sa.Column('handle', sa.String(length=64), nullable=True),
        sa.Column('avatar', sa.Text(), nullable=True),
        sa.Column('next_seq', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('pinned', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_messenger_conversations_owner_user_id',
        'messenger_conversations',
        ['owner_user_id'],
    )
    op.create_index(
        'ix_messenger_conversations_owner_updated',
        'messenger_conversations',
        ['owner_user_id', 'updated_at'],
    )

    op.create_table(
        'messenger_messages',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('conversation_id', sa.String(length=36), nullable=False),
        sa.Column('client_id', sa.String(length=64), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('author_id', sa.String(length=64), nullable=False),
        sa.Column('author_name', sa.String(length=120), nullable=False),
        sa.Column('kind', sa.String(length=24), nullable=False, server_default='text'),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('ciphertext', sa.Text(), nullable=True),
        sa.Column('transport', sa.String(length=16), nullable=True),
        sa.Column('sent_at', sa.DateTime(), nullable=False),
        sa.Column('edited_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ['conversation_id'], ['messenger_conversations.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conversation_id', 'client_id', name='uq_messenger_client_id'),
    )
    op.create_index(
        'ix_messenger_messages_conversation_id', 'messenger_messages', ['conversation_id']
    )
    op.create_index(
        'ix_messenger_messages_conversation_seq',
        'messenger_messages',
        ['conversation_id', 'seq'],
    )


def downgrade() -> None:
    op.drop_index('ix_messenger_messages_conversation_seq', table_name='messenger_messages')
    op.drop_index('ix_messenger_messages_conversation_id', table_name='messenger_messages')
    op.drop_table('messenger_messages')
    op.drop_index('ix_messenger_conversations_owner_updated', table_name='messenger_conversations')
    op.drop_index('ix_messenger_conversations_owner_user_id', table_name='messenger_conversations')
    op.drop_table('messenger_conversations')
