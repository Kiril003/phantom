"""messenger groups

Revision ID: e2a91c7f4b60
Revises: c1e5a70b93df
Create Date: 2026-08-23

Група не заводить власної стрічки: вона живе в messenger_conversations з
kind='group', тож список, курсор прочитаного, пошук і видалення працюють без
жодної правки. Сюди додається лише те, чого в розмові з однією людиною немає:
спільне імʼя групи, творець, епоха складу і відбиток для звірки вголос.

ЖОДНОГО batch_alter_table — і це не стиль, а урок, за який уже заплачено.
batch перебудовує таблицю через DROP старої, а SQLite з увімкненими FK робить
на DROP неявний DELETE FROM: ON DELETE CASCADE тоді зносить усі дочірні рядки.
Саме так міграція курсора прочитаного стерла всю історію месенджера.

Тут DROP не відбувається в принципі: SQLite підтримує ALTER TABLE ADD COLUMN
рідно, таблиця лишається тією самою, каскадувати нічому. Усі чотири колонки
NULLABLE, тож server_default не потрібен. Нові таблиці — звичайний create_table.

Приймання: на копії бойової бази `alembic upgrade head`, потім
`SELECT count(*) FROM messenger_messages` до і після — числа мусять збігтися.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2a91c7f4b60'
down_revision: Union[str, None] = 'c1e5a70b93df'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'messenger_conversations',
        sa.Column('group_id', sa.String(length=32), nullable=True),
    )
    op.add_column(
        'messenger_conversations',
        sa.Column('group_creator_node_id', sa.String(length=64), nullable=True),
    )
    op.add_column(
        'messenger_conversations',
        sa.Column('group_epoch', sa.Integer(), nullable=True),
    )
    op.add_column(
        'messenger_conversations',
        sa.Column('group_fingerprint', sa.String(length=16), nullable=True),
    )
    op.create_index(
        'ix_messenger_conversations_group_id', 'messenger_conversations', ['group_id']
    )

    op.create_table(
        'messenger_group_members',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('conversation_id', sa.String(length=36), nullable=False),
        sa.Column('node_id', sa.String(length=64), nullable=False),
        sa.Column('display_name', sa.String(length=120), nullable=False),
        sa.Column('contact_id', sa.String(length=36), nullable=True),
        sa.Column('bundle_json', sa.Text(), nullable=True),
        sa.Column('address', sa.String(length=255), nullable=True),
        sa.Column('role', sa.String(length=8), nullable=False, server_default='member'),
        sa.Column('state', sa.String(length=12), nullable=False, server_default='active'),
        sa.Column('added_epoch', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('removed_epoch', sa.Integer(), nullable=True),
        sa.Column('last_delivered_at', sa.DateTime(), nullable=True),
        sa.Column('failed_attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(
            ['conversation_id'], ['messenger_conversations.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['contact_id'], ['messenger_contacts.id'], ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'conversation_id', 'node_id', name='uq_messenger_group_member'
        ),
    )
    op.create_index(
        'ix_messenger_group_members_conversation_id',
        'messenger_group_members',
        ['conversation_id'],
    )
    op.create_index(
        'ix_messenger_group_members_contact_id', 'messenger_group_members', ['contact_id']
    )

    op.create_table(
        'messenger_group_deliveries',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('message_id', sa.String(length=36), nullable=False),
        sa.Column('member_node_id', sa.String(length=64), nullable=False),
        sa.Column('outbound_frame', sa.Text(), nullable=True),
        sa.Column('state', sa.String(length=12), nullable=False, server_default='queued'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_attempt_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ['message_id'], ['messenger_messages.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'message_id', 'member_node_id', name='uq_messenger_group_delivery'
        ),
    )
    op.create_index(
        'ix_messenger_group_deliveries_message_id',
        'messenger_group_deliveries',
        ['message_id'],
    )
    op.create_index(
        'ix_messenger_group_deliveries_state', 'messenger_group_deliveries', ['state']
    )


def downgrade() -> None:
    op.drop_index(
        'ix_messenger_group_deliveries_state', table_name='messenger_group_deliveries'
    )
    op.drop_index(
        'ix_messenger_group_deliveries_message_id', table_name='messenger_group_deliveries'
    )
    op.drop_table('messenger_group_deliveries')
    op.drop_index(
        'ix_messenger_group_members_contact_id', table_name='messenger_group_members'
    )
    op.drop_index(
        'ix_messenger_group_members_conversation_id', table_name='messenger_group_members'
    )
    op.drop_table('messenger_group_members')
    op.drop_index(
        'ix_messenger_conversations_group_id', table_name='messenger_conversations'
    )
    # Колонки лишаємо на місці: DROP COLUMN на SQLite потягнув би за собою
    # перебудову таблиці — рівно той batch, через який уже втрачали історію.
    # Чотири порожні NULLABLE колонки нікому не заважають, втрата даних — так.
