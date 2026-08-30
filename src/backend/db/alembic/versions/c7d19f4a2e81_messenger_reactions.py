"""messenger reactions

Реакції на повідомлення. Таблиця, а не колонка в самому листі, і причина
конкретна: реакція — це вчинок ІНШОЇ людини над твоїм листом, і вона приходить
окремим кадром у довільний момент. Тримати їх у полі листа означало б
переписувати рядок листа щоразу, коли хтось тисне емодзі, і губити їх при
будь-якій гонці.

Ключ унікальності — (повідомлення, хто, емодзі): одна людина ставить одну
реакцію одного роду один раз. Повторне натискання знімає її, а не додає другу.

Revision ID: c7d19f4a2e81
Revises: e2a91c7f4b60
Create Date: 2026-08-30
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d19f4a2e81'
down_revision: Union[str, None] = 'e2a91c7f4b60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'messenger_reactions',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column(
            'message_id',
            sa.String(length=36),
            sa.ForeignKey('messenger_messages.id', ondelete='CASCADE'),
            nullable=False,
        ),
        #: Хто поставив. Наш власний node_id для своїх, peer_node_id для чужих —
        #: одне поле на обох, бо в реакції немає «мого» й «чужого» способу.
        sa.Column('actor_node_id', sa.String(length=64), nullable=False),
        #: Ім'я, яке показати. Вузол не має довідника людей, тож підпис їде
        #: разом із реакцією; для своїх беремо ім'я власника.
        sa.Column('actor_name', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('emoji', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            'message_id', 'actor_node_id', 'emoji', name='uq_messenger_reaction'
        ),
    )
    op.create_index(
        'ix_messenger_reactions_message', 'messenger_reactions', ['message_id']
    )


def downgrade() -> None:
    op.drop_index('ix_messenger_reactions_message', table_name='messenger_reactions')
    op.drop_table('messenger_reactions')
