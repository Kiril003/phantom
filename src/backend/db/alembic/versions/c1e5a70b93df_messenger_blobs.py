"""messenger blobs

Revision ID: c1e5a70b93df
Revises: d7f3a9c215e4
Create Date: 2026-08-22

Вкладення їде двома різними дорогами: ключ — у тілі повідомлення (наскрізно),
байти — окремим блобом. Ця таблиця описує лише перевезення байтів, тож у ній
свідомо немає ані ключа, ані імені файла: і те, і те живе в тілі листа.

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1e5a70b93df'
down_revision: Union[str, None] = 'd7f3a9c215e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'messenger_blobs',
        sa.Column('blob_id', sa.String(length=64), nullable=False),
        sa.Column('conversation_id', sa.String(length=36), nullable=True),
        sa.Column('direction', sa.String(length=4), nullable=False),
        sa.Column('state', sa.String(length=12), nullable=False, server_default='stored'),
        sa.Column('size', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('peer_node_id', sa.String(length=64), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_attempt_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('blob_id'),
    )
    op.create_index(
        'ix_messenger_blobs_conversation_id', 'messenger_blobs', ['conversation_id']
    )
    op.create_index(
        'ix_messenger_blobs_peer_node_id', 'messenger_blobs', ['peer_node_id']
    )
    op.create_index(
        'ix_messenger_blobs_state', 'messenger_blobs', ['direction', 'state']
    )


def downgrade() -> None:
    op.drop_index('ix_messenger_blobs_state', table_name='messenger_blobs')
    op.drop_index('ix_messenger_blobs_peer_node_id', table_name='messenger_blobs')
    op.drop_index('ix_messenger_blobs_conversation_id', table_name='messenger_blobs')
    op.drop_table('messenger_blobs')
