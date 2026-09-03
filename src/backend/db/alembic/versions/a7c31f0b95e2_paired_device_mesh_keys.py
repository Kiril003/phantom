"""paired device mesh keys

Сітьова особа телефона поруч із записом пристрою: без цих трьох полів вузол не
має чим вивести ключ каналу, а без нього адреси скриньок у сховку PH5 у ПК і
телефона різні — і жоден бік про це не дізнається.

Revision ID: a7c31f0b95e2
Revises: c7d19f4a2e81
Create Date: 2026-09-03

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7c31f0b95e2'
down_revision: Union[str, None] = 'c7d19f4a2e81'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable, і це не зручність: рядок, спарований до обміну ключами,
    # мусить читатись як «ключа немає», а не як порожній рядок, який
    # виглядав би ключем і мовчки давав би адресу нізвідки.
    with op.batch_alter_table('paired_devices', schema=None) as batch_op:
        batch_op.add_column(sa.Column('peer_id', sa.String(length=64), nullable=True))
        batch_op.add_column(
            sa.Column('peer_pub_ed25519', sa.String(length=128), nullable=True)
        )
        batch_op.add_column(
            sa.Column('peer_dh_x25519', sa.String(length=128), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table('paired_devices', schema=None) as batch_op:
        batch_op.drop_column('peer_dh_x25519')
        batch_op.drop_column('peer_pub_ed25519')
        batch_op.drop_column('peer_id')
